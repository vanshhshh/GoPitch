"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import Link from "next/link";
import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";
import { api } from "@/lib/api";

interface Tier {
  id: string;
  name: string;
  priceInr: number | null;
  billing: "one_time" | "monthly";
  includes: string[];
}

export default function PricingPage() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [quoteSubmitted, setQuoteSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "", website: "", teamSize: "", outreachVolume: "", message: "" });

  useEffect(() => {
    api.get<Tier[]>("/api/billing/pricing").then(setTiers).catch(() => setTiers([]));
  }, []);

  async function handleQuoteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await api.post("/api/leads", { ...form });
      setQuoteSubmitted(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="max-w-7xl mx-auto px-6 py-20">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
          <h1 className="font-display text-4xl mb-4">Simple, usage-fair pricing</h1>
          <p className="text-ink-soft">No tier ever unlocks spraying every investor in the database. Paying more means better targeting, not more volume.</p>
        </motion.div>

        {tiers === null ? (
          <p className="text-center text-ink-soft text-sm">Loading…</p>
        ) : (
          <div className="grid md:grid-cols-4 gap-6">
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
                {tier.priceInr != null && (
                  <p className="font-mono text-2xl mb-1">
                    ₹{tier.priceInr.toLocaleString()}
                    <span className="text-sm text-ink-soft font-sans"> {tier.billing === "one_time" ? "one-time" : "/mo"}</span>
                  </p>
                )}
                <ul className="space-y-2 my-6 flex-1">
                  {tier.includes.map((item) => (
                    <li key={item} className="text-sm text-ink-soft flex gap-2">
                      <span className="text-verified mt-0.5">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                {tier.id === "ENTERPRISE" ? (
                  <button type="button" onClick={() => setShowQuoteForm(true)} className="btn-primary text-center">
                    Talk to Sales
                  </button>
                ) : tier.priceInr == null ? (
                  <span className="btn-primary text-center block opacity-75 cursor-default">Current plan</span>
                ) : (
                  <Link href="/signup" className={tier.id === "GROWTH" ? "btn-primary text-center" : "btn-secondary text-center"}>
                    Get started
                  </Link>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {showQuoteForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full">
            {!quoteSubmitted ? (
              <>
                <h3 className="font-display text-2xl mb-2">Talk to Sales</h3>
                <p className="text-ink-soft text-sm mb-6">Tell us a little about your company and our sales team will get in touch with you.</p>
                <form onSubmit={handleQuoteSubmit} className="space-y-4">
                  <div>
                    <label className="label block mb-1.5">Full name *</label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="input-field"
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Work email *</label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="input-field"
                      placeholder="you@company.com"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Company name *</label>
                    <input
                      type="text"
                      required
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="input-field"
                      placeholder="Company"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Company website</label>
                    <input
                      type="url"
                      value={form.website}
                      onChange={(e) => setForm({ ...form, website: e.target.value })}
                      className="input-field"
                      placeholder="https://company.com"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Phone number</label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="input-field"
                      placeholder="+91 98765 43210"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Team size</label>
                    <select
                      value={form.teamSize}
                      onChange={(e) => setForm({ ...form, teamSize: e.target.value })}
                      className="input-field"
                    >
                      <option value="">Select team size</option>
                      <option value="1-10">1-10</option>
                      <option value="11-50">11-50</option>
                      <option value="51-200">51-200</option>
                      <option value="201+">201+</option>
                    </select>
                  </div>
                  <div>
                    <label className="label block mb-1.5">Expected outreach volume</label>
                    <select
                      value={form.outreachVolume}
                      onChange={(e) => setForm({ ...form, outreachVolume: e.target.value })}
                      className="input-field"
                    >
                      <option value="">Select volume</option>
                      <option value="<100">&lt;100 emails/month</option>
                      <option value="100-500">100-500 emails/month</option>
                      <option value="500-2000">500-2000 emails/month</option>
                      <option value="2000+">2000+ emails/month</option>
                    </select>
                  </div>
                  <div>
                    <label className="label block mb-1.5">Message / requirements *</label>
                    <textarea
                      required
                      rows={3}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      className="input-field"
                      placeholder="Tell us about your raise, what you need, and any specific requirements..."
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button type="submit" disabled={sending} className="btn-primary flex-1">
                      {sending ? "Submitting…" : "Submit"}
                    </button>
                    <button type="button" onClick={() => { setShowQuoteForm(false); setQuoteSubmitted(false); }} className="btn-secondary flex-1">
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="text-center py-6">
                <div className="text-verified text-4xl mb-4">✓</div>
                <h3 className="font-display text-2xl mb-2">Thank you!</h3>
                <p className="text-ink-soft mb-6">You will be contacted by our sales team soon.</p>
                <button type="button" onClick={() => { setShowQuoteForm(false); setQuoteSubmitted(false); }} className="btn-primary">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <MarketingFooter />
    </div>
  );
}
