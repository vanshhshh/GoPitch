import { afterEach, describe, expect, it } from "vitest";
import { sendViaSmtpFallback } from "../src/lib/emailDelivery";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("sendViaSmtpFallback", () => {
  it("is disabled in production even when fallback env is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.SMTP_FALLBACK_ENABLED = "true";
    process.env.SMTP_USER = "sender@example.com";
    process.env.SMTP_APP_PASSWORD = "secret";

    const result = await sendViaSmtpFallback({
      to: "investor@example.com",
      subject: "Hello",
      body: "Body",
    });

    expect(result.delivered).toBe(false);
    expect(result.via).toBe("none");
    expect(result.error).toMatch(/disabled in production/i);
  });
});
