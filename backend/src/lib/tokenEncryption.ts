/**
 * tokenEncryption.ts
 *
 * Encrypts Gmail OAuth refresh tokens before storing them in the database. A refresh
 * token is long-lived and, if the database were ever exposed, an unencrypted token would
 * let an attacker send email as every connected founder indefinitely. AES-256-GCM gives
 * both confidentiality and integrity (GCM's auth tag detects tampering, not just
 * decrypts) — REFRESH_TOKEN_ENCRYPTION_KEY must be a 32-byte hex string, set once and
 * never rotated without a migration plan for existing encrypted tokens.
 */

import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV is the GCM-recommended size

function getKey(): Buffer {
  const hex = process.env.REFRESH_TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "REFRESH_TOKEN_ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("REFRESH_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (a 64-character hex string).");
  }
  return key;
}

export function assertRefreshTokenEncryptionKeyConfigured() {
  getKey();
}

/** Returns "iv:authTag:ciphertext", all hex-encoded, joined so it's a single storable string. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token — expected 'iv:authTag:ciphertext' format.");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted token — one or more segments were empty.");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf-8");
}
