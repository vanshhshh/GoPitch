import { describe, expect, it, afterEach } from "vitest";
import {
  AIProviderUnavailableError,
  generateDeckSections,
  resolveProviderPriority,
} from "../src/lib/llmService";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveProviderPriority", () => {
  it("uses feature-specific provider priority before global defaults", () => {
    const priority = resolveProviderPriority("email", {
      EMAIL_PROVIDER_PRIORITY: "groq, openrouter",
      AI_PROVIDER_PRIORITY: "anthropic",
    } as NodeJS.ProcessEnv);

    expect(priority).toEqual(["groq", "openrouter"]);
  });

  it("keeps mock provider out unless it is explicitly enabled outside production", () => {
    expect(resolveProviderPriority("deck", { DECK_PROVIDER_PRIORITY: "groq" } as NodeJS.ProcessEnv)).toEqual(["groq"]);

    expect(
      resolveProviderPriority("deck", {
        NODE_ENV: "test",
        ALLOW_MOCK_AI: "true",
        DECK_PROVIDER_PRIORITY: "groq",
      } as NodeJS.ProcessEnv)
    ).toEqual(["groq", "mock"]);
  });

  it("filters unknown provider names", () => {
    const priority = resolveProviderPriority("match", {
      MATCH_PROVIDER_PRIORITY: "groq,unknown,custom",
    } as NodeJS.ProcessEnv);

    expect(priority).toEqual(["groq", "custom"]);
  });
});

describe("generateDeckSections", () => {
  it("fails closed instead of returning mock deck content when no provider is configured", async () => {
    process.env.DECK_PROVIDER_PRIORITY = "custom";
    delete process.env.CUSTOM_AI_API_KEY;
    delete process.env.CUSTOM_AI_BASE_URL;
    delete process.env.ALLOW_MOCK_AI;

    await expect(
      generateDeckSections({
        companyName: "AuditCo",
        oneLiner: "Security workflows for startups",
        problem: "Manual evidence collection is slow.",
        solution: "Automated control evidence.",
        stage: "SEED",
        sector: ["saas"],
        askAmountUsd: 500000,
      })
    ).rejects.toBeInstanceOf(AIProviderUnavailableError);
  });
});
