"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { EnterpriseEnquiryModal } from "@/components/EnterpriseEnquiryModal";
import { PlanCard, Tier } from "@/components/PlanCard";

interface Invoice {
  id: string;
  tier: string;
  amountInr: number;
  status: "CREATED" | "PAID" | "FAILED" | "REFUNDED" | "EXPIRED";
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface Subscription {
  entitlementTier: "FREE" | "STARTER" | "GROWTH" | "ENTERPRISE";
  tier: string | null;
  status: string | null;
  isPaidActive: boolean;
  billing: "one_time" | "monthly" | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lapsed: boolean;
}

interface Quota {
  investorEmailsTotal: number;
  investorEmailsSent: number;
  investorEmailsQueued: number;
  investorEmailsRemaining: number;
  quotaExhausted: boolean;
}

const INVOICE_LABEL: Record<Invoice["status"], { text: string; cls: string }> = {
  CREATED: { text: "Awaiting payment", cls: "bg-line-soft text-ink-soft" },
  PAID: { text: "Paid", cls: "bg-verified-soft text-verified" },
  FAILED: { text: "Failed", cls: "bg-danger-soft text-danger" },
  REFUNDED: { text: "Refunded", cls: "bg-signal-soft text-signal" },
  EXPIRED: { text: "Not completed", cls: "bg-line-soft text-ink-soft" },
};

const RANK: Record<string, number> = { FREE: 0, STARTER: 1, GROWTH: 2, ENTERPRISE: 3 };

declare global {
  interface Window {
    Razorpay: any;
  }
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    let script = document.getElementById("razorpay-checkout-script") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "razorpay-checkout-script";
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      document.body.appendChild(script);
    }
    script.addEventListener("load", () => resolve(true));
    script.addEventListener("error", () => resolve(false));
    setTimeout(() => resolve(!!window.Razorpay), 10_000);
  });
}

export default function BillingPage() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [showEnterprise, setShowEnterprise] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [t, inv, sub] = await Promise.all([
        api.get<Tier[]>("/api/billing/pricing"),
        api.get<Invoice[]>("/api/billing/invoices"),
        api.get<Subscription>("/api/billing/subscription"),
      ]);
      setTiers(t);
      setInvoices(inv);
      setSubscription(sub);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load billing."));
    }
    api.get<Quota>("/api/sends/quota").then(setQuota).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    loadRazorpay();
  }, [refresh]);

  /** After Checkout reports success, the server confirms with Razorpay before activating. */
  async function confirmPayment(tier: Tier, response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    setActivating(true);
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await api.post<{ status: string; subscription: Subscription }>("/api/billing/verify", {
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        });
        setSubscription(res.subscription);
        if (res.subscription.entitlementTier === tier.id || res.status === "activated" || res.status === "already_paid") {
          toast.success(`${tier.name} plan is active.`);
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      toast("Payment received — activation is taking longer than usual. It will appear here automatically; refresh in a minute.", { duration: 10000 });
    } catch (err) {
      toast.error(errorMessage(err, "We couldn't confirm the payment. If you were charged, it will be applied automatically or refunded — contact support."), {
        duration: 10000,
      });
    } finally {
      setActivating(false);
      refresh();
    }
  }

  async function handleCheckout(tier: Tier) {
    setCheckingOut(tier.id);
    try {
      const res = await api.post<{ orderId: string; amountPaise: number; keyId: string }>("/api/billing/checkout", { tier: tier.id });
      if (!(await loadRazorpay())) {
        toast.error("The payment window couldn't load. Check your connection or ad blocker and try again.");
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
        handler: (response: any) => confirmPayment(tier, response),
        modal: {
          // Closing the window is not a cancellation: a UPI payment may still complete.
          ondismiss: () => {
            toast("Payment window closed. If you completed the payment, your plan will activate automatically.");
            refresh();
          },
        },
      });
      rzp.on("payment.failed", (resp: any) => {
        toast.error(resp?.error?.description || "Payment failed. You haven't been charged — try again or use another method.");
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
      const res = await api.post<{ subscription: Subscription }>("/api/billing/cancel", {});
      setSubscription(res.subscription);
      toast.success("Your plan won't renew. You keep access until the end of the paid period.");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't cancel."));
    } finally {
      setConfirmCancel(false);
    }
  }

  if (loadError) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10">
        <p className="text-sm text-danger mb-3">{loadError}</p>
        <button className="btn-secondary" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  }

  const current = subscription?.entitlementTier ?? "FREE";
  const currentTier = tiers?.find((t) => t.id === current);
  const periodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Billing</h1>

      {subscription && (
        <div className="card p-5 mb-8 mt-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="label mb-1">Current plan</p>
              <p className="font-display text-xl">{currentTier?.name ?? current}</p>
              <p className="text-sm text-ink-soft mt-1">
                {current === "FREE"
                  ? subscription.lapsed
                    ? "Your previous paid plan has ended, so your account is on Free."
                    : "Free plan — no payment needed."
                  : subscription.billing === "one_time"
                    ? "One-time purchase — doesn't renew or expire."
                    : subscription.cancelAtPeriodEnd
                      ? `Ends on ${periodEnd}. It won't renew.`
                      : `Active until ${periodEnd}. Renew any time before then to extend by 30 days.`}
              </p>
            </div>
            {quota && (
              <div className="sm:text-right">
                <p className="label mb-1">Emails in this plan</p>
                <p className="font-mono text-lg">
                  {quota.investorEmailsRemaining} <span className="text-ink-soft text-sm">left of {quota.investorEmailsTotal}</span>
                </p>
                <p className="text-xs text-ink-soft">
                  {quota.investorEmailsSent} sent · {quota.investorEmailsQueued} queued
                </p>
              </div>
            )}
          </div>
          {quota?.quotaExhausted && <p className="text-sm text-danger mt-4">You've used every email in your plan. Choose a plan below to keep sending.</p>}
          {activating && <p className="text-sm text-signal mt-4">Confirming your payment with Razorpay…</p>}
          {subscription.isPaidActive && subscription.billing === "monthly" && !subscription.cancelAtPeriodEnd && (
            <div className="mt-4 pt-4 border-t border-line-soft">
              {confirmCancel ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>Stop renewal? You keep {currentTier?.name} until {periodEnd}.</span>
                  <button className="btn-secondary text-xs text-danger" onClick={handleCancel}>
                    Yes, cancel renewal
                  </button>
                  <button className="text-xs text-ink-soft hover:text-ink" onClick={() => setConfirmCancel(false)}>
                    Keep plan
                  </button>
                </div>
              ) : (
                <button className="text-xs text-ink-soft hover:text-danger" onClick={() => setConfirmCancel(true)}>
                  Cancel renewal
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {tiers === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {tiers.map((tier) => {
            const isCurrent = tier.id === current;
            const isLower = RANK[tier.id]! < RANK[current]!;
            let action: React.ReactNode;
            if (tier.id === "ENTERPRISE") {
              action = isCurrent ? (
                <CurrentBadge />
              ) : (
                <button type="button" onClick={() => setShowEnterprise(true)} className="btn-primary w-full text-sm">
                  Talk to Sales
                </button>
              );
            } else if (tier.id === "FREE") {
              action = isCurrent ? <CurrentBadge /> : <p className="text-xs text-ink-soft text-center">Included with every account</p>;
            } else if (isLower) {
              action = <p className="text-xs text-ink-soft text-center">Included in your plan</p>;
            } else {
              const renew = isCurrent && tier.billing === "monthly";
              action =
                isCurrent && !renew ? (
                  <CurrentBadge />
                ) : (
                  <button className="btn-primary w-full text-sm" onClick={() => handleCheckout(tier)} disabled={!!checkingOut || activating}>
                    {checkingOut === tier.id ? "Opening checkout…" : renew ? "Renew for 30 days" : `Upgrade to ${tier.name}`}
                  </button>
                );
            }
            return <PlanCard key={tier.id} tier={tier} highlight={isCurrent} action={action} compact />;
          })}
        </div>
      )}

      <h2 className="font-display text-lg mb-3">Payment history</h2>
      {invoices === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="text-ink-soft text-sm">No payments yet.</p>
      ) : (
        <div className="card divide-y divide-line-soft">
          {invoices.map((inv) => (
            <div key={inv.id} className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 items-center text-sm">
              <span>{tiers?.find((t) => t.id === inv.tier)?.name ?? inv.tier}</span>
              <span className="font-mono sm:text-center">₹{inv.amountInr.toLocaleString("en-IN")}</span>
              <span className="text-xs text-ink-soft">{new Date(inv.paidAt || inv.createdAt).toLocaleDateString()}</span>
              <span className="sm:text-right" title={inv.failureReason ?? undefined}>
                <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${INVOICE_LABEL[inv.status]?.cls ?? ""}`}>{INVOICE_LABEL[inv.status]?.text ?? inv.status}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <EnterpriseEnquiryModal open={showEnterprise} onClose={() => setShowEnterprise(false)} source="billing" />
    </div>
  );
}

function CurrentBadge() {
  return <span className="btn-secondary w-full text-sm block text-center cursor-default border-verified text-verified">Current plan</span>;
}
