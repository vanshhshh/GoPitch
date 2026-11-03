"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Modal } from "@/components/Modal";

const EMPTY = { name: "", company: "", email: "", phone: "", outreachVolume: "", message: "", website: "", teamSize: "" };

/** Talk to Sales form used on /pricing and the dashboard Billing page. */
export function EnterpriseEnquiryModal({ open, onClose, source }: { open: boolean; onClose: () => void; source: "pricing" | "billing" }) {
  const [form, setForm] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    onClose();
    if (submitted) {
      setSubmitted(false);
      setForm(EMPTY);
    }
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return; // guards against a double submit before the button disables
    setSending(true);
    setError(null);
    try {
      await api.post("/api/leads", { ...form, source });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Modal open={open} onClose={close} labelledBy="enterprise-title">
      {submitted ? (
        <div className="text-center py-6" role="status">
          <div className="text-verified text-4xl mb-4" aria-hidden>
            ✓
          </div>
          <h3 id="enterprise-title" className="font-display text-2xl mb-2">
            Thank you
          </h3>
          <p className="text-ink-soft mb-6">Thank you. Our sales team will contact you soon.</p>
          <button type="button" onClick={close} className="btn-primary">
            Close
          </button>
        </div>
      ) : (
        <>
          <h3 id="enterprise-title" className="font-display text-2xl mb-1">
            Talk to Sales
          </h3>
          <p className="text-ink-soft text-sm mb-6">
            Enterprise is quoted for your volume and requirements — typically from ₹30,000–₹35,000.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Full name *">
              <input required maxLength={120} value={form.name} onChange={set("name")} className="input-field" autoComplete="name" />
            </Field>
            <Field label="Company name *">
              <input required maxLength={200} value={form.company} onChange={set("company")} className="input-field" autoComplete="organization" />
            </Field>
            <Field label="Business email *">
              <input type="email" required value={form.email} onChange={set("email")} className="input-field" placeholder="you@company.com" autoComplete="email" />
            </Field>
            <Field label="Phone number *">
              <input
                type="tel"
                required
                minLength={7}
                maxLength={30}
                value={form.phone}
                onChange={set("phone")}
                className="input-field"
                placeholder="+91 98765 43210"
                autoComplete="tel"
              />
            </Field>
            <Field label="Expected email volume *">
              <select required value={form.outreachVolume} onChange={set("outreachVolume")} className="input-field">
                <option value="">Select volume</option>
                <option value="<500">Under 500 emails/month</option>
                <option value="500-2000">500–2,000 emails/month</option>
                <option value="2000-10000">2,000–10,000 emails/month</option>
                <option value="10000+">10,000+ emails/month</option>
              </select>
            </Field>
            <Field label="Requirements *">
              <textarea
                required
                rows={3}
                maxLength={5000}
                value={form.message}
                onChange={set("message")}
                className="input-field"
                placeholder="How many raises or portfolio companies, timelines, integrations…"
              />
            </Field>
            {error && (
              <p className="text-sm text-danger bg-danger-soft border border-danger/20 rounded px-3 py-2" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={sending} className="btn-primary flex-1">
                {sending ? "Submitting…" : "Submit enquiry"}
              </button>
              <button type="button" onClick={close} className="btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </form>
        </>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label block mb-1.5">{label}</span>
      {children}
    </label>
  );
}
