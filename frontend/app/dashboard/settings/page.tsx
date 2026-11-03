"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { api, ApiError, errorMessage, startGmailConnect, takeGmailReturnTo } from "@/lib/api";

interface Profile {
  id: string;
  email: string;
  name: string | null;
  gmailConnected: boolean;
  replyTrackingEnabled: boolean;
  connectedGmailAddress: string | null;
  gmailConnectedAt: string | null;
  sendReputationScore: number;
  complaintReportedAt: string | null;
}

const GMAIL_ERRORS: Record<string, string> = {
  access_denied: "Gmail connection was cancelled on Google's screen.",
  invalid_state: "That Gmail connection attempt expired. Please connect again.",
  missing_profile: "Google didn't share your Gmail address. Please try again.",
  send_permission_missing: "GoPitch needs permission to send email. Connect again and leave the send permission ticked.",
  exchange_failed: "Google rejected the connection. Please try again.",
  restart: "Gmail connection has been updated. Please click Connect Gmail again.",
};

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="max-w-lg mx-auto px-4 sm:px-8 py-10 text-ink-soft text-sm">Loading…</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const handled = useRef(false);

  async function refresh() {
    const p = await api.get<Profile>("/api/profile/me");
    setProfile(p);
    setName(p.name ?? "");
    return p;
  }

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const nonce = searchParams.get("gmail_confirm");
    const gmailError = searchParams.get("gmail_error");

    (async () => {
      if (nonce) {
        // Drop the nonce from the URL before using it (single-use anyway).
        router.replace("/dashboard/settings");
        try {
          const res = await api.post<{ connectedGmailAddress: string }>("/api/profile/gmail/confirm", { nonce });
          toast.success(`Gmail connected: ${res.connectedGmailAddress}`);
          const returnTo = takeGmailReturnTo();
          if (returnTo) {
            router.replace(returnTo);
            return;
          }
        } catch (err) {
          toast.error(errorMessage(err, "Couldn't finish connecting Gmail."), { duration: 8000 });
        }
      } else if (gmailError) {
        toast.error(GMAIL_ERRORS[gmailError] || "Gmail connection failed. Please try again.", { duration: 8000 });
        router.replace("/dashboard/settings");
      }
      try {
        await refresh();
      } catch (err) {
        setLoadError(errorMessage(err, "Couldn't load your settings."));
      }
    })();
  }, [router, searchParams]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/api/profile/me", { name });
      toast.success("Profile updated.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function connectGmail() {
    setConnecting(true);
    try {
      await startGmailConnect();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start Gmail connection."));
      setConnecting(false);
    }
  }

  async function disconnectGmail() {
    setDisconnecting(true);
    try {
      await api.post("/api/profile/disconnect-gmail");
      toast.success("Gmail disconnected. Sending is paused until you reconnect.");
      setConfirmDisconnect(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't disconnect.");
    } finally {
      setDisconnecting(false);
    }
  }

  if (loadError) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-8 py-10">
        <p className="text-sm text-danger">{loadError}</p>
        <button className="btn-secondary mt-4" onClick={() => refresh().then(() => setLoadError(null)).catch(() => {})}>
          Retry
        </button>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-lg mx-auto px-4 sm:px-8 py-10">
        <p className="text-ink-soft text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-8 py-10 space-y-8">
      <div>
        <h1 className="font-display text-2xl mb-1">Settings</h1>
        <p className="text-ink-soft text-sm">Profile and connected accounts.</p>
      </div>

      <section className="card p-6">
        <h2 className="font-display text-base mb-4">Profile</h2>
        <form onSubmit={saveName} className="space-y-3">
          <label className="block">
            <span className="label block mb-1.5">Name</span>
            <input className="input-field" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="label block mb-1.5">Email</span>
            <input className="input-field bg-line-soft" value={profile.email} disabled />
          </label>
          <button type="submit" className="btn-primary" disabled={saving || !name.trim() || name === (profile.name ?? "")}>
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      <section className="card p-6">
        <h2 className="font-display text-base mb-4">Connected Gmail</h2>
        {profile.gmailConnected ? (
          <div>
            <p className="text-sm mb-1">
              Connected: <span className="font-mono break-all">{profile.connectedGmailAddress}</span>
            </p>
            <p className="text-xs text-ink-soft mb-1">
              Send reputation: {(profile.sendReputationScore * 100).toFixed(0)}%
              {profile.complaintReportedAt && <span className="text-danger"> · Sending paused (spam complaint) — contact support.</span>}
            </p>
            <p className="text-xs text-ink-soft mb-4">
              Reply tracking: {profile.replyTrackingEnabled ? "on (GoPitch reads only message headers of threads it sent)" : "off — reconnect to enable"}
            </p>
            {confirmDisconnect ? (
              <div className="border border-danger/20 bg-danger-soft rounded p-3">
                <p className="text-sm mb-3">Disconnect Gmail? Queued emails stay queued but nothing will send until you reconnect.</p>
                <div className="flex gap-2">
                  <button className="btn-primary bg-danger hover:bg-danger" onClick={disconnectGmail} disabled={disconnecting}>
                    {disconnecting ? "Disconnecting…" : "Yes, disconnect"}
                  </button>
                  <button className="btn-secondary" onClick={() => setConfirmDisconnect(false)}>
                    Keep connected
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => setConfirmDisconnect(true)}>
                  Disconnect Gmail
                </button>
                {!profile.replyTrackingEnabled && (
                  <button className="btn-primary" onClick={connectGmail} disabled={connecting}>
                    {connecting ? "Redirecting…" : "Enable reply tracking"}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="text-sm text-ink-soft mb-4">
              Not connected. Campaign emails send from your own Gmail account, so sending is disabled until you connect it.
            </p>
            <button className="btn-primary" onClick={connectGmail} disabled={connecting}>
              {connecting ? "Redirecting…" : "Connect Gmail"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
