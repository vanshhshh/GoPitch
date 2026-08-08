"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { MarketingNav } from "@/components/MarketingNav";
import { MarketingFooter } from "@/components/MarketingFooter";
import { api, ApiError } from "@/lib/api";

export default function ContactPage() {
  const [form, setForm] = useState({ email: "", subject: "", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await api.post("/api/admin/contact", form);
      setSent(true);
      toast.success("Message sent — we'll get back to you.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen">
      <MarketingNav />
      <main className="max-w-lg mx-auto px-6 py-20">
        <h1 className="font-display text-4xl mb-4">Get in touch</h1>
        <p className="text-ink-soft mb-10">Questions, feedback, or something broken — tell us directly.</p>

        {sent ? (
          <div className="card p-6 text-center animate-fade-up">
            <p className="text-verified font-medium mb-1">Message received.</p>
            <p className="text-sm text-ink-soft">We read every one of these ourselves.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label block mb-1.5">Your email</label>
              <input
                type="email"
                required
                className="input-field"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label block mb-1.5">Subject</label>
              <input
                type="text"
                required
                className="input-field"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </div>
            <div>
              <label className="label block mb-1.5">Message</label>
              <textarea
                required
                rows={5}
                className="input-field"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </div>
            <button type="submit" disabled={sending} className="btn-primary w-full">
              {sending ? "Sending…" : "Send message"}
            </button>
          </form>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}
