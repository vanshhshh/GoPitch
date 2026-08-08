/**
 * razorpaySignature.ts
 *
 * Razorpay signs every webhook payload with HMAC-SHA256 using your webhook secret
 * (set in the Razorpay dashboard, separate from your API key/secret). This verifies
 * that signature before any webhook payload is trusted — an unsigned or mis-signed
 * request must never unlock a paid campaign, regardless of what it claims.
 *
 * Reference: https://razorpay.com/docs/webhooks/validate-test/
 */

import * as crypto from "crypto";

export function verifyRazorpaySignature(rawBody: string, signatureHeader: string | undefined, webhookSecret: string): boolean {
  if (!signatureHeader) return false;
  if (!webhookSecret) {
    // Failing closed: if the secret isn't configured, nothing should ever pass verification.
    // A missing secret is a deployment mistake, not a reason to accept unsigned payloads.
    return false;
  }

  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

  // Constant-time comparison — a naive === comparison leaks timing information that
  // could theoretically help an attacker guess a valid signature byte-by-byte.
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const receivedBuffer = Buffer.from(signatureHeader, "hex");

  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: {
      entity?: {
        id: string;
        order_id: string;
        status: string;
        amount: number;
        notes?: Record<string, string>;
      };
    };
    subscription?: {
      entity?: {
        id: string;
        status: string;
        notes?: Record<string, string>;
      };
    };
  };
}

export function parseVerifiedWebhook(rawBody: string): RazorpayWebhookPayload {
  return JSON.parse(rawBody) as RazorpayWebhookPayload;
}
