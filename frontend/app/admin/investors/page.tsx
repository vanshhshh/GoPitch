"use client";

import { useEffect, useState, useRef } from "react";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";
import { Pagination } from "@/components/Pagination";

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
  investorType: string | null;
  subSectors: string[];
  businessModels: string[];
  leadsRounds: boolean | null;
  fundStatus: "ACTIVE" | "NOT_INVESTING" | "UNKNOWN";
  tractionRequirement: "PRE_REVENUE_OK" | "REVENUE_REQUIRED" | null;
  founderPreferences: string[];
  fundDescription: string | null;
}

type Filter = "unverified" | "enrichment" | "matchable" | "all";

const FILTER_QUERY: Record<Filter, string> = {
  unverified: "verified=false",
  enrichment: "enrichment=needed",
  matchable: "verified=true&enrichment=complete",
  all: "",
};
const PAGE_SIZE = 50;

export default function AdminInvestorsPage() {
  const [investors, setInvestors] = useState<Investor[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("unverified");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Investor | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => (setQuery(search.trim()), setPage(1)), 300);
    return () => clearTimeout(t);
  }, [search]);

  function refresh() {
    const params = new URLSearchParams(FILTER_QUERY[filter]);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    if (query) params.set("q", query);
    api
      .get<{ items: Investor[]; total: number }>(`/api/admin/investors?${params}`)
      .then((r) => (setInvestors(r.items), setTotal(r.total), setLoadError(null)))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Couldn't load investors."));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [filter, page, query]);

  async function verify(id: string) {
    try {
      await api.post(`/api/admin/investors/${id}/verify`);
      toast.success("Verified.");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't verify.");
    }
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
    <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
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

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6 text-sm">
        <div className="flex flex-wrap gap-2">
          {([
            ["unverified", "Pending verification"],
            ["enrichment", "Needs enrichment"],
            ["matchable", "Matchable"],
            ["all", "All investors"],
          ] as [Filter, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => (setFilter(key), setPage(1))}
              className={`px-3 py-1 rounded ${filter === key ? "bg-verified-soft text-verified" : "text-ink-soft hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input className="input-field sm:max-w-xs sm:ml-auto" placeholder="Search name, fund or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search investors" />
      </div>
      {loadError && <p className="text-sm text-danger mb-4">{loadError}</p>}
      {investors && <p className="text-xs text-ink-soft mb-2">{total.toLocaleString()} investors</p>}

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
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
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
    investorType: initial?.investorType ?? "",
    subSectors: initial?.subSectors?.join(", ") ?? "",
    businessModels: initial?.businessModels?.join(", ") ?? "",
    leadsRounds: initial?.leadsRounds == null ? "" : initial.leadsRounds ? "yes" : "no",
    fundStatus: initial?.fundStatus ?? "UNKNOWN",
    tractionRequirement: initial?.tractionRequirement ?? "",
    founderPreferences: initial?.founderPreferences?.join(", ") ?? "",
    fundDescription: initial?.fundDescription ?? "",
  });
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
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
      // Matching v2 enrichment — each field left empty is reported to founders as "no data", never guessed.
      investorType: form.investorType || null,
      subSectors: list(form.subSectors),
      businessModels: list(form.businessModels).map((b) => b.toUpperCase()),
      leadsRounds: form.leadsRounds === "" ? null : form.leadsRounds === "yes",
      fundStatus: form.fundStatus,
      tractionRequirement: form.tractionRequirement || null,
      founderPreferences: list(form.founderPreferences),
      fundDescription: form.fundDescription || null,
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
    <form onSubmit={submit} className="card p-5 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-up">
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
      <p className="col-span-2 label pt-2">Matching v2 enrichment</p>
      <select className="input-field" aria-label="Investor type" value={form.investorType} onChange={(e) => setForm({ ...form, investorType: e.target.value })}>
        <option value="">Investor type: unknown</option>
        {["VC", "MICRO_VC", "ANGEL", "ANGEL_NETWORK", "CVC", "ACCELERATOR", "FAMILY_OFFICE", "SYNDICATE", "OTHER"].map((t) => (
          <option key={t} value={t}>
            {t.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <select className="input-field" aria-label="Fund status" value={form.fundStatus} onChange={(e) => setForm({ ...form, fundStatus: e.target.value as any })}>
        <option value="UNKNOWN">Fund status: unknown</option>
        <option value="ACTIVE">Actively investing</option>
        <option value="NOT_INVESTING">Not investing (excluded from matches)</option>
      </select>
      <input placeholder="Sub-sectors (cross-border payments)" className="input-field" value={form.subSectors} onChange={(e) => setForm({ ...form, subSectors: e.target.value })} />
      <input placeholder="Business models (SAAS, MARKETPLACE)" className="input-field" value={form.businessModels} onChange={(e) => setForm({ ...form, businessModels: e.target.value })} />
      <select className="input-field" aria-label="Leads rounds" value={form.leadsRounds} onChange={(e) => setForm({ ...form, leadsRounds: e.target.value })}>
        <option value="">Leads rounds: unknown</option>
        <option value="yes">Leads rounds</option>
        <option value="no">Usually follows</option>
      </select>
      <select className="input-field" aria-label="Traction requirement" value={form.tractionRequirement} onChange={(e) => setForm({ ...form, tractionRequirement: e.target.value as any })}>
        <option value="">Traction requirement: unknown</option>
        <option value="PRE_REVENUE_OK">Backs pre-revenue</option>
        <option value="REVENUE_REQUIRED">Requires revenue</option>
      </select>
      <input placeholder="Founder preferences (technical, repeat)" className="input-field col-span-2" value={form.founderPreferences} onChange={(e) => setForm({ ...form, founderPreferences: e.target.value })} />
      <textarea placeholder="Fund description (shown on the fund page)" className="input-field col-span-2" rows={2} value={form.fundDescription} onChange={(e) => setForm({ ...form, fundDescription: e.target.value })} />
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
