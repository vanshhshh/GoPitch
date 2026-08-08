"use client";

import { useEffect, useState, useRef } from "react";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface Investor {
  id: string;
  name: string;
  firm: string;
  email: string;
  title: string | null;
  linkedinUrl: string | null;
  website: string | null;
  source: string | null;
  stageFocus: string[];
  sectorFocus: string[];
  geoFocus: string[];
  checkSizeMinUsd: number | null;
  checkSizeMaxUsd: number | null;
  thesisKeywords: string[];
  isVerified: boolean;
  needsEnrichment: boolean;
}

type Filter = "unverified" | "all";

export default function AdminInvestorsPage() {
  const [investors, setInvestors] = useState<Investor[] | null>(null);
  const [filter, setFilter] = useState<Filter>("unverified");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Investor | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function refresh() {
    const query = filter === "unverified" ? "?verified=false" : "";
    api.get<Investor[]>(`/api/admin/investors${query}`).then(setInvestors);
  }
  useEffect(refresh, [filter]);

  async function verify(id: string) {
    await api.post(`/api/admin/investors/${id}/verify`);
    toast.success("Verified.");
    refresh();
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/api/admin/investors/${id}`);
      toast.success("Deleted.");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't delete.");
    }
  }

  async function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.postForm<{ inserted: number; skipped: number }>("/api/admin/investors/bulk-import", formData);
      toast.success(`Imported ${res.inserted} new investors (${res.skipped} skipped/duplicate).`);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display text-2xl">Investors</h1>
        <div className="flex gap-2">
          <label className="btn-secondary cursor-pointer">
            {uploading ? "Importing…" : "Bulk import CSV"}
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} disabled={uploading} />
          </label>
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            + Add investor
          </button>
        </div>
      </div>
      <p className="text-ink-soft text-sm mb-6">
        Verification and enrichment queue, plus full investor management. Unenriched investors
        (no real stage/sector/geography data) are excluded from matching automatically.
      </p>

      <div className="flex gap-2 mb-6 text-sm">
        <button
          onClick={() => setFilter("unverified")}
          className={`px-3 py-1 rounded ${filter === "unverified" ? "bg-verified-soft text-verified" : "text-ink-soft"}`}
        >
          Pending verification
        </button>
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1 rounded ${filter === "all" ? "bg-verified-soft text-verified" : "text-ink-soft"}`}
        >
          All investors
        </button>
      </div>

      {showForm && (
        <InvestorForm
          initial={editing}
          onSaved={() => {
            refresh();
            setShowForm(false);
            setEditing(null);
          }}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {investors === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : investors.length === 0 ? (
        <p className="text-ink-soft text-sm">Nothing here.</p>
      ) : (
        <div className="card divide-y divide-line-soft">
          {investors.map((inv) => (
            <div key={inv.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {inv.name} <span className="text-ink-soft">· {inv.firm}</span>
                </p>
                <p className="text-xs text-ink-soft font-mono">{inv.email}</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {inv.sectorFocus.slice(0, 4).map((s) => (
                    <span key={s} className="text-[10px] bg-line-soft text-ink-soft px-1.5 py-0.5 rounded">
                      {s}
                    </span>
                  ))}
                  {inv.needsEnrichment && (
                    <span className="text-[10px] bg-signal-soft text-signal px-1.5 py-0.5 rounded">
                      Needs enrichment
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  className="text-xs text-ink-soft hover:text-ink transition-colors"
                  onClick={() => {
                    setEditing(inv);
                    setShowForm(true);
                  }}
                >
                  Edit
                </button>
                <DeleteButton onDelete={() => handleDelete(inv.id)} />
                {!inv.isVerified ? (
                  <button className="btn-primary text-xs" onClick={() => verify(inv.id)}>
                    Verify
                  </button>
                ) : (
                  <span className="text-xs text-verified bg-verified-soft px-2 py-1 rounded">Verified</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <button className="text-xs text-danger" onClick={onDelete}>
        Confirm?
      </button>
    );
  }
  return (
    <button className="text-xs text-ink-soft hover:text-danger transition-colors" onClick={() => setConfirming(true)}>
      Delete
    </button>
  );
}

function InvestorForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: Investor | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    firm: initial?.firm ?? "",
    email: initial?.email ?? "",
    linkedinUrl: initial?.linkedinUrl ?? "",
    website: initial?.website ?? "",
    stageFocus: initial?.stageFocus.join(", ") ?? "",
    sectorFocus: initial?.sectorFocus.join(", ") ?? "",
    geoFocus: initial?.geoFocus.join(", ") ?? "",
    checkSizeMinUsd: initial?.checkSizeMinUsd?.toString() ?? "",
    checkSizeMaxUsd: initial?.checkSizeMaxUsd?.toString() ?? "",
    thesisKeywords: initial?.thesisKeywords.join(", ") ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      firm: form.firm,
      email: form.email,
      linkedinUrl: form.linkedinUrl || undefined,
      website: form.website || undefined,
      stageFocus: form.stageFocus.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      sectorFocus: form.sectorFocus.split(",").map((s) => s.trim()).filter(Boolean),
      geoFocus: form.geoFocus.split(",").map((s) => s.trim()).filter(Boolean),
      checkSizeMinUsd: form.checkSizeMinUsd ? Number(form.checkSizeMinUsd) : null,
      checkSizeMaxUsd: form.checkSizeMaxUsd ? Number(form.checkSizeMaxUsd) : null,
      thesisKeywords: form.thesisKeywords.split(",").map((s) => s.trim()).filter(Boolean),
    };
    try {
      if (initial) {
        await api.patch(`/api/admin/investors/${initial.id}`, payload);
      } else {
        await api.post("/api/admin/investors", payload);
      }
      toast.success("Saved.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-5 mb-6 grid grid-cols-2 gap-3 animate-fade-up">
      <input required placeholder="Name" className="input-field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input required placeholder="Firm" className="input-field" value={form.firm} onChange={(e) => setForm({ ...form, firm: e.target.value })} />
      <input required type="email" placeholder="Email" className="input-field col-span-2" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input placeholder="LinkedIn URL" className="input-field" value={form.linkedinUrl} onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })} />
      <input placeholder="Website" className="input-field" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      <input placeholder="Stage focus (SEED, SERIES_A)" className="input-field" value={form.stageFocus} onChange={(e) => setForm({ ...form, stageFocus: e.target.value })} />
      <input placeholder="Sector focus (fintech, saas)" className="input-field" value={form.sectorFocus} onChange={(e) => setForm({ ...form, sectorFocus: e.target.value })} />
      <input placeholder="Geography (India, SEA)" className="input-field" value={form.geoFocus} onChange={(e) => setForm({ ...form, geoFocus: e.target.value })} />
      <input placeholder="Thesis keywords" className="input-field" value={form.thesisKeywords} onChange={(e) => setForm({ ...form, thesisKeywords: e.target.value })} />
      <input placeholder="Check size min USD" type="number" className="input-field" value={form.checkSizeMinUsd} onChange={(e) => setForm({ ...form, checkSizeMinUsd: e.target.value })} />
      <input placeholder="Check size max USD" type="number" className="input-field" value={form.checkSizeMaxUsd} onChange={(e) => setForm({ ...form, checkSizeMaxUsd: e.target.value })} />
      <div className="col-span-2 flex gap-2">
        <button className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Add investor"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
