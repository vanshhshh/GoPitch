import { describe, it, expect } from "vitest";

describe("auth regression tests", () => {
  it("signs and verifies a token", async () => {
    process.env.JWT_SECRET = "test_secret_123";
    const { signToken, verifyToken } = await import("../src/lib/auth");
    const token = signToken({ userId: "user_123", role: "FOUNDER" });
    const payload = verifyToken(token);
    expect(payload.userId).toBe("user_123");
    expect(payload.role).toBe("FOUNDER");
  });

  it("rejects an invalid token", async () => {
    process.env.JWT_SECRET = "test_secret_123";
    const { verifyToken } = await import("../src/lib/auth");
    expect(() => verifyToken("invalid.token.here")).toThrow();
  });

  it("hashes and verifies a password", async () => {
    process.env.JWT_SECRET = "test_secret_123";
    const { hashPassword, verifyPassword } = await import("../src/lib/auth");
    const hash = await hashPassword("password123");
    const valid = await verifyPassword("password123", hash);
    expect(valid).toBe(true);
    const invalid = await verifyPassword("wrongpassword", hash);
    expect(invalid).toBe(false);
  });
});
