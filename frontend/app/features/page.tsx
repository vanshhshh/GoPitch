"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";

const SECTIONS = [
  {
    title: "Deck generation, or bring your own",
    body: "Answer a structured interview — problem, solution, traction, team, ask — and get deck copy grounded in what you actually said, not generic filler. Prefer your own deck? Upload a PPTX or PDF and it's used everywhere a deck is referenced, no forced regeneration.",
  },
  {
    title: "Investor matching that shows its work",
    body: "Every match is scored on stage fit, sector/thesis overlap, geography, check size, and whether that investor has already replied to you before. You see the reasons, not just a number — and investors without real fit data are excluded, never guessed at.",
  },
  {
    title: "Personalized outreach at the pace that protects you",
    body: "Each email references real fit reasons for that specific investor. Sending runs through your own connected Gmail, with a gradual warm-up ramp and automatic pauses on bounces or spam complaints — so your real inbox is never the cost of testing this.",
  },
  {
    title: "A campaign view that stays honest",
    body: "Track what's sent, what bounced, what got a reply. Nothing is marked delivered until it actually is, and nothing gets re-sent to an investor who already passed.",
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="max-w-3xl mx-auto px-6 py-20">
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="font-display text-4xl mb-4">
          Built for the actual mechanics of raising
        </motion.h1>
        <p className="text-ink-soft mb-16">Not a generic outreach tool wearing a fundraising skin.</p>

        <div className="space-y-12">
          {SECTIONS.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
            >
              <h2 className="font-display text-xl mb-2">{s.title}</h2>
              <p className="text-ink-soft leading-relaxed">{s.body}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-16 text-center">
          <Link href="/signup" className="btn-primary text-base px-6 py-3">
            Start your raise
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
