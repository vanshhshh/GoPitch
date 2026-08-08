import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import { verifyRazorpaySignature } from "../src/lib/razorpaySignature";

const SECRET = "test_webhook_secret_123";

function signBody(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyRazorpaySignature", () => {
  it("accepts a correctly signed payload", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_123" } } } });
    const signature = signBody(body, SECRET);
    expect(verifyRazorpaySignature(body, signature, SECRET)).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    const signature = signBody(body, "wrong_secret");
    expect(verifyRazorpaySignature(body, signature, SECRET)).toBe(false);
  });

  it("rejects a tampered body even if the signature was valid for the original", () => {
    const originalBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { amount: 149900 } } } });
    const signature = signBody(originalBody, SECRET);
    const tamperedBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { amount: 1 } } } });
    expect(verifyRazorpaySignature(tamperedBody, signature, SECRET)).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    expect(verifyRazorpaySignature(body, undefined, SECRET)).toBe(false);
  });

  it("fails closed when the webhook secret is not configured", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    const signature = signBody(body, SECRET);
    expect(verifyRazorpaySignature(body, signature, "")).toBe(false);
  });

  it("rejects a malformed (non-hex) signature header without throwing", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    expect(() => verifyRazorpaySignature(body, "not-valid-hex!!", SECRET)).not.toThrow();
    expect(verifyRazorpaySignature(body, "not-valid-hex!!", SECRET)).toBe(false);
  });

  it("rejects a signature of a different length without throwing", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    expect(verifyRazorpaySignature(body, "abcd", SECRET)).toBe(false);
  });
});
