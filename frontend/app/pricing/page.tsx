"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";
import { api } from "@/lib/api";

interface Tier {
  id: string;
  name: string;
  priceInr: number;
  billing: "one_time" | "monthly";
  includes: string[];
}

export default function PricingPage() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);

  useEffect(() => {
    api.get<Tier[]>("/api/billing/pricing").then(setTiers).catch(() => setTiers([]));
  }, []);

  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="max-w-5xl mx-auto px-6 py-20">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
          <h1 className="font-display text-4xl mb-4">Simple, usage-fair pricing</h1>
          <p className="text-ink-soft">No tier ever unlocks spraying every investor in the database. Paying more means better targeting, not more volume.</p>
        </motion.div>

        {tiers === null ? (
          <p className="text-center text-ink-soft text-sm">Loading…</p>
        ) : (
          <div className="grid md:grid-cols-3 gap-6">
            {tiers.map((tier, i) => (
              <motion.div
                key={tier.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className={`card p-6 flex flex-col ${tier.id === "GROWTH" ? "border-verified border-2" : ""}`}
              >
                {tier.id === "GROWTH" && (
                  <span className="text-[10px] uppercase tracking-wide text-verified bg-verified-soft px-2 py-0.5 rounded self-start mb-3">
                    Most popular
                  </span>
                )}
                <h3 className="font-display text-xl mb-1">{tier.name}</h3>
                <p className="font-mono text-2xl mb-1">
                  ₹{tier.priceInr.toLocaleString()}
                  <span className="text-sm text-ink-soft font-sans"> {tier.billing === "one_time" ? "one-time" : "/mo"}</span>
                </p>
                <ul className="space-y-2 my-6 flex-1">
                  {tier.includes.map((item) => (
                    <li key={item} className="text-sm text-ink-soft flex gap-2">
                      <span className="text-verified mt-0.5">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className={tier.id === "GROWTH" ? "btn-primary text-center" : "btn-secondary text-center"}>
                  Get started
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}
