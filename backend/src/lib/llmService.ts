import Anthropic from "@anthropic-ai/sdk";

export type AIFeature = "deck" | "email" | "match";
export type AIProviderId = "anthropic" | "claude" | "gemini" | "groq" | "openrouter" | "openai" | "custom" | "mock";

const DEFAULT_MODEL_BY_PROVIDER: Record<AIProviderId, string> = {
  anthropic: "claude-sonnet-4-6",
  claude: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
  groq: "llama-3.1-8b-instant",
  openrouter: "openai/gpt-4o-mini",
  openai: "gpt-4o-mini",
  custom: "custom-model",
  mock: "mock",
};

export interface DeckInterviewAnswers {
  companyName: string;
  oneLiner: string;
  problem: string;
  solution: string;
  stage: string;
  sector: string[];
  askAmountUsd: number;
  traction?: string;
  founderBackground?: string;
}

export interface DeckSections {
  problemSlide: string;
  solutionSlide: string;
  marketSlide: string;
  tractionSlide: string;
  teamSlide: string;
  askSlide: string;
  extractedKeywords: string[];
}

export interface DeckGenerationResult {
  sections: DeckSections;
  provider: AIProviderId;
}

export interface PersonalizedEmailInput {
  founderName: string;
  companyName: string;
  oneLiner: string;
  askAmountUsd: number;
  investorName: string;
  investorFirm: string;
  matchReasons: string[];
}

export interface PersonalizedEmailResult {
  subject: string;
  body: string;
  provider: AIProviderId;
}

interface AITextProvider {
  id: AIProviderId;
  isConfigured(): boolean;
  completeJson(system: string, userPrompt: string, options?: { maxTokens?: number }): Promise<string>;
}

/** Thrown by providers for HTTP errors so the router can tell rate limits from outages. */
export class AIProviderHttpError extends Error {
  constructor(readonly provider: AIProviderId, readonly status: number, readonly retryAfterMs: number | null, body: string) {
    super(`${provider} returned ${status}: ${body.slice(0, 200)}`);
  }
}

export const AI_REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS || 30_000);
const RATE_LIMIT_COOLDOWN_MS = 60_000;

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export class AIProviderUnavailableError extends Error {
  constructor(feature: AIFeature, readonly attemptedProviders: AIProviderId[]) {
    super(`No AI provider is currently available for ${feature}.`);
  }
}

export class AIRouter {
  private readonly providers: Record<AIProviderId, AITextProvider>;
  /** Providers that recently returned 429 are tried last until this time, so a 100-email
   * campaign doesn't hit a rate-limited Groq 100 times before falling back. */
  private readonly cooldownUntil = new Map<AIProviderId, number>();

  constructor(providers: Record<AIProviderId, AITextProvider> = createDefaultProviders()) {
    this.providers = providers;
  }

  getProviderPriority(feature: AIFeature): AIProviderId[] {
    return resolveProviderPriority(feature).filter((provider) => provider in this.providers);
  }

  hasConfiguredProvider(feature: AIFeature): boolean {
    return this.getProviderPriority(feature).some((provider) => this.providers[provider].isConfigured());
  }

  /**
   * Tries each configured provider in priority order. A provider's answer is only accepted
   * if `parse` accepts it — malformed JSON or a missing field falls through to the next
   * provider instead of failing the whole request. A 429 puts the provider on a cooldown
   * (honouring Retry-After) and falls back immediately.
   */
  async completeJson<T = string>(
    feature: AIFeature,
    system: string,
    userPrompt: string,
    parse: (text: string) => T = (text) => text as unknown as T
  ): Promise<{ text: string; value: T; provider: AIProviderId }> {
    const attempted: AIProviderId[] = [];
    const now = Date.now();
    const candidates = this.getProviderPriority(feature).filter((id) => this.providers[id].isConfigured());
    // Cooling-down providers go last rather than being dropped, so a lone provider still gets tried.
    const ordered = [
      ...candidates.filter((id) => (this.cooldownUntil.get(id) ?? 0) <= now),
      ...candidates.filter((id) => (this.cooldownUntil.get(id) ?? 0) > now),
    ];

    for (const providerId of ordered) {
      attempted.push(providerId);
      try {
        const text = await this.providers[providerId].completeJson(system, userPrompt);
        if (!text.trim()) throw new Error("empty response");
        const value = parse(text);
        this.cooldownUntil.delete(providerId);
        return { text, value, provider: providerId };
      } catch (err) {
        if (err instanceof AIProviderHttpError && err.status === 429) {
          this.cooldownUntil.set(providerId, Date.now() + Math.min(err.retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS, 10 * 60_000));
        }
        // Never log prompts or keys — only which provider failed and why.
        console.error(`AI provider ${providerId} failed for ${feature}: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
      }
    }

    throw new AIProviderUnavailableError(feature, attempted);
  }

  /**
   * Live connectivity check: sends a tiny JSON prompt to every configured provider. Having
   * an API key is not the same as being available (wrong model, revoked key, no quota).
   */
  async probe(): Promise<{ provider: AIProviderId; configured: boolean; ok: boolean; latencyMs: number | null; error: string | null }[]> {
    const ids = (Object.keys(this.providers) as AIProviderId[]).filter((id) => id !== "claude" && id !== "mock");
    return Promise.all(
      ids.map(async (id) => {
        const provider = this.providers[id];
        if (!provider.isConfigured()) return { provider: id, configured: false, ok: false, latencyMs: null, error: null };
        const started = Date.now();
        try {
          const text = await provider.completeJson('Respond only with this JSON object: {"ok": true}', "ping", { maxTokens: 20 });
          const ok = JSON.parse(stripFences(text))?.ok === true;
          return { provider: id, configured: true, ok, latencyMs: Date.now() - started, error: ok ? null : "Unexpected response shape" };
        } catch (err) {
          return { provider: id, configured: true, ok: false, latencyMs: Date.now() - started, error: String((err as Error)?.message ?? err).slice(0, 200) };
        }
      })
    );
  }
}

const aiRouter = new AIRouter();

export function isAIFeatureAvailable(feature: AIFeature): boolean {
  return aiRouter.hasConfiguredProvider(feature);
}

export function probeAIProviders() {
  return aiRouter.probe();
}

export function resolveProviderPriority(feature: AIFeature, env: NodeJS.ProcessEnv = process.env): AIProviderId[] {
  const key = `${feature.toUpperCase()}_PROVIDER_PRIORITY`;
  const legacyKey = `${feature.toUpperCase()}_PROVIDER`;
  const configured = env[key] || env[legacyKey] || env.AI_PROVIDER_PRIORITY || "groq,anthropic,claude,openrouter,openai,gemini,custom";
  const providers = configured
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean) as AIProviderId[];

  if (env.NODE_ENV !== "production" && env.ALLOW_MOCK_AI === "true" && !providers.includes("mock")) {
    providers.push("mock");
  }

  return providers.filter(isKnownProvider);
}

export async function generateDeckSections(answers: DeckInterviewAnswers): Promise<DeckGenerationResult> {
  const system = `You are an expert VC pitch deck writer. Write tight, specific, non-generic copy. Ground every section in the facts given. Respond only with valid JSON matching this exact shape:
{"problemSlide": string, "solutionSlide": string, "marketSlide": string, "tractionSlide": string, "teamSlide": string, "askSlide": string, "extractedKeywords": string[]}
extractedKeywords should be 5-10 short thesis-matching industry terms.`;

  const userPrompt = `Company: ${answers.companyName}
One-liner: ${answers.oneLiner}
Problem: ${answers.problem}
Solution: ${answers.solution}
Stage: ${answers.stage}
Sector: ${answers.sector.join(", ")}
Ask: $${answers.askAmountUsd.toLocaleString()}
Traction: ${answers.traction || "Not yet provided"}
Founder background: ${answers.founderBackground || "Not yet provided"}`;

  const completion = await aiRouter.completeJson("deck", system, userPrompt, parseDeckSections);
  return { sections: completion.value, provider: completion.provider };
}

export async function generatePersonalizedEmail(input: PersonalizedEmailInput): Promise<PersonalizedEmailResult> {
  const system = `You write concise, specific cold emails from founders to VCs. Never use generic phrases like "I hope this finds you well." Reference the specific fit reasons given. Do not invent facts about the investor. Keep the body under 120 words. Respond only with valid JSON: {"subject": string, "body": string}`;

  const userPrompt = `Founder: ${input.founderName}
Company: ${input.companyName} - ${input.oneLiner}
Ask: $${input.askAmountUsd.toLocaleString()}
Investor: ${input.investorName} at ${input.investorFirm}
Why this investor is a fit: ${input.matchReasons.join("; ")}`;

  const completion = await aiRouter.completeJson("email", system, userPrompt, parseEmailResponse);
  return { ...completion.value, provider: completion.provider };
}

function createDefaultProviders(): Record<AIProviderId, AITextProvider> {
  return {
    anthropic: createAnthropicProvider("anthropic"),
    claude: createAnthropicProvider("claude"),
    gemini: createGeminiProvider(),
    groq: createOpenAICompatibleProvider({
      id: "groq",
      apiKeyEnv: "GROQ_API_KEY",
      baseUrlEnv: "GROQ_BASE_URL",
      defaultBaseUrl: "https://api.groq.com/openai/v1",
      modelEnv: "GROQ_MODEL",
    }),
    openrouter: createOpenAICompatibleProvider({
      id: "openrouter",
      apiKeyEnv: "OPENROUTER_API_KEY",
      baseUrlEnv: "OPENROUTER_BASE_URL",
      defaultBaseUrl: "https://openrouter.ai/api/v1",
      modelEnv: "OPENROUTER_MODEL",
    }),
    openai: createOpenAICompatibleProvider({
      id: "openai",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrlEnv: "OPENAI_BASE_URL",
      defaultBaseUrl: "https://api.openai.com/v1",
      modelEnv: "OPENAI_MODEL",
    }),
    custom: createOpenAICompatibleProvider({
      id: "custom",
      apiKeyEnv: "CUSTOM_AI_API_KEY",
      baseUrlEnv: "CUSTOM_AI_BASE_URL",
      defaultBaseUrl: "",
      modelEnv: "CUSTOM_AI_MODEL",
    }),
    mock: createMockProvider(),
  };
}

function createAnthropicProvider(id: "anthropic" | "claude"): AITextProvider {
  return {
    id,
    isConfigured: () => !!process.env.ANTHROPIC_API_KEY,
    completeJson: async (system, userPrompt, options) => {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: 1 });
      const response = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL_BY_PROVIDER[id],
        max_tokens: options?.maxTokens ?? 1200,
        system,
        messages: [{ role: "user", content: userPrompt }],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      return textBlock && "text" in textBlock ? textBlock.text : "";
    },
  };
}

function createOpenAICompatibleProvider(config: {
  id: "groq" | "openrouter" | "openai" | "custom";
  apiKeyEnv: string;
  baseUrlEnv: string;
  defaultBaseUrl: string;
  modelEnv: string;
}): AITextProvider {
  return {
    id: config.id,
    isConfigured: () => !!process.env[config.apiKeyEnv] && !!(process.env[config.baseUrlEnv] || config.defaultBaseUrl),
    completeJson: async (system, userPrompt, options) => {
      const apiKey = process.env[config.apiKeyEnv];
      const baseUrl = (process.env[config.baseUrlEnv] || config.defaultBaseUrl).replace(/\/+$/, "");
      const model = process.env[config.modelEnv] || DEFAULT_MODEL_BY_PROVIDER[config.id];
      if (!apiKey || !baseUrl) throw new Error(`${config.id} is not configured.`);

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: options?.maxTokens ?? 1200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AIProviderHttpError(config.id, response.status, retryAfterMs(response.headers.get("retry-after")), body);
      }

      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}

function createGeminiProvider(): AITextProvider {
  return {
    id: "gemini",
    isConfigured: () => !!process.env.GEMINI_API_KEY,
    completeJson: async (system, userPrompt, options) => {
      const model = process.env.GEMINI_MODEL || DEFAULT_MODEL_BY_PROVIDER.gemini;
      // Key goes in a header, not the URL, so it can't leak into logged request URLs.
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY || "" },
          signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
          body: JSON.stringify({
            generationConfig: { temperature: 0.3, responseMimeType: "application/json", maxOutputTokens: options?.maxTokens ?? 1200 },
            contents: [{ role: "user", parts: [{ text: `${system}\n\n${userPrompt}` }] }],
          }),
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new AIProviderHttpError("gemini", response.status, retryAfterMs(response.headers.get("retry-after")), body);
      }

      const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    },
  };
}

function createMockProvider(): AITextProvider {
  return {
    id: "mock",
    isConfigured: () => process.env.NODE_ENV !== "production" && process.env.ALLOW_MOCK_AI === "true",
    completeJson: async (_system, userPrompt) => {
      if (userPrompt.includes("Investor:")) {
        return JSON.stringify({
          subject: "Manual review draft",
          body: "This development-only draft is available because ALLOW_MOCK_AI=true. Do not enable this in production.",
        });
      }
      return JSON.stringify({
        problemSlide: "Development-only problem draft.",
        solutionSlide: "Development-only solution draft.",
        marketSlide: "Development-only market draft.",
        tractionSlide: "Development-only traction draft.",
        teamSlide: "Development-only team draft.",
        askSlide: "Development-only ask draft.",
        extractedKeywords: ["saas"],
      });
    },
  };
}

export function parseEmailResponse(text: string): { subject: string; body: string } {
  const parsed = JSON.parse(stripFences(text)) as { subject?: unknown; body?: unknown };
  const subject = typeof parsed.subject === "string" ? parsed.subject.replace(/[\r\n]+/g, " ").trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (!subject || !body) throw new Error("AI email response was missing subject or body.");
  return { subject: subject.slice(0, 200), body: body.slice(0, 5000) };
}

export function parseDeckSections(text: string): DeckSections {
  const parsed = JSON.parse(stripFences(text)) as DeckSections;
  validateDeckSections(parsed);
  return parsed;
}

function stripFences(text: string): string {
  return text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
}

function validateDeckSections(sections: DeckSections) {
  const required: (keyof DeckSections)[] = [
    "problemSlide",
    "solutionSlide",
    "marketSlide",
    "tractionSlide",
    "teamSlide",
    "askSlide",
    "extractedKeywords",
  ];
  for (const key of required) {
    const value = sections[key];
    if (Array.isArray(value)) {
      if (value.length === 0) throw new Error(`AI deck response was missing ${key}.`);
    } else if (!value?.trim()) {
      throw new Error(`AI deck response was missing ${key}.`);
    }
  }
}

function isKnownProvider(provider: AIProviderId): provider is AIProviderId {
  return ["anthropic", "claude", "gemini", "groq", "openrouter", "openai", "custom", "mock"].includes(provider);
}
