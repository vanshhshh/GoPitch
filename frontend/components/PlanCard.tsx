export interface Tier {
  id: "FREE" | "STARTER" | "GROWTH" | "ENTERPRISE";
  name: string;
  priceInr: number | null;
  billing: "one_time" | "monthly";
  priceNote?: string;
  includes: string[];
}

/** Same price presentation on /pricing and the dashboard Billing page. */
export function PlanPrice({ tier }: { tier: Tier }) {
  if (tier.priceInr != null) {
    return (
      <p className="font-mono text-2xl mb-1">
        ₹{tier.priceInr.toLocaleString("en-IN")}
        <span className="text-sm text-ink-soft font-sans"> {tier.billing === "one_time" ? "one-time" : "/ month"}</span>
      </p>
    );
  }
  if (tier.id === "FREE") return <p className="font-mono text-2xl mb-1">₹0</p>;
  return (
    <>
      <p className="font-mono text-2xl mb-1">Custom quote</p>
      {tier.priceNote && <p className="text-xs text-ink-soft">{tier.priceNote.replace(/^Custom quote · /, "")}</p>}
    </>
  );
}

export function PlanCard({ tier, action, highlight, badge, compact }: { tier: Tier; action: React.ReactNode; highlight?: boolean; badge?: string; compact?: boolean }) {
  return (
    <div className={`card p-5 flex flex-col ${highlight ? "border-verified border-2" : ""}`}>
      {badge && <span className="text-[10px] uppercase tracking-wide text-verified bg-verified-soft px-2 py-0.5 rounded self-start mb-3">{badge}</span>}
      <h3 className="font-display text-xl mb-1">{tier.name}</h3>
      <div className="min-h-[3.5rem]">
        <PlanPrice tier={tier} />
      </div>
      <ul className={`space-y-2 ${compact ? "my-4" : "my-6"} flex-1`}>
        {tier.includes.map((item) => (
          <li key={item} className="text-sm text-ink-soft flex gap-2">
            <span className="text-verified mt-0.5" aria-hidden>
              ✓
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {action}
    </div>
  );
}
