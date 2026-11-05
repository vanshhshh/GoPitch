"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { CalendarClock, CheckCircle2, Receipt } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { EmptyState, ErrorState, LoadingSkeleton, Notice, Page, PageHeader, ProgressBar, Spinner } from "@/components/ui";
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
      <Page width="page">
        <PageHeader title="Billing" />
        <ErrorState message={loadError} onRetry={refresh} />
      </Page>
    );
  }

  const current = subscription?.entitlementTier ?? "FREE";
  const currentTier = tiers?.find((t) => t.id === current);
  const periodEnd = subscription?.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : null;
  const usedPct = quota && quota.investorEmailsTotal > 0 ? ((quota.investorEmailsSent + quota.investorEmailsQueued) / quota.investorEmailsTotal) * 100 : 0;

  let planStatus: { text: string; cls: string } | null = null;
  if (subscription) {
    if (current === "FREE") planStatus = subscription.lapsed ? { text: "Lapsed", cls: "bg-signal-soft text-signal" } : null;
    else if (subscription.billing === "one_time") planStatus = { text: "Lifetime", cls: "bg-verified-soft text-verified" };
    else if (subscription.cancelAtPeriodEnd) planStatus = { text: "Ending", cls: "bg-signal-soft text-signal" };
    else planStatus = { text: "Active", cls: "bg-verified-soft text-verified" };
  }

  return (
    <Page width="page">
      <PageHeader title="Billing" description="Manage your plan, track how many outreach emails you have left, and review past payments." />

      {subscription === null ? (
        <div className="mb-10">
          <LoadingSkeleton rows={1} label="Loading your plan" />
        </div>
      ) : (
        <section aria-label="Current plan" className="card overflow-hidden mb-10">
          <div className="grid md:grid-cols-[1.2fr_1fr]">
            <div className="p-5 sm:p-6">
              <p className="label mb-2">Current plan</p>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="font-display text-2xl">{currentTier?.name ?? current}</h2>
                {planStatus && <span className={`text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded ${planStatus.cls}`}>{planStatus.text}</span>}
              </div>
              <p className="text-sm text-ink-soft mt-2 flex items-start gap-2">
                <CalendarClock size={15} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  {current === "FREE"
                    ? subscription.lapsed
                      ? "Your previous paid plan has ended, so your account is on Free."
                      : "Free plan. No payment needed."
                    : subscription.billing === "one_time"
                      ? "One-time purchase. It doesn't renew or expire."
                      : subscription.cancelAtPeriodEnd
                        ? `Ends on ${periodEnd}. It won't renew.`
                        : `Active until ${periodEnd}. Renew any time before then to add another 30 days.`}
                </span>
              </p>

              {subscription.isPaidActive && subscription.billing === "monthly" && !subscription.cancelAtPeriodEnd && (
                <div className="mt-5">
                  {confirmCancel ? (
                    <div className="rounded border border-danger/20 bg-danger-soft/50 p-3 text-sm">
                      <p className="text-ink">
                        Stop renewal? You keep {currentTier?.name} until {periodEnd}, then your account moves to Free.
                      </p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button className="btn-danger text-xs" onClick={handleCancel}>
                          Yes, cancel renewal
                        </button>
                        <button className="btn-ghost text-xs" onClick={() => setConfirmCancel(false)}>
                          Keep plan
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="text-xs text-ink-soft hover:text-danger hover:underline underline-offset-2" onClick={() => setConfirmCancel(true)}>
                      Cancel renewal
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="p-5 sm:p-6 bg-surface-muted border-t md:border-t-0 md:border-l border-line-soft">
              <p className="label mb-2">Outreach emails</p>
              {quota ? (
                <>
                  <p className="flex items-baseline gap-1.5">
                    <span className={`font-mono text-3xl tracking-tight ${quota.quotaExhausted ? "text-danger" : "text-navy"}`}>
                      {quota.investorEmailsRemaining.toLocaleString("en-IN")}
                    </span>
                    <span className="text-sm text-ink-soft">left of {quota.investorEmailsTotal.toLocaleString("en-IN")}</span>
                  </p>
                  <div className="mt-3">
                    <ProgressBar value={usedPct} label="Outreach emails used" />
                  </div>
                  <p className="mt-3 text-xs text-ink-soft">
                    <span className="font-mono text-ink">{quota.investorEmailsSent.toLocaleString("en-IN")}</span> sent ·{" "}
                    <span className="font-mono text-ink">{quota.investorEmailsQueued.toLocaleString("en-IN")}</span> queued
                  </p>
                </>
              ) : (
                <p className="text-sm text-ink-soft">Usage isn't available right now.</p>
              )}
            </div>
          </div>

          {(quota?.quotaExhausted || activating) && (
            <div className="px-5 sm:px-6 py-4 space-y-2 border-t border-line-soft">
              {quota?.quotaExhausted && <Notice tone="danger">You've used every email in your plan. Choose a plan below to keep sending.</Notice>}
              {activating && (
                <Notice tone="info">
                  <Spinner label="Confirming your payment with Razorpay…" />
                </Notice>
              )}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1 mb-5">
        <div>
          <h2 className="font-display text-xl">{current === "FREE" ? "Choose a plan" : "Plans"}</h2>
          <p className="text-sm text-ink-soft mt-0.5">Prices in INR. Payments are processed securely by Razorpay.</p>
        </div>
        <Link href="/pricing" className="text-sm text-verified hover:underline">
          See pricing FAQ
        </Link>
      </div>

      {tiers === null ? (
        <div className="mb-12">
          <LoadingSkeleton rows={2} label="Loading plans" />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 pt-3 mb-12">
          {tiers.map((tier) => {
            const isCurrent = tier.id === current;
            const isLower = RANK[tier.id]! < RANK[current]!;
            let action: React.ReactNode;
            if (tier.id === "ENTERPRISE") {
              action = isCurrent ? (
                <CurrentBadge />
              ) : (
                <button type="button" onClick={() => setShowEnterprise(true)} className="btn-secondary w-full text-sm">
                  Talk to Sales
                </button>
              );
            } else if (tier.id === "FREE") {
              action = isCurrent ? <CurrentBadge /> : <IncludedNote text="Included with every account" />;
            } else if (isLower) {
              action = <IncludedNote text="Included in your plan" />;
            } else {
              const renew = isCurrent && tier.billing === "monthly";
              action =
                isCurrent && !renew ? (
                  <CurrentBadge />
                ) : (
                  <button
                    className={`${tier.id === "GROWTH" || renew ? "btn-primary" : "btn-secondary"} w-full text-sm`}
                    onClick={() => handleCheckout(tier)}
                    disabled={!!checkingOut || activating}
                  >
                    {checkingOut === tier.id ? "Opening checkout…" : renew ? "Renew for 30 days" : `Upgrade to ${tier.name}`}
                  </button>
                );
            }
            const recommend = !isCurrent && tier.id === "GROWTH" && RANK[current]! < RANK.GROWTH!;
            return (
              <PlanCard
                key={tier.id}
                tier={tier}
                highlight={isCurrent}
                badge={isCurrent ? "Your plan" : recommend ? "Recommended" : undefined}
                action={action}
                compact
              />
            );
          })}
        </div>
      )}

      <h2 className="font-display text-xl mb-4">Payment history</h2>
      {invoices === null ? (
        <LoadingSkeleton rows={2} label="Loading payments" />
      ) : invoices.length === 0 ? (
        <EmptyState icon={<Receipt size={18} />} title="No payments yet" description="When you buy or renew a plan, the payment will show up here." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="hidden sm:table-header-group bg-surface-muted text-left">
              <tr>
                <th scope="col" className="label px-5 py-2.5">
                  Plan
                </th>
                <th scope="col" className="label px-5 py-2.5">
                  Date
                </th>
                <th scope="col" className="label px-5 py-2.5 text-right">
                  Amount
                </th>
                <th scope="col" className="label px-5 py-2.5 text-right">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {invoices.map((inv) => {
                const status = INVOICE_LABEL[inv.status];
                return (
                  <tr key={inv.id} className="grid grid-cols-2 gap-x-2 gap-y-1 px-5 py-3 sm:table-row sm:p-0">
                    <td className="font-medium text-navy sm:px-5 sm:py-3.5">{tiers?.find((t) => t.id === inv.tier)?.name ?? inv.tier}</td>
                    <td className="text-xs text-ink-soft sm:text-sm sm:px-5 sm:py-3.5 order-3 sm:order-none">{formatDate(inv.paidAt || inv.createdAt)}</td>
                    <td className="font-mono text-right sm:px-5 sm:py-3.5 order-2 sm:order-none">₹{inv.amountInr.toLocaleString("en-IN")}</td>
                    <td className="text-right sm:px-5 sm:py-3.5 order-4 sm:order-none">
                      <span className={`inline-block text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded ${status?.cls ?? "bg-line-soft text-ink-soft"}`}>
                        {status?.text ?? inv.status}
                      </span>
                      {inv.status === "FAILED" && inv.failureReason && <p className="text-xs text-ink-soft mt-1 sm:max-w-[16rem] sm:ml-auto">{inv.failureReason}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <EnterpriseEnquiryModal open={showEnterprise} onClose={() => setShowEnterprise(false)} source="billing" />
    </Page>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function CurrentBadge() {
  return (
    <span className="w-full text-sm font-medium flex items-center justify-center gap-1.5 px-4 py-2 rounded bg-verified-soft text-verified cursor-default">
      <CheckCircle2 size={14} aria-hidden /> Current plan
    </span>
  );
}

function IncludedNote({ text }: { text: string }) {
  return <p className="text-xs text-ink-soft text-center px-4 py-2 rounded border border-dashed border-line">{text}</p>;
}
