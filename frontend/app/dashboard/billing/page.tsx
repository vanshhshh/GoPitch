"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface Tier {
  id: string;
  name: string;
  priceInr: number | null;
  billing: "one_time" | "monthly";
  includes: string[];
}

interface Invoice {
  id: string;
  tier: string;
  amountInr: number;
  status: string;
  createdAt: string;
}

interface Subscription {
  tier: string | null;
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
  cancelledAt: string | null;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export default function BillingPage() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ investorEmailsRemaining: number | null; investorEmailsTotal: number } | null>(null);
  const [showEnterpriseForm, setShowEnterpriseForm] = useState(false);
  const [enterpriseSubmitted, setEnterpriseSubmitted] = useState(false);
  const [enterpriseSending, setEnterpriseSending] = useState(false);
  const [enterpriseForm, setEnterpriseForm] = useState({ name: "", phone: "", email: "", company: "", website: "", teamSize: "", outreachVolume: "", message: "" });

  useEffect(() => {
    api.get<Tier[]>("/api/billing/pricing").then(setTiers);
    api.get<Invoice[]>("/api/billing/invoices").then(setInvoices);
    api.get<Subscription>("/api/billing/subscription").then(setSubscription);
    api.get<{ investorEmailsRemaining: number | null; investorEmailsTotal: number }>("/api/sends/quota").then(setQuota).catch(() => setQuota(null));

    if (!document.getElementById("razorpay-checkout-script")) {
      const script = document.createElement("script");
      script.id = "razorpay-checkout-script";
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      document.body.appendChild(script);
    }
  }, []);

  async function handleCheckout(tier: Tier) {
    setCheckingOut(tier.id);
    try {
      const res = await api.post<{
        mocked: boolean;
        notice?: string;
        orderId?: string;
        amountPaise?: number;
        keyId?: string;
      }>("/api/billing/checkout", { tier: tier.id });

      if (res.mocked) {
        toast(res.notice || "Checkout isn't fully configured yet.");
        return;
      }

      if (!window.Razorpay) {
        toast.error("Payment script hasn't loaded yet — try again in a moment.");
        return;
      }

      const rzp = new window.Razorpay({
        key: res.keyId,
        amount: res.amountPaise,
        currency: "INR",
        name: "GoPitch",
        description: `${tier.name} plan`,
        order_id: res.orderId,
        theme: { color: "#1F6F5C" },
        handler: async () => {
          toast.success("Payment complete — activating your plan.");
          let attempts = 0;
          while (attempts < 15) {
            await new Promise((r) => setTimeout(r, 2000));
            const sub = await api.get<Subscription>("/api/billing/subscription");
            setSubscription(sub);
            if (sub.tier === tier.id && sub.status === "ACTIVE") break;
            attempts++;
          }
          api.get<Invoice[]>("/api/billing/invoices").then(setInvoices);
        },
      });
      rzp.open();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't start checkout.");
    } finally {
      setCheckingOut(null);
    }
  }

  async function handleCancel() {
    try {
      await api.post("/api/billing/cancel", {});
      toast.success("Subscription cancelled.");
      api.get<Subscription>("/api/billing/subscription").then(setSubscription);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't cancel subscription.");
    }
  }

  async function handleEnterpriseSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnterpriseSending(true);
    try {
      await api.post("/api/leads", enterpriseForm);
      setEnterpriseSubmitted(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setEnterpriseSending(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Billing</h1>
      <p className="text-ink-soft text-sm mb-8">
        {subscription?.tier
          ? `Current plan: ${subscription.tier} (${subscription.status})`
          : "No active plan yet."}
      </p>

      {subscription?.tier && subscription.status === "ACTIVE" && subscription.tier !== "FREE" && (
        <button className="btn-secondary text-sm mb-6" onClick={handleCancel}>
          Cancel subscription
        </button>
      )}

      {subscription?.status === "CANCELLED" && subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
        <p className="text-sm text-signal mb-6">
          Cancels on {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
        </p>
      )}

      {quota && subscription?.tier === "FREE" && (
        <div className="card p-5 mb-6">
          <h3 className="font-display text-lg mb-2">Free quota</h3>
          <p className="text-sm text-ink-soft">
            Emails remaining: <span className="font-mono">{quota.investorEmailsRemaining ?? 0}</span> / <span className="font-mono">{quota.investorEmailsTotal}</span>
          </p>
        </div>
      )}

      {tiers === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : (
        <div className="grid md:grid-cols-3 gap-4 mb-10">
          {tiers.map((tier) => {
            const isCurrent = subscription?.tier === tier.id;
            return (
              <div key={tier.id} className="card p-5">
                <h3 className="font-display text-lg mb-1">{tier.name}</h3>
                {tier.priceInr == null ? (
                  <p className="font-mono text-xl mb-3">Talk to Sales</p>
                ) : (
                  <p className="font-mono text-xl mb-3">
                    ₹{tier.priceInr.toLocaleString()}
                    <span className="text-xs text-ink-soft font-sans"> {tier.billing === "one_time" ? "one-time" : "/mo"}</span>
                  </p>
                )}
                {tier.id === "ENTERPRISE" ? (
                  <button type="button" onClick={() => setShowEnterpriseForm(true)} className="btn-primary w-full text-sm">
                    Talk to Sales
                  </button>
                ) : isCurrent ? (
                  <span className="btn-primary w-full text-sm block text-center opacity-75 cursor-default">Current plan</span>
                ) : tier.priceInr == null ? (
                  <span className="btn-primary w-full text-sm block text-center opacity-75 cursor-default">Current plan</span>
                ) : (
                  <button
                    className="btn-primary w-full text-sm"
                    onClick={() => handleCheckout(tier)}
                    disabled={checkingOut === tier.id}
                  >
                    {checkingOut === tier.id ? "Starting…" : "Choose plan"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2 className="font-display text-lg mb-3">Invoice history</h2>
      {invoices === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="text-ink-soft text-sm">No invoices yet.</p>
      ) : (
        <div className="card divide-y divide-line-soft">
          {invoices.map((inv) => (
            <div key={inv.id} className="p-4 flex items-center justify-between text-sm">
              <span>{inv.tier}</span>
              <span className="font-mono">₹{inv.amountInr.toLocaleString()}</span>
              <span className="text-xs text-ink-soft">{new Date(inv.createdAt).toLocaleDateString()}</span>
              <span
                className={`text-[10px] uppercase px-2 py-0.5 rounded ${
                  inv.status === "PAID" ? "bg-verified-soft text-verified" : "bg-line-soft text-ink-soft"
                }`}
              >
                {inv.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {showEnterpriseForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full max-h-[90vh] overflow-y-auto">
            {!enterpriseSubmitted ? (
              <>
                <h3 className="font-display text-2xl mb-2">Talk to Sales</h3>
                <p className="text-ink-soft text-sm mb-6">Tell us a little about your company and our sales team will get in touch with you.</p>
                <form onSubmit={handleEnterpriseSubmit} className="space-y-4">
                  <div>
                    <label className="label block mb-1.5">Full name *</label>
                    <input
                      type="text"
                      required
                      value={enterpriseForm.name}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, name: e.target.value })}
                      className="input-field"
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Work email *</label>
                    <input
                      type="email"
                      required
                      value={enterpriseForm.email}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, email: e.target.value })}
                      className="input-field"
                      placeholder="you@company.com"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Company name *</label>
                    <input
                      type="text"
                      required
                      value={enterpriseForm.company}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, company: e.target.value })}
                      className="input-field"
                      placeholder="Company"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Company website</label>
                    <input
                      type="url"
                      value={enterpriseForm.website}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, website: e.target.value })}
                      className="input-field"
                      placeholder="https://company.com"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Phone number</label>
                    <input
                      type="tel"
                      value={enterpriseForm.phone}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, phone: e.target.value })}
                      className="input-field"
                      placeholder="+91 98765 43210"
                    />
                  </div>
                  <div>
                    <label className="label block mb-1.5">Team size</label>
                    <select
                      value={enterpriseForm.teamSize}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, teamSize: e.target.value })}
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
                      value={enterpriseForm.outreachVolume}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, outreachVolume: e.target.value })}
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
                      value={enterpriseForm.message}
                      onChange={(e) => setEnterpriseForm({ ...enterpriseForm, message: e.target.value })}
                      className="input-field"
                      placeholder="Tell us about your raise, what you need, and any specific requirements..."
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button type="submit" disabled={enterpriseSending} className="btn-primary flex-1">
                      {enterpriseSending ? "Submitting…" : "Submit"}
                    </button>
                    <button type="button" onClick={() => { setShowEnterpriseForm(false); setEnterpriseSubmitted(false); }} className="btn-secondary flex-1">
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
                <button type="button" onClick={() => { setShowEnterpriseForm(false); setEnterpriseSubmitted(false); }} className="btn-primary">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
