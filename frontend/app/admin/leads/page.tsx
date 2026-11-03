"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, errorMessage } from "@/lib/api";

interface Lead {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  teamSize: string | null;
  outreachVolume: string | null;
  message: string;
  source: string | null;
  status: "NEW" | "CONTACTED" | "QUALIFIED" | "CLOSED";
  accountEmail: string | null;
  createdAt: string;
}

const STATUSES: Lead["status"][] = ["NEW", "CONTACTED", "QUALIFIED", "CLOSED"];

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [filter, setFilter] = useState<"" | Lead["status"]>("NEW");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api
      .get<Lead[]>(`/api/admin/leads${filter ? `?status=${filter}` : ""}`)
      .then((l) => (setLeads(l), setError(null)))
      .catch((err) => setError(errorMessage(err, "Couldn't load enquiries.")));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [filter]);

  async function setStatus(id: string, status: Lead["status"]) {
    try {
      await api.patch(`/api/admin/leads/${id}`, { status });
      toast.success(`Marked ${status.toLowerCase()}.`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update."));
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Enterprise enquiries</h1>
      <p className="text-ink-soft text-sm mb-6">Talk to Sales submissions from the pricing and billing pages. New enquiries also notify every admin.</p>

      <div className="flex flex-wrap gap-2 mb-6 text-sm">
        {(["", ...STATUSES] as const).map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} className={`px-3 py-1 rounded ${filter === s ? "bg-verified-soft text-verified" : "text-ink-soft hover:text-ink"}`}>
            {s ? s.charAt(0) + s.slice(1).toLowerCase() : "All"}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : leads === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : leads.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink-soft">No enquiries in this view.</div>
      ) : (
        <div className="space-y-3">
          {leads.map((l) => (
            <div key={l.id} className="card p-5">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {l.name} <span className="text-ink-soft font-normal">· {l.company}</span>
                  </p>
                  <p className="text-sm">
                    <a href={`mailto:${l.email}`} className="text-verified hover:underline break-all">
                      {l.email}
                    </a>
                    {l.phone && (
                      <>
                        {" · "}
                        <a href={`tel:${l.phone}`} className="hover:underline">
                          {l.phone}
                        </a>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-ink-soft mt-1">
                    Volume: {l.outreachVolume || "—"}
                    {l.teamSize && ` · Team ${l.teamSize}`}
                    {l.website && ` · ${l.website}`} · via {l.source || "form"} · {new Date(l.createdAt).toLocaleString()}
                    {l.accountEmail && ` · account ${l.accountEmail}`}
                  </p>
                </div>
                <select className="input-field w-auto text-xs" value={l.status} onChange={(e) => setStatus(l.id, e.target.value as Lead["status"])} aria-label="Enquiry status">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0) + s.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm whitespace-pre-line mt-3 border-t border-line-soft pt-3">{l.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
