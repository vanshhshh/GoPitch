"use client";

import Link from "next/link";
import { Modal } from "@/components/Modal";

/**
 * Shown when the plan's email allowance is used up. Dismissible — dismissing only hides
 * the prompt; the backend still refuses new campaigns and sends until the plan changes.
 */
export function UpgradePrompt({ open, onClose, tier, limit }: { open: boolean; onClose: () => void; tier: string; limit: number }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="upgrade-title">
      <h3 id="upgrade-title" className="font-display text-2xl mb-2">
        You've used your {limit} {tier === "FREE" ? "free " : ""}emails
      </h3>
      <p className="text-sm text-ink-soft mb-6">
        {tier === "FREE"
          ? "New campaigns and sends are paused on the Free plan. Upgrade to Starter or Growth to reach more matched investors. Your existing campaigns, drafts and outreach history stay as they are."
          : "Your current plan's email allowance is used up. Upgrade or renew to keep sending. Your history stays as it is."}
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <Link href="/dashboard/billing" className="btn-primary text-center flex-1" onClick={onClose}>
          See plans
        </Link>
        <button type="button" className="btn-secondary flex-1" onClick={onClose}>
          Not now
        </button>
      </div>
    </Modal>
  );
}
