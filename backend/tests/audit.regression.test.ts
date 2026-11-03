import { describe, it, expect, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

process.env.JWT_SECRET ||= "unit_test_secret";
process.env.REFRESH_TOKEN_ENCRYPTION_KEY ||= "b".repeat(64);

describe("withUserLock", () => {
  it("returns acquired:false (no work done) when another session holds the lock, and always releases", async () => {
    vi.resetModules();
    const released: string[] = [];
    let held = false;
    vi.doMock("pg", () => ({
      Pool: class {
        on() {}
        async connect() {
          return {
            query: async (sql: string) => {
              if (sql.includes("pg_try_advisory_lock")) {
                const ok = !held;
                held = true;
                return { rows: [{ ok }] };
              }
              if (sql.includes("pg_advisory_unlock")) {
                held = false;
                released.push("unlock");
              }
              return { rows: [] };
            },
            release: () => released.push("release"),
          };
        }
      },
    }));
    const { withUserLock } = await import("../src/lib/db");
    let innerResult: any;
    const outer = await withUserLock("dispatch", "u1", async () => {
      innerResult = await withUserLock("dispatch", "u1", async () => "should not run");
      return "outer ran";
    });
    expect(outer).toEqual({ acquired: true, result: "outer ran" });
    expect(innerResult).toEqual({ acquired: false });
    expect(released.filter((r) => r === "release")).toHaveLength(2);
    expect(released).toContain("unlock");
    vi.doUnmock("pg");
  });
});

describe("AIRouter fallback", () => {
  it("falls through malformed JSON and 429s to the next provider, and deprioritises the rate-limited one", async () => {
    const { AIRouter, AIProviderHttpError, parseEmailResponse } = await import("../src/lib/llmService");
    const calls: string[] = [];
    const provider = (id: any, impl: () => Promise<string>) => ({ id, isConfigured: () => true, completeJson: async () => (calls.push(id), impl()) });
    const providers: any = {
      groq: provider("groq", async () => {
        throw new AIProviderHttpError("groq", 429, 30_000, "rate limited");
      }),
      gemini: provider("gemini", async () => "not json at all"),
      openrouter: provider("openrouter", async () => JSON.stringify({ subject: "Hi\r\nBcc: x", body: "Body" })),
    };
    for (const id of ["anthropic", "claude", "openai", "custom", "mock"]) providers[id] = { id, isConfigured: () => false, completeJson: async () => "" };
    process.env.EMAIL_PROVIDER_PRIORITY = "groq,gemini,openrouter";
    const router = new AIRouter(providers);

    const first = await router.completeJson("email", "s", "u", parseEmailResponse);
    expect(first.provider).toBe("openrouter");
    expect(first.value.subject).toBe("Hi Bcc: x"); // CR/LF stripped from AI output
    expect(calls).toEqual(["groq", "gemini", "openrouter"]);

    calls.length = 0;
    await router.completeJson("email", "s", "u", parseEmailResponse);
    expect(calls[0]).toBe("gemini"); // groq is cooling down after its 429, tried last
    delete process.env.EMAIL_PROVIDER_PRIORITY;
  });

  it("reports unavailable when every provider fails", async () => {
    const { AIRouter, AIProviderUnavailableError } = await import("../src/lib/llmService");
    const providers: any = {};
    for (const id of ["groq", "anthropic", "claude", "openrouter", "openai", "gemini", "custom", "mock"]) {
      providers[id] = { id, isConfigured: () => id === "groq", completeJson: async () => "{}" };
    }
    process.env.EMAIL_PROVIDER_PRIORITY = "groq";
    await expect(new AIRouter(providers).completeJson("email", "s", "u", (t) => JSON.parse(t).subject.trim())).rejects.toBeInstanceOf(AIProviderUnavailableError);
    delete process.env.EMAIL_PROVIDER_PRIORITY;
  });
});

describe("outbound MIME", () => {
  it("cannot be header-injected and encodes UTF-8 safely", async () => {
    const { buildRfc2822Message } = await import("../src/lib/emailDelivery");
    const raw = buildRfc2822Message(
      { to: "inv@fund.test\r\nBcc: all@x.test", subject: "Raise ₹5 Cr\r\nBcc: evil@x.test", body: "Hello — ₹ works", fromName: 'Asha "CEO" <x>' },
      "asha@gmail.test"
    );
    const headerBlock = raw.split("\r\n\r\n")[0]!;
    expect(headerBlock).not.toMatch(/^Bcc:/m);
    expect(headerBlock).toMatch(/^Subject: =\?UTF-8\?B\?/m);
    expect(headerBlock).toContain("Content-Transfer-Encoding: base64");
    const body = Buffer.from(raw.split("\r\n\r\n")[1]!.replace(/\r\n/g, ""), "base64").toString("utf-8");
    expect(body).toBe("Hello — ₹ works");
  });
});

describe("warm-up schedule", () => {
  it("is 50/day on days 1-3 and 150/day from day 4, resetting at 00:00 UTC", async () => {
    const { getWarmupCap, warmupStatus, accountAgeDaysSince, nextDailyResetAt } = await import("../src/services/sendScheduler");
    expect([0, 1, 2].map(getWarmupCap)).toEqual([50, 50, 50]);
    expect([3, 10].map(getWarmupCap)).toEqual([150, 150]);
    expect(warmupStatus(0)).toMatchObject({ warmupDay: 1, warmupComplete: false });
    expect(warmupStatus(3)).toMatchObject({ warmupDay: null, warmupComplete: true });
    const now = new Date("2026-11-03T20:00:00Z");
    expect(accountAgeDaysSince(new Date("2026-10-31T20:00:01Z"), now)).toBe(2);
    expect(accountAgeDaysSince(new Date("2026-10-31T20:00:00Z"), now)).toBe(3);
    expect(nextDailyResetAt(now).toISOString()).toBe("2026-11-04T00:00:00.000Z");
  });
});

describe("Gmail thread classification", () => {
  const sentAt = "2026-08-10T10:00:00Z";
  const msg = (from: string, date: string, subject = "Re: intro", snippet = "") => ({
    snippet,
    payload: { headers: [{ name: "From", value: from }, { name: "To", value: "founder@gmail.test" }, { name: "Date", value: date }, { name: "Subject", value: subject }] },
  });

  it("treats a mailer-daemon notice as a bounce, not an investor reply", async () => {
    const { classifyThread } = await import("../src/services/gmailWatcher");
    const thread = [msg("founder@gmail.test", "Mon, 10 Aug 2026 10:00:00 +0000"), msg("Mail Delivery Subsystem <mailer-daemon@googlemail.com>", "Mon, 10 Aug 2026 10:01:00 +0000", "Delivery Status Notification (Failure)", "Address not found")];
    expect(classifyThread(thread, "founder@gmail.test", sentAt)).toBe("bounce");
  });

  it("still detects a real reply", async () => {
    const { classifyThread } = await import("../src/services/gmailWatcher");
    const thread = [msg("founder@gmail.test", "Mon, 10 Aug 2026 10:00:00 +0000"), msg("Investor <inv@fund.test>", "Mon, 10 Aug 2026 12:00:00 +0000")];
    expect(classifyThread(thread, "founder@gmail.test", sentAt)).toBe("reply");
  });
});

describe("Gmail scopes", () => {
  it("requests send + metadata by default, never modify unless configured", async () => {
    const { getGmailScopes, userHasReplyTrackingScope } = await import("../src/routes/googleAuth");
    const scopes = getGmailScopes();
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.metadata");
    expect(scopes.some((s) => s.endsWith("gmail.modify"))).toBe(false);
    expect(getGmailScopes("send").some((s) => s.includes("metadata"))).toBe(false);
    // Existing users who granted modify keep reply tracking.
    expect(userHasReplyTrackingScope("https://www.googleapis.com/auth/gmail.modify")).toBe(true);
    expect(userHasReplyTrackingScope("https://www.googleapis.com/auth/gmail.send")).toBe(false);
  });
});

describe("quota summary", () => {
  it("distinguishes sent, queued, remaining-to-send and remaining-to-allocate", async () => {
    const { summarizeQuota } = await import("../src/services/pricingService");
    expect(summarizeQuota(30, { sent: 10, queued: 15 })).toEqual({ limit: 30, sent: 10, queued: 15, remainingToSend: 20, remainingToAllocate: 5, exhausted: false });
    expect(summarizeQuota(30, { sent: 30, queued: 0 }).exhausted).toBe(true);
  });
});
