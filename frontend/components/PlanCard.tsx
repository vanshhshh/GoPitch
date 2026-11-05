import { Check } from "lucide-react";

export interface Tier {
  id: "FREE" | "STARTER" | "GROWTH" | "ENTERPRISE";
  name: string;
  priceInr: number | null;
  billing: "one_time" | "monthly";
  priceNote?: string;
  includes: string[];
}

/** One-line positioning shown under each plan name. */
export const TIER_TAGLINE: Record<Tier["id"], string> = {
  FREE: "Try GoPitch with your own deck.",
  STARTER: "Everything you need for one focused raise.",
  GROWTH: "For an active raise you keep working every week.",
  ENTERPRISE: "For studios, accelerators and multi-company teams.",
};

/** Same price presentation on /pricing and the dashboard Billing page. */
export function PlanPrice({ tier }: { tier: Tier }) {
  if (tier.priceInr != null) {
    return (
      <div>
        <p className="flex items-baseline gap-1.5">
          <span className="font-mono text-3xl tracking-tight text-navy">₹{tier.priceInr.toLocaleString("en-IN")}</span>
          <span className="text-sm text-ink-soft">{tier.billing === "one_time" ? "one-time" : "/ month"}</span>
        </p>
        <p className="text-xs text-ink-soft mt-1">{tier.billing === "one_time" ? "Pay once. Never expires." : "Covers 30 days. No lock-in."}</p>
      </div>
    );
  }
  if (tier.id === "FREE") {
    return (
      <div>
        <p className="font-mono text-3xl tracking-tight text-navy">₹0</p>
        <p className="text-xs text-ink-soft mt-1">No card required.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="font-display text-3xl text-navy leading-tight">Custom</p>
      {tier.priceNote && <p className="text-xs text-ink-soft mt-1">{tier.priceNote.replace(/^Custom quote · /, "")}</p>}
    </div>
  );
}

export function PlanCard({
  tier,
  action,
  highlight,
  badge,
  compact,
}: {
  tier: Tier;
  action: React.ReactNode;
  highlight?: boolean;
  badge?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative h-full rounded-lg border bg-white flex flex-col transition-shadow ${
        highlight ? "border-verified ring-1 ring-verified shadow-card" : "border-line shadow-subtle hover:shadow-card"
      } ${compact ? "p-5" : "p-6"}`}
    >
      {badge && (
        <span className="absolute -top-3 left-6 text-[10px] font-medium uppercase tracking-wider text-white bg-verified px-2.5 py-1 rounded-full shadow-subtle">
          {badge}
        </span>
      )}

      <h3 className="font-display text-xl">{tier.name}</h3>
      <p className={`text-sm text-ink-soft mt-1 ${compact ? "min-h-[2.5rem]" : "min-h-[2.75rem]"}`}>{TIER_TAGLINE[tier.id]}</p>

      <div className={`${compact ? "mt-3 min-h-[4rem]" : "mt-5 min-h-[4.25rem]"}`}>
        <PlanPrice tier={tier} />
      </div>

      <div className={`${compact ? "mt-4" : "mt-5"} flex flex-col`}>{action}</div>

      <div className={`border-t border-line-soft ${compact ? "mt-5 pt-4" : "mt-6 pt-5"} flex-1`}>
        <ul className="space-y-2.5">
          {tier.includes.map((item) => {
            const inherits = /^Everything in /.test(item);
            return (
              <li key={item} className={`text-sm flex gap-2.5 ${inherits ? "text-navy font-medium" : "text-ink-soft"}`}>
                <span
                  className={`mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center ${highlight ? "bg-verified text-white" : "bg-verified-soft text-verified"}`}
                  aria-hidden
                >
                  <Check size={10} strokeWidth={3} />
                </span>
                <span>{item}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
