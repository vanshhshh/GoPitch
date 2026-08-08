"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Payment {
  id: string;
  founderEmail: string;
  tier: string;
  amountInr: number;
  status: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  PAID: "bg-verified-soft text-verified",
  CREATED: "bg-line-soft text-ink-soft",
  FAILED: "bg-danger-soft text-danger",
  REFUNDED: "bg-signal-soft text-signal",
};

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null);

  useEffect(() => {
    api.get<Payment[]>("/api/admin/payments").then(setPayments);
  }, []);

  const totalRevenue = payments?.filter((p) => p.status === "PAID").reduce((sum, p) => sum + p.amountInr, 0) ?? 0;

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Payments</h1>
      <p className="text-ink-soft text-sm mb-8">Every invoice created via Razorpay checkout.</p>

      <div className="card p-4 mb-6 inline-block">
        <p className="label mb-1">Total collected</p>
        <p className="font-display text-2xl">₹{totalRevenue.toLocaleString()}</p>
      </div>

      {payments === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : payments.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm">No payments yet.</p>
        </div>
      ) : (
        <div className="card divide-y divide-line-soft">
          {payments.map((p) => (
            <div key={p.id} className="p-4 flex items-center justify-between text-sm">
              <div>
                <p className="font-medium">{p.founderEmail}</p>
                <p className="text-xs text-ink-soft font-mono">{p.razorpayOrderId}</p>
              </div>
              <span>{p.tier}</span>
              <span className="font-mono">₹{p.amountInr.toLocaleString()}</span>
              <span className={`text-[10px] uppercase px-2 py-0.5 rounded ${STATUS_STYLE[p.status] || ""}`}>
                {p.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
