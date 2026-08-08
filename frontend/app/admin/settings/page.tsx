"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface Profile {
  email: string;
  name: string | null;
}

export default function AdminSettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<Profile>("/api/profile/me").then((p) => {
      setProfile(p);
      setName(p.name ?? "");
    });
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
      <div className="max-w-lg mx-auto px-8 py-10">
        <p className="text-ink-soft text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-8 py-10">
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
    </div>
  );
}
