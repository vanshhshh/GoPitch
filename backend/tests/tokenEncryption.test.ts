import { describe, it, expect, beforeAll } from "vitest";

const TEST_KEY = "a".repeat(64); // 32 bytes hex

beforeAll(() => {
  process.env.REFRESH_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

describe("token encryption", () => {
  it("round-trips a token correctly", async () => {
    const { encryptToken, decryptToken } = await import("../src/lib/tokenEncryption");
    const original = "1//0gABCDEF_a_fake_refresh_token_shape_ghijklmnop";
    const encrypted = encryptToken(original);
    expect(encrypted).not.toBe(original);
    expect(decryptToken(encrypted)).toBe(original);
  });

  it("produces a different ciphertext each time (random IV) even for the same input", async () => {
    const { encryptToken } = await import("../src/lib/tokenEncryption");
    const a = encryptToken("same-token-value");
    const b = encryptToken("same-token-value");
    expect(a).not.toBe(b);
  });

  it("throws when the stored value has been tampered with", async () => {
    const { encryptToken, decryptToken } = await import("../src/lib/tokenEncryption");
    const encrypted = encryptToken("a-real-looking-refresh-token");
    const parts = encrypted.split(":");
    // flip a character in the ciphertext portion
    const tamperedCiphertext = parts[2]!.slice(0, -2) + (parts[2]!.slice(-2) === "00" ? "11" : "00");
    const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws on a malformed stored value", async () => {
    const { decryptToken } = await import("../src/lib/tokenEncryption");
    expect(() => decryptToken("not-the-right-format")).toThrow(/malformed/i);
  });

  it("throws a clear error when the encryption key is missing", async () => {
    const original = process.env.REFRESH_TOKEN_ENCRYPTION_KEY;
    delete process.env.REFRESH_TOKEN_ENCRYPTION_KEY;
    const { encryptToken } = await import("../src/lib/tokenEncryption");
    expect(() => encryptToken("anything")).toThrow(/not set/i);
    process.env.REFRESH_TOKEN_ENCRYPTION_KEY = original;
  });
});
