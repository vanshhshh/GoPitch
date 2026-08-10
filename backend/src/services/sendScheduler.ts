/**
 * sendScheduler.ts
 *
 * Every send goes out through the FOUNDER's OWN connected Gmail (OAuth), never a shared
 * sending domain. That's the correct call from the last message — it means our infra
 * cost for sending is ~zero, and no shared-domain reputation risk exists across users.
 *
 * But it also means WE own the responsibility of keeping every individual founder's Gmail
 * account safe. One suspended account = one furious customer whose real professional email
 * just got flagged. This module is the safety layer for that.
 *
 * Rules encoded here:
 *  1. New accounts warm up gradually — nobody sends at full volume on day one.
 *  2. Daily cap sits well under known Gmail/Workspace sending thresholds, with margin.
 *  3. A single per-user cap number is not enough — reputation score (bounce/complaint
 *     driven) dynamically throttles below the nominal cap when signals turn bad.
 *  4. Sends are spaced with jitter across the day, never fired in a single burst —
 *     bursty sending from a personal Gmail account is itself a spam signal independent
 *     of raw volume.
 */

export interface UserSendState {
  accountAgeDays: number; // days since Gmail was connected to this platform
  sendReputationScore: number; // 0.0 - 1.0, starts at 1.0, drops on bounces/complaints
  sentTodayCount: number;
  bounceCountLast7Days: number;
  complaintCountLast7Days: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  dailyCap: number;
  remainingToday: number;
  reason?: string;
  nextEligibleSendDelayMs?: number;
}

// Warm-up ramp: 3 days at 50/day, then 150/day after warmup.
const WARMUP_SCHEDULE: { minDay: number; cap: number }[] = [
  { minDay: 0, cap: 50 },
  { minDay: 3, cap: 150 },
];

const HARD_CEILING = 150; // never exceed regardless of age/reputation — safety margin under platform limits

// Reputation circuit breakers — these override the warm-up cap entirely
const BOUNCE_PAUSE_THRESHOLD = 3; // 3+ bounces in 7 days -> pause sending, force list re-verification
const COMPLAINT_PAUSE_THRESHOLD = 1; // even 1 spam complaint is treated as a hard stop

export function getWarmupCap(accountAgeDays: number): number {
  let cap = WARMUP_SCHEDULE[0]!.cap;
  for (const step of WARMUP_SCHEDULE) {
    if (accountAgeDays >= step.minDay) cap = step.cap;
  }
  return Math.min(cap, HARD_CEILING);
}

export function evaluateSend(state: UserSendState): RateLimitDecision {
  const warmupCap = getWarmupCap(state.accountAgeDays);

  if (state.complaintCountLast7Days >= COMPLAINT_PAUSE_THRESHOLD) {
    return {
      allowed: false,
      dailyCap: 0,
      remainingToday: 0,
      reason:
        "Sending paused: spam complaint detected in the last 7 days. Manual review required before resuming.",
    };
  }

  if (state.bounceCountLast7Days >= BOUNCE_PAUSE_THRESHOLD) {
    return {
      allowed: false,
      dailyCap: 0,
      remainingToday: 0,
      reason:
        "Sending paused: bounce rate too high in the last 7 days. Investor list needs re-verification before resuming.",
    };
  }

  // Reputation score scales the cap down smoothly rather than a hard cliff, so a single
  // early bounce doesn't fully block a user — it just tightens the throttle.
  const effectiveCap = Math.floor(warmupCap * clamp(state.sendReputationScore, 0, 1));

  const remaining = effectiveCap - state.sentTodayCount;

  if (remaining <= 0) {
    return {
      allowed: false,
      dailyCap: effectiveCap,
      remainingToday: 0,
      reason: `Daily send cap reached (${effectiveCap}/day at current account age + reputation).`,
    };
  }

  return {
    allowed: true,
    dailyCap: effectiveCap,
    remainingToday: remaining,
  };
}

/**
 * Spreads N approved sends across the working day with randomized jitter, instead of
 * firing them in a burst. Returns delay offsets in ms from a chosen start time.
 * Burst-sending from a personal Gmail account is itself a spam-detection signal,
 * independent of whether the daily cap is respected.
 */
export function scheduleSendOffsets(
  count: number,
  windowStartHour = 9,
  windowEndHour = 18
): number[] {
  const windowMs = (windowEndHour - windowStartHour) * 60 * 60 * 1000;
  const offsets: number[] = [];
  const baseInterval = windowMs / Math.max(count, 1);

  for (let i = 0; i < count; i++) {
    const jitter = (Math.random() - 0.5) * baseInterval * 0.6; // +/-30% jitter around even spacing
    offsets.push(Math.max(0, Math.round(i * baseInterval + jitter)));
  }
  return offsets.sort((a, b) => a - b);
}

/**
 * Applies a bounce or complaint event to reputation score. Called by the webhook/polling
 * job that checks Gmail send results.
 */
export function applyReputationEvent(
  currentScore: number,
  event: "bounce" | "complaint" | "clean_send"
): number {
  switch (event) {
    case "complaint":
      return 0; // full stop, requires manual review to reset — see evaluateSend threshold above
    case "bounce":
      return clamp(currentScore - 0.15, 0, 1);
    case "clean_send":
      return clamp(currentScore + 0.01, 0, 1); // slow recovery/reinforcement on successful sends
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
