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
  if (!/^[0-9a-f]+$/i.test(signatureHeader)) return false;
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const receivedBuffer = Buffer.from(signatureHeader, "hex");

  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Verifies the signature Razorpay Checkout hands the browser on success:
 * HMAC_SHA256(order_id + "|" + payment_id, key_secret). It proves the payment id really
 * belongs to our order — but not that it's captured, so callers still confirm the status.
 * Reference: https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/#verify-payment-signature
 */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string | undefined, keySecret: string): boolean {
  if (!signature || !keySecret || !orderId || !paymentId) return false;
  return verifyRazorpaySignature(`${orderId}|${paymentId}`, signature, keySecret);
}

export interface RazorpayWebhookPayload {
  event: string;
  created_at?: number;
  payload: {
    payment?: {
      entity?: {
        id: string;
        order_id: string;
        status: string;
        amount: number;
        error_description?: string | null;
        notes?: Record<string, string>;
      };
    };
    order?: {
      entity?: {
        id: string;
        amount: number;
        amount_paid?: number;
        status: string;
      };
    };
    refund?: {
      entity?: {
        id: string;
        payment_id: string;
        amount: number;
        status: string;
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
