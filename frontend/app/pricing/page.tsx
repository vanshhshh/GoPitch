"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";
import { EnterpriseEnquiryModal } from "@/components/EnterpriseEnquiryModal";
import { PlanCard, Tier } from "@/components/PlanCard";
import { api } from "@/lib/api";

export default function PricingPage() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [showQuoteForm, setShowQuoteForm] = useState(false);

  useEffect(() => {
    api
      .get<Tier[]>("/api/billing/pricing")
      .then(setTiers)
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12 sm:mb-16">
          <h1 className="font-display text-3xl sm:text-4xl mb-4">Simple, usage-fair pricing</h1>
          <p className="text-ink-soft max-w-2xl mx-auto">
            No tier ever unlocks spraying every investor in the database. Paying more means more matched investors you can reach, not spammier sending.
            Prices in INR.
          </p>
        </motion.div>

        {failed ? (
          <p className="text-center text-sm text-ink-soft">
            Pricing couldn't load right now. Please refresh, or{" "}
            <Link href="/contact" className="text-verified hover:underline">
              contact us
            </Link>
            .
          </p>
        ) : tiers === null ? (
          <p className="text-center text-ink-soft text-sm">Loading…</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {tiers.map((tier, i) => (
              <motion.div key={tier.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="flex">
                <div className="flex-1 flex">
                  <div className="flex-1 [&>div]:h-full">
                    <PlanCard
                      tier={tier}
                      highlight={tier.id === "GROWTH"}
                      badge={tier.id === "GROWTH" ? "Most popular" : undefined}
                      action={
                        tier.id === "ENTERPRISE" ? (
                          <button type="button" onClick={() => setShowQuoteForm(true)} className="btn-primary text-center">
                            Talk to Sales
                          </button>
                        ) : (
                          <Link href="/signup" className={tier.id === "GROWTH" ? "btn-primary text-center" : "btn-secondary text-center"}>
                            {tier.id === "FREE" ? "Start free" : "Get started"}
                          </Link>
                        )
                      }
                    />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-soft text-center mt-8">
          Every plan sends from your own Gmail with the same safe warm-up: 50 emails/day for the first 3 days, then up to 150/day.
        </p>
      </main>

      <EnterpriseEnquiryModal open={showQuoteForm} onClose={() => setShowQuoteForm(false)} source="pricing" />
      <MarketingFooter />
    </div>
  );
}
