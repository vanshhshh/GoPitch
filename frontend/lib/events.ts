/** Fired when the API answers 402 upgradeRequired, so the dashboard shows one consistent upgrade prompt. */
export const QUOTA_EXHAUSTED_EVENT = "gopitch:quota-exhausted";

export function announceQuotaExhausted(detail: { tier?: string; limit?: number } = {}) {
  window.dispatchEvent(new CustomEvent(QUOTA_EXHAUSTED_EVENT, { detail }));
}
