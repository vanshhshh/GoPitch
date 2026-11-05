"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ChevronDown, Gauge, Mail, ShieldCheck } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";
import { EnterpriseEnquiryModal } from "@/components/EnterpriseEnquiryModal";
import { PlanCard, Tier } from "@/components/PlanCard";
import { api } from "@/lib/api";

const PROMISES = [
  {
    icon: Mail,
    title: "Sends from your own Gmail",
    body: "Investors see a real email from you, not a marketing platform. Replies land in your inbox.",
  },
  {
    icon: Gauge,
    title: "Safe warm-up on every plan",
    body: "50 emails/day for the first 3 days, then up to 150/day, so your domain's reputation stays intact.",
  },
  {
    icon: ShieldCheck,
    title: "Matched, not mass-mailed",
    body: "No plan unlocks blasting the whole database. Paying more gets you more well-matched investors.",
  },
];

const FAQ = [
  {
    q: "What's the difference between one-time and monthly?",
    a: "Starter is a single payment that never expires. It's built for one focused raise. Growth covers 30 days per payment and adds follow-ups, reply tracking and unlimited deck revisions, for founders who are actively raising week after week.",
  },
  {
    q: "What happens when my Growth period ends?",
    a: "You can renew from Billing at any time to add another 30 days. If you don't, you keep Growth until the end of the paid period, and your account then moves to Free.",
  },
  {
    q: "Can I start free and upgrade later?",
    a: "Yes. Every account starts on Free. You can upgrade from the Billing page in your dashboard whenever you're ready, and the new plan applies as soon as your payment is confirmed.",
  },
  {
    q: "How do I pay?",
    a: "Payments are in INR and processed securely by Razorpay. GoPitch never sees or stores your card details.",
  },
  {
    q: "Do you offer plans for accelerators or agencies?",
    a: "Yes. Enterprise covers multiple companies under one account, hands-on list curation and higher send volume. Talk to sales for a quote.",
  },
];

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
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-14 sm:mb-16">
          <p className="label text-verified mb-3">Pricing</p>
          <h1 className="font-display text-4xl sm:text-5xl mb-4 tracking-tight">Pay for better matches, not more spam</h1>
          <p className="text-ink-soft text-base sm:text-lg max-w-2xl mx-auto">
            Start free with your own deck. Upgrade when you want AI-built decks, more matched investors and ongoing campaign management. All prices in INR.
          </p>
        </motion.div>

        {failed ? (
          <div className="card p-8 text-center max-w-md mx-auto">
            <p className="text-sm text-ink-soft">
              Pricing couldn't load right now. Please refresh, or{" "}
              <Link href="/contact" className="text-verified hover:underline">
                contact us
              </Link>
              .
            </p>
          </div>
        ) : tiers === null ? (
          <div role="status" aria-label="Loading plans" className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="card p-6 h-[30rem] animate-shimmer">
                <div className="h-5 bg-line-soft rounded w-1/3 mb-3" />
                <div className="h-3 bg-line-soft rounded w-2/3 mb-8" />
                <div className="h-8 bg-line-soft rounded w-1/2 mb-6" />
                <div className="h-9 bg-line-soft rounded w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-3">
            {tiers.map((tier, i) => (
              <motion.div key={tier.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                <PlanCard
                  tier={tier}
                  highlight={tier.id === "GROWTH"}
                  badge={tier.id === "GROWTH" ? "Most popular" : undefined}
                  action={
                    tier.id === "ENTERPRISE" ? (
                      <button type="button" onClick={() => setShowQuoteForm(true)} className="btn-secondary text-center">
                        Talk to Sales
                      </button>
                    ) : (
                      <Link href="/signup" className={`${tier.id === "GROWTH" ? "btn-primary" : "btn-secondary"} text-center`}>
                        {tier.id === "FREE" ? "Start free" : `Get ${tier.name}`}
                      </Link>
                    )
                  }
                />
              </motion.div>
            ))}
          </div>
        )}

        <section aria-label="Included on every plan" className="mt-16 sm:mt-20 grid md:grid-cols-3 gap-4">
          {PROMISES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg bg-surface-muted p-5 flex gap-4">
              <span className="w-9 h-9 shrink-0 rounded-full bg-white text-verified flex items-center justify-center shadow-subtle" aria-hidden>
                <Icon size={16} />
              </span>
              <div>
                <p className="font-medium text-navy text-sm">{title}</p>
                <p className="text-sm text-ink-soft mt-1">{body}</p>
              </div>
            </div>
          ))}
        </section>

        <section aria-labelledby="pricing-faq" className="mt-20 max-w-3xl mx-auto">
          <h2 id="pricing-faq" className="font-display text-2xl sm:text-3xl text-center mb-8">
            Questions, answered
          </h2>
          <div className="card divide-y divide-line-soft">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group px-5 py-4">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <span className="font-medium text-navy text-sm sm:text-base">{q}</span>
                  <ChevronDown size={16} className="text-ink-soft shrink-0 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="text-sm text-ink-soft mt-3 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
          <p className="text-sm text-ink-soft text-center mt-8">
            Still deciding?{" "}
            <Link href="/contact" className="text-verified hover:underline">
              Ask us anything
            </Link>
            .
          </p>
        </section>
      </main>

      <EnterpriseEnquiryModal open={showQuoteForm} onClose={() => setShowQuoteForm(false)} source="pricing" />
      <MarketingFooter />
    </div>
  );
}
