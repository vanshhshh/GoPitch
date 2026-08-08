"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface Profile {
  id: string;
  email: string;
  name: string | null;
  gmailConnected: boolean;
  connectedGmailAddress: string | null;
  sendReputationScore: number;
  complaintReportedAt: string | null;
}

interface Company {
  id: string;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="max-w-lg mx-auto px-8 py-10 text-ink-soft text-sm">Loading…</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function refresh() {
    const p = await api.get<Profile>("/api/profile/me");
    setProfile(p);
    setName(p.name ?? "");
    return p;
  }

  async function refreshUntilGmailConnected() {
    let latest = await refresh();
    for (let attempt = 0; attempt < 5 && !latest.gmailConnected; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      latest = await refresh();
    }
    return latest;
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const gmailConnected = searchParams.get("gmail_connected");
      const gmailError = searchParams.get("gmail_error");

      try {
        const p = gmailConnected ? await refreshUntilGmailConnected() : await refresh();
        if (cancelled) return;

        if (gmailConnected) {
          if (p.gmailConnected) {
            toast.success("Gmail connected.");
            const pendingCompanyId = localStorage.getItem("gopitch_pending_company_after_gmail");
            if (pendingCompanyId) {
              localStorage.removeItem("gopitch_pending_company_after_gmail");
              try {
                await api.get<Company>(`/api/companies/${pendingCompanyId}`);
                router.replace(`/company/${pendingCompanyId}?gmail_connected=true`);
              } catch {
                router.replace("/dashboard/settings");
              }
            } else {
              router.replace("/dashboard/settings");
            }
          } else {
            toast.error("Gmail connection did not persist. Try connecting again.");
          }
        }
      } catch {
        if (!cancelled) toast.error("Couldn't refresh your connected account status.");
      }

      if (gmailError && !cancelled) toast.error(`Gmail connection failed (${gmailError}).`);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/api/profile/me", { name });
      toast.success("Profile updated.");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  function connectGmail() {
    const token = localStorage.getItem("gopitch_token");
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";
    window.location.href = `${apiBase}/auth/google/init?token=${token}`;
  }

  async function disconnectGmail() {
    setDisconnecting(true);
    try {
      await api.post("/api/profile/disconnect-gmail");
      toast.success("Gmail disconnected.");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't disconnect.");
    } finally {
      setDisconnecting(false);
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
    <div className="max-w-lg mx-auto px-8 py-10 space-y-8">
      <div>
        <h1 className="font-display text-2xl mb-1">Settings</h1>
        <p className="text-ink-soft text-sm">Profile and connected accounts.</p>
      </div>

      <section className="card p-6">
        <h2 className="font-display text-base mb-4">Profile</h2>
        <form onSubmit={saveName} className="space-y-3">
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
      </section>

      <section className="card p-6">
        <h2 className="font-display text-base mb-4">Connected Gmail</h2>
        {profile.gmailConnected ? (
          <div>
            <p className="text-sm mb-1">
              Connected: <span className="font-mono">{profile.connectedGmailAddress}</span>
            </p>
            <p className="text-xs text-ink-soft mb-4">
              Send reputation: {(profile.sendReputationScore * 100).toFixed(0)}%
              {profile.complaintReportedAt && (
                <span className="text-danger"> · Sending paused (spam complaint) — contact support.</span>
              )}
            </p>
            <button className="btn-secondary" onClick={disconnectGmail} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect Gmail"}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-ink-soft mb-4">
              Not connected. Campaign sending is disabled until you connect your Gmail account.
            </p>
            <button className="btn-primary" onClick={connectGmail}>
              Connect Gmail
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
