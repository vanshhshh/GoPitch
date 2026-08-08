"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface SupportMessage {
  id: string;
  email: string;
  subject: string;
  message: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
}

export default function AdminSupportPage() {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [filter, setFilter] = useState<"OPEN" | "ALL">("OPEN");

  function refresh() {
    api.get<SupportMessage[]>("/api/admin/support").then(setMessages);
  }
  useEffect(refresh, []);

  async function resolve(id: string) {
    try {
      await api.post(`/api/admin/support/${id}/resolve`);
      toast.success("Marked resolved.");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update.");
    }
  }

  const filtered = messages?.filter((m) => filter === "ALL" || m.status === "OPEN") ?? [];

  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Support</h1>
      <p className="text-ink-soft text-sm mb-6">Messages submitted through the contact form.</p>

      <div className="flex gap-2 mb-6 text-xs">
        {(["OPEN", "ALL"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded transition-colors ${
              filter === f ? "bg-verified-soft text-verified" : "text-ink-soft hover:text-ink"
            }`}
          >
            {f === "OPEN" ? "Open" : "All"}
          </button>
        ))}
      </div>

      {messages === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm">Nothing here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((m) => (
            <div key={m.id} className="card p-5 animate-fade-up">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium">{m.subject}</p>
                <span
                  className={`text-[10px] uppercase px-2 py-0.5 rounded ${
                    m.status === "OPEN" ? "bg-signal-soft text-signal" : "bg-verified-soft text-verified"
                  }`}
                >
                  {m.status}
                </span>
              </div>
              <p className="text-xs text-ink-soft font-mono mb-2">{m.email}</p>
              <p className="text-sm text-ink-soft mb-3">{m.message}</p>
              {m.status === "OPEN" && (
                <button className="btn-secondary text-xs" onClick={() => resolve(m.id)}>
                  Mark resolved
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
