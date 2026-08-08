"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MatchStamp } from "@/components/MatchStamp";
import { getStoredUser } from "@/lib/api";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.08 } }),
};

const FEATURES = [
  {
    title: "Deck, guided",
    body: "Answer a structured interview about your product, traction, and team. Get a deck in your own words, not a template.",
  },
  {
    title: "Scored investor matches",
    body: "Every match shows why — stage fit, sector overlap, check size, and whether they've already replied to you before.",
  },
  {
    title: "Personalized outreach",
    body: "Each investor gets an email grounded in real fit reasons, not a mail-merge with {{firstName}}.",
  },
  {
    title: "Safe sending, by design",
    body: "Your own Gmail, warmed up gradually, with hard stops on bounces and spam complaints — never risking your real inbox.",
  },
];

const FAQS = [
  {
    q: "Does this replace warm intros?",
    a: "No. Warm intros still convert better than any cold outreach. GoPitch is for building a credible, scored pipeline beyond the handful of people you already know.",
  },
  {
    q: "Do you guarantee investor replies?",
    a: "No platform can promise that, and we won't pretend otherwise. What we do is remove the manual grind of research and personalization so your time goes into the conversations that do land.",
  },
  {
    q: "How is the investor database sourced?",
    a: "From verified contact data, continuously enriched. Investors without real stage/sector/geography data are excluded from matching until enriched — we don't show you a fabricated fit.",
  },
  {
    q: "Can I use my own deck?",
    a: "Yes — upload a PPTX or PDF at any point and it's used everywhere a deck is referenced.",
  },
];

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    const user = getStoredUser();
    if (user?.role === "ADMIN") router.replace("/admin");
    else if (user) router.replace("/dashboard");
  }, [router]);

  return (
    <div className="min-h-screen">
      <MarketingNav />
      <Hero />
      <SocialProofStrip />
      <Features />
      <HowItWorks />
      <Testimonials />
      <PricingTeaser />
      <FAQ />
      <FinalCTA />
      <MarketingFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
      <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}>
        <span className="inline-block text-xs font-medium text-verified bg-verified-soft px-3 py-1 rounded-full mb-6">
          Now with real-time investor matching
        </span>
      </motion.div>
      <motion.h1
        variants={fadeUp}
        initial="hidden"
        animate="show"
        custom={1}
        className="font-display text-4xl md:text-6xl leading-tight mb-6"
      >
        Raise smarter.
        <br />
        Not just louder.
      </motion.h1>
      <motion.p
        variants={fadeUp}
        initial="hidden"
        animate="show"
        custom={2}
        className="text-ink-soft text-lg max-w-xl mx-auto mb-10"
      >
        Generate your deck, get matched with investors who actually fit your stage and thesis, and
        send outreach that reads like you wrote it — because you did.
      </motion.p>
      <motion.div variants={fadeUp} initial="hidden" animate="show" custom={3} className="flex items-center justify-center gap-4">
        <Link href="/signup" className="btn-primary text-base px-6 py-3">
          Start your raise
        </Link>
        <Link href="/features" className="btn-secondary text-base px-6 py-3">
          See how it works
        </Link>
      </motion.div>

      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        custom={4}
        className="mt-16 card p-6 max-w-md mx-auto text-left"
      >
        <div className="flex items-center gap-3 mb-4">
          <MatchStamp score={82} size={40} />
          <div>
            <p className="text-sm font-medium">Rishen Kapoor · Peak XV Partners</p>
            <p className="text-xs text-ink-soft">Sector thesis overlap: fintech, cross-border</p>
          </div>
        </div>
        <div className="h-px bg-line-soft mb-4" />
        <div className="flex items-center gap-3">
          <MatchStamp score={58} size={40} />
          <div>
            <p className="text-sm font-medium">Sarita Rao · Blume Ventures</p>
            <p className="text-xs text-ink-soft">Invests directly at seed stage</p>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function SocialProofStrip() {
  return (
    <section className="border-y border-line bg-white py-6">
      <div className="max-w-4xl mx-auto px-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-2 text-sm text-ink-soft">
        <span>Built by founders who raised with the same system</span>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="max-w-5xl mx-auto px-6 py-20">
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="font-display text-3xl text-center mb-12"
      >
        Everything a raise actually needs
      </motion.h2>
      <div className="grid md:grid-cols-2 gap-5">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.08 }}
            className="card p-6"
          >
            <h3 className="font-display text-lg mb-2">{f.title}</h3>
            <p className="text-sm text-ink-soft leading-relaxed">{f.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", t: "Tell us about your company", d: "Stage, sector, traction — a structured interview, not a blank page." },
    { n: "02", t: "Get matched investors", d: "Scored against real fit criteria, with the reasoning shown." },
    { n: "03", t: "Send outreach safely", d: "Connect Gmail, review each draft, send at a rate that protects your account." },
  ];
  return (
    <section className="bg-white border-y border-line py-20">
      <div className="max-w-4xl mx-auto px-6">
        <h2 className="font-display text-3xl text-center mb-12">Three steps, not thirty</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <p className="font-mono text-verified text-sm mb-2">{s.n}</p>
              <h3 className="font-display text-lg mb-2">{s.t}</h3>
              <p className="text-sm text-ink-soft">{s.d}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const quotes = [
    { name: "Early user", role: "Fintech founder, seed stage", quote: "The matching reasoning is what sold me — I could see exactly why each investor was on the list." },
    { name: "Early user", role: "B2B SaaS founder, pre-seed", quote: "Uploaded my own deck and it just worked everywhere — no forced regeneration." },
  ];
  return (
    <section className="max-w-4xl mx-auto px-6 py-20">
      <h2 className="font-display text-3xl text-center mb-12">What founders say</h2>
      <div className="grid md:grid-cols-2 gap-5">
        {quotes.map((q, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="card p-6"
          >
            <p className="text-sm leading-relaxed mb-4">"{q.quote}"</p>
            <p className="text-xs text-ink-soft">
              {q.name} · {q.role}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function PricingTeaser() {
  return (
    <section className="bg-white border-y border-line py-20">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <h2 className="font-display text-3xl mb-4">Simple, usage-fair pricing</h2>
        <p className="text-ink-soft mb-8">Start with one raise. Scale up only if you need to.</p>
        <Link href="/pricing" className="btn-primary text-base px-6 py-3">
          View pricing
        </Link>
      </div>
    </section>
  );
}

function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  return (
    <section className="max-w-3xl mx-auto px-6 py-20">
      <h2 className="font-display text-3xl text-center mb-12">Questions, answered honestly</h2>
      <div className="space-y-3">
        {FAQS.map((item, i) => (
          <div key={item.q} className="card p-5">
            <button
              className="w-full flex items-center justify-between text-left"
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
            >
              <span className="font-medium text-sm">{item.q}</span>
              <span className="text-ink-soft">{openIndex === i ? "−" : "+"}</span>
            </button>
            {openIndex === i && <p className="text-sm text-ink-soft mt-3 leading-relaxed">{item.a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="max-w-3xl mx-auto px-6 py-20 text-center">
      <h2 className="font-display text-3xl mb-4">Ready to start?</h2>
      <p className="text-ink-soft mb-8">No credit card for the first deck and match list.</p>
      <Link href="/signup" className="btn-primary text-base px-8 py-3">
        Start your raise
      </Link>
    </section>
  );
}
