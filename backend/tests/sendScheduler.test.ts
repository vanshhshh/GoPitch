import { describe, it, expect } from "vitest";
import {
  getWarmupCap,
  evaluateSend,
  scheduleSendOffsets,
  applyReputationEvent,
  UserSendState,
} from "../src/services/sendScheduler";

function baseState(overrides: Partial<UserSendState> = {}): UserSendState {
  return {
    accountAgeDays: 0,
    sendReputationScore: 1.0,
    sentTodayCount: 0,
    bounceCountLast7Days: 0,
    complaintCountLast7Days: 0,
    ...overrides,
  };
}

describe("getWarmupCap", () => {
  it("starts new accounts at the lowest cap", () => {
    expect(getWarmupCap(0)).toBe(15);
  });

  it("increases cap at each warm-up milestone", () => {
    expect(getWarmupCap(4)).toBe(25);
    expect(getWarmupCap(8)).toBe(40);
    expect(getWarmupCap(14)).toBe(60);
    expect(getWarmupCap(21)).toBe(80);
  });

  it("never exceeds the hard ceiling even for very old accounts", () => {
    expect(getWarmupCap(365)).toBe(80);
  });

  it("uses the highest applicable milestone, not the nearest", () => {
    expect(getWarmupCap(6)).toBe(25); // between day-4 and day-8 milestones
  });
});

describe("evaluateSend", () => {
  it("allows sending within cap for a fresh, healthy account", () => {
    const decision = evaluateSend(baseState({ sentTodayCount: 5 }));
    expect(decision.allowed).toBe(true);
    expect(decision.dailyCap).toBe(15);
    expect(decision.remainingToday).toBe(10);
  });

  it("blocks sending once the daily cap is reached", () => {
    const decision = evaluateSend(baseState({ sentTodayCount: 15 }));
    expect(decision.allowed).toBe(false);
    expect(decision.remainingToday).toBe(0);
    expect(decision.reason).toMatch(/daily send cap reached/i);
  });

  it("hard-stops on a single spam complaint regardless of everything else", () => {
    const decision = evaluateSend(
      baseState({ accountAgeDays: 60, sendReputationScore: 1.0, complaintCountLast7Days: 1 })
    );
    expect(decision.allowed).toBe(false);
    expect(decision.dailyCap).toBe(0);
    expect(decision.reason).toMatch(/spam complaint/i);
  });

  it("pauses sending after 3+ bounces in 7 days", () => {
    const decision = evaluateSend(baseState({ bounceCountLast7Days: 3 }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/bounce rate too high/i);
  });

  it("does not pause below the bounce threshold", () => {
    const decision = evaluateSend(baseState({ bounceCountLast7Days: 2, sentTodayCount: 0 }));
    expect(decision.allowed).toBe(true);
  });

  it("scales the effective cap down smoothly as reputation degrades", () => {
    const healthy = evaluateSend(baseState({ accountAgeDays: 21, sendReputationScore: 1.0 }));
    const degraded = evaluateSend(baseState({ accountAgeDays: 21, sendReputationScore: 0.5 }));
    expect(degraded.dailyCap).toBeLessThan(healthy.dailyCap);
    expect(degraded.dailyCap).toBe(40); // 80 * 0.5
  });
});

describe("scheduleSendOffsets", () => {
  it("returns the correct number of offsets", () => {
    const offsets = scheduleSendOffsets(10);
    expect(offsets.length).toBe(10);
  });

  it("returns offsets in ascending order", () => {
    const offsets = scheduleSendOffsets(20);
    const sorted = [...offsets].sort((a, b) => a - b);
    expect(offsets).toEqual(sorted);
  });

  it("keeps all offsets within the working window", () => {
    const offsets = scheduleSendOffsets(15, 9, 18);
    const windowMs = 9 * 60 * 60 * 1000;
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(windowMs);
    }
  });

  it("never returns negative offsets even with jitter", () => {
    const offsets = scheduleSendOffsets(3);
    expect(offsets.every((o) => o >= 0)).toBe(true);
  });
});

describe("applyReputationEvent", () => {
  it("drops score to zero immediately on a complaint", () => {
    expect(applyReputationEvent(1.0, "complaint")).toBe(0);
  });

  it("reduces score on a bounce but not to zero", () => {
    const result = applyReputationEvent(1.0, "bounce");
    expect(result).toBeCloseTo(0.85, 5);
    expect(result).toBeGreaterThan(0);
  });

  it("slowly recovers score on clean sends", () => {
    const result = applyReputationEvent(0.9, "clean_send");
    expect(result).toBeGreaterThan(0.9);
  });

  it("never exceeds 1.0 on recovery", () => {
    const result = applyReputationEvent(0.999, "clean_send");
    expect(result).toBeLessThanOrEqual(1.0);
  });

  it("never goes below 0 on repeated bounces", () => {
    let score = 0.1;
    score = applyReputationEvent(score, "bounce");
    score = applyReputationEvent(score, "bounce");
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
