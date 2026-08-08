"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface Tier {
  id: string;
  name: string;
  priceInr: number;
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
  currentPeriodEnd: string | null;
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

  useEffect(() => {
    api.get<Tier[]>("/api/billing/pricing").then(setTiers);
    api.get<Invoice[]>("/api/billing/invoices").then(setInvoices);
    api.get<Subscription>("/api/billing/subscription").then(setSubscription);

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
        handler: () => {
          toast.success("Payment complete — activating your plan.");
          setTimeout(() => {
            api.get<Subscription>("/api/billing/subscription").then(setSubscription);
            api.get<Invoice[]>("/api/billing/invoices").then(setInvoices);
          }, 2000); // webhook needs a moment to land
        },
      });
      rzp.open();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't start checkout.");
    } finally {
      setCheckingOut(null);
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

      {tiers === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : (
        <div className="grid md:grid-cols-3 gap-4 mb-10">
          {tiers.map((tier) => (
            <div key={tier.id} className="card p-5">
              <h3 className="font-display text-lg mb-1">{tier.name}</h3>
              <p className="font-mono text-xl mb-3">
                ₹{tier.priceInr.toLocaleString()}
                <span className="text-xs text-ink-soft font-sans"> {tier.billing === "one_time" ? "one-time" : "/mo"}</span>
              </p>
              <button
                className="btn-primary w-full text-sm"
                onClick={() => handleCheckout(tier)}
                disabled={checkingOut === tier.id || subscription?.tier === tier.id}
              >
                {subscription?.tier === tier.id ? "Current plan" : checkingOut === tier.id ? "Starting…" : "Choose plan"}
              </button>
            </div>
          ))}
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
    </div>
  );
}
