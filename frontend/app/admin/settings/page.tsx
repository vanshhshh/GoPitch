"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface Profile {
  email: string;
  name: string | null;
}

interface ProviderHealth {
  provider: string;
  configured: boolean;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

/** Live check: the backend sends a tiny prompt to each configured provider. */
function AIHealth() {
  const [result, setResult] = useState<{ providers: ProviderHealth[]; checkedAt: string } | null>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      setResult(await api.get("/api/admin/ai-health"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Health check failed.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="card p-6 mt-8">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-display text-base">AI providers</h2>
        <button className="btn-secondary text-xs" onClick={check} disabled={checking}>
          {checking ? "Checking…" : "Run live check"}
        </button>
      </div>
      <p className="text-xs text-ink-soft mb-4">Sends a one-word test prompt to every configured provider. A key being present isn't the same as working.</p>
      {result && (
        <ul className="divide-y divide-line-soft text-sm">
          {result.providers.map((p) => (
            <li key={p.provider} className="py-2 flex items-start justify-between gap-3">
              <span className="font-mono">{p.provider}</span>
              <span className={`text-right text-xs ${!p.configured ? "text-ink-soft" : p.ok ? "text-verified" : "text-danger"}`}>
                {!p.configured ? "Not configured" : p.ok ? `OK · ${p.latencyMs} ms` : `Failing · ${p.error}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminSettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<Profile>("/api/profile/me")
      .then((p) => {
        setProfile(p);
        setName(p.name ?? "");
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : "Couldn't load your profile."));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/api/profile/me", { name });
      toast.success("Saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-8 py-10">
        <p className="text-ink-soft text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Settings</h1>
      <p className="text-ink-soft text-sm mb-8">Your admin account.</p>

      <form onSubmit={handleSubmit} className="card p-6 space-y-3">
        <div>
          <label className="label block mb-1.5">Name</label>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label block mb-1.5">Email</label>
          <input className="input-field bg-line-soft" value={profile.email} disabled />
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
      <AIHealth />
    </div>
  );
}
