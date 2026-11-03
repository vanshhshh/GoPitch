"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { api, ApiError, errorMessage, startGmailConnect, takeGmailReturnTo } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { EmptyState, ErrorState, FormField, LoadingSkeleton, Page, PageHeader, Section, Tabs } from "@/components/ui";
import { ConfirmationDialog } from "@/components/ui/overlays";

interface Profile {
  id: string;
  email: string;
  name: string | null;
  gmailConnected: boolean;
  replyTrackingEnabled: boolean;
  connectedGmailAddress: string | null;
  sendReputationScore: number;
  complaintReportedAt: string | null;
  hasPassword: boolean;
}

const GMAIL_ERRORS: Record<string, string> = {
  access_denied: "Gmail connection was cancelled on Google's screen.",
  invalid_state: "That Gmail connection attempt expired. Please connect again.",
  missing_profile: "Google didn't share your Gmail address. Please try again.",
  send_permission_missing: "GoPitch needs permission to send email. Connect again and leave the send permission ticked.",
  exchange_failed: "Google rejected the connection. Please try again.",
  restart: "Gmail connection has been updated. Please click Connect Gmail again.",
};

const TABS = [
  { key: "account", label: "Account" },
  { key: "gmail", label: "Gmail integration" },
  { key: "security", label: "Security" },
  { key: "notifications", label: "Notifications" },
  { key: "preferences", label: "Preferences" },
];

export default function SettingsPage() {
  return (
    <Suspense fallback={<Page><LoadingSkeleton /></Page>}>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const router = useRouter();
  const params = useSearchParams();
  const handled = useRef(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Returning from Google lands here with gmail_confirm / gmail_error; show the Gmail tab.
  const tab = params.get("gmail_confirm") || params.get("gmail_error") ? "gmail" : TABS.find((t) => t.key === params.get("tab"))?.key ?? "account";

  const refresh = useCallback(async () => {
    try {
      setProfile(await api.get<Profile>("/api/profile/me"));
    } catch (err) {
      setError(errorMessage(err, "Couldn't load your settings."));
    }
  }, []);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const nonce = params.get("gmail_confirm");
    const gmailError = params.get("gmail_error");
    (async () => {
      if (nonce) {
        router.replace("/dashboard/settings?tab=gmail");
        try {
          const res = await api.post<{ connectedGmailAddress: string }>("/api/profile/gmail/confirm", { nonce });
          toast.success(`Gmail connected: ${res.connectedGmailAddress}`);
          const returnTo = takeGmailReturnTo();
          if (returnTo) return router.replace(returnTo);
        } catch (err) {
          toast.error(errorMessage(err, "Couldn't finish connecting Gmail."), { duration: 8000 });
        }
      } else if (gmailError) {
        toast.error(GMAIL_ERRORS[gmailError] || "Gmail connection failed. Please try again.", { duration: 8000 });
        router.replace("/dashboard/settings?tab=gmail");
      }
      await refresh();
    })();
  }, [params, router, refresh]);

  return (
    <Page width="form">
      <PageHeader title="Settings" description="Your account, connected Gmail, security and notifications." />
      <Tabs label="Settings sections" active={tab} tabs={TABS.map((t) => ({ ...t, href: `/dashboard/settings?tab=${t.key}` }))} />
      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : !profile ? (
        <LoadingSkeleton rows={2} />
      ) : tab === "account" ? (
        <AccountTab profile={profile} onSaved={refresh} />
      ) : tab === "gmail" ? (
        <GmailTab profile={profile} onChanged={refresh} />
      ) : tab === "security" ? (
        <SecurityTab hasPassword={profile.hasPassword} onSaved={refresh} />
      ) : tab === "notifications" ? (
        <NotificationsTab />
      ) : (
        <PreferencesTab />
      )}
    </Page>
  );
}

function AccountTab({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [name, setName] = useState(profile.name ?? "");
  const [saving, setSaving] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/api/profile/me", { name });
      toast.success("Profile updated.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Section title="Account">
      <form onSubmit={save} className="space-y-4">
        <FormField label="Name">{(p) => <input className="input-field" {...p} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</FormField>
        <FormField label="Email" hint="Your sign-in email can't be changed here — contact support.">
          {(p) => <input className="input-field bg-surface-muted" {...p} value={profile.email} disabled />}
        </FormField>
        <button className="btn-primary" disabled={saving || !name.trim() || name === (profile.name ?? "")}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </Section>
  );
}

function GmailTab({ profile, onChanged }: { profile: Profile; onChanged: () => void }) {
  const [connecting, setConnecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function connect() {
    setConnecting(true);
    try {
      await startGmailConnect();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't start Gmail connection."));
      setConnecting(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await api.post("/api/profile/disconnect-gmail");
      toast.success("Gmail disconnected. Sending is paused until you reconnect.");
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't disconnect."));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }
  return (
    <Section title="Gmail integration" description="Campaign emails send from your own Gmail account — never a shared address.">
      {profile.gmailConnected ? (
        <div className="space-y-3 text-sm">
          <p>
            Connected: <span className="font-mono break-all">{profile.connectedGmailAddress}</span>
          </p>
          <p className="text-xs text-ink-soft">
            Send reputation {(profile.sendReputationScore * 100).toFixed(0)}%
            {profile.complaintReportedAt && <span className="text-danger"> · Sending paused (spam complaint) — contact support.</span>}
          </p>
          <p className="text-xs text-ink-soft">
            Reply tracking: {profile.replyTrackingEnabled ? "on — GoPitch reads only the headers of threads it sent, never message content." : "off. Reconnect to enable it."}
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {!profile.replyTrackingEnabled && (
              <button className="btn-primary" onClick={connect} disabled={connecting}>
                {connecting ? "Redirecting…" : "Enable reply tracking"}
              </button>
            )}
            <button className="btn-secondary" onClick={() => setConfirming(true)}>
              Disconnect Gmail
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">Not connected. Drafts stay queued until you connect.</p>
          <ul className="text-xs text-ink-soft list-disc pl-5 space-y-1">
            <li>Permissions requested: send email, and read message headers (for reply and bounce detection).</li>
            <li>Gmail data is never sent to AI providers or used to train models.</li>
          </ul>
          <button className="btn-primary" onClick={connect} disabled={connecting}>
            {connecting ? "Redirecting…" : "Connect Gmail"}
          </button>
        </div>
      )}
      <ConfirmationDialog
        open={confirming}
        title="Disconnect Gmail?"
        message="Queued emails stay queued, but nothing sends until you reconnect. GoPitch's access is revoked at Google too."
        confirmLabel="Disconnect"
        destructive
        busy={busy}
        onConfirm={disconnect}
        onCancel={() => setConfirming(false)}
      />
    </Section>
  );
}

function SecurityTab({ hasPassword, onSaved }: { hasPassword: boolean; onSaved: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await api.post("/api/profile/password", { currentPassword: hasPassword ? current : undefined, newPassword: next });
      toast.success(hasPassword ? "Password changed." : "Password set. You can now also sign in with email.");
      setCurrent("");
      setNext("");
      onSaved();
    } catch (error) {
      setErr(errorMessage(error, "Couldn't update your password."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Section title={hasPassword ? "Change password" : "Set a password"} description={hasPassword ? undefined : "You signed up with Google. Setting a password lets you sign in with email too."}>
      <form onSubmit={save} className="space-y-4">
        {hasPassword && (
          <FormField label="Current password">{(p) => <input className="input-field" type="password" autoComplete="current-password" required {...p} value={current} onChange={(e) => setCurrent(e.target.value)} />}</FormField>
        )}
        <FormField label="New password" hint="At least 8 characters, including a letter and a number." error={err}>
          {(p) => <input className="input-field" type="password" autoComplete="new-password" required minLength={8} maxLength={128} {...p} value={next} onChange={(e) => setNext(e.target.value)} />}
        </FormField>
        <button className="btn-primary" disabled={saving || next.length < 8}>
          {saving ? "Saving…" : hasPassword ? "Change password" : "Set password"}
        </button>
      </form>
    </Section>
  );
}

interface Note {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

function NotificationsTab() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<Note[]>("/api/notifications").then(setNotes).catch((err) => setError(errorMessage(err, "Couldn't load notifications.")));
  }, []);
  useEffect(load, [load]);
  async function markAll() {
    await api.post("/api/notifications/read-all").catch(() => {});
    load();
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!notes) return <LoadingSkeleton rows={3} />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-soft">
        In-app notifications for campaigns, payments, replies and account events. Email notifications aren't available yet.
      </p>
      {notes.length === 0 ? (
        <EmptyState title="No notifications" description="Activity from campaigns, payments and replies shows up here." />
      ) : (
        <>
          {notes.some((n) => !n.readAt) && (
            <button className="btn-secondary text-xs" onClick={markAll}>
              Mark all as read
            </button>
          )}
          <ul className="card divide-y divide-line-soft">
            {notes.map((n) => (
              <li key={n.id} className={`p-4 ${n.readAt ? "" : "bg-verified-soft/30"}`}>
                <p className="text-sm text-ink">{n.title}</p>
                {n.body && <p className="text-xs text-ink-soft mt-0.5">{n.body}</p>}
                <p className="text-[11px] text-ink-soft mt-1">{new Date(n.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PreferencesTab() {
  const { companies, companyId, setCompanyId } = useWorkspace();
  return (
    <Section title="Companies" description="The active company decides which profile, matches and campaigns you see.">
      {!companies ? (
        <LoadingSkeleton rows={1} />
      ) : (
        <ul className="divide-y divide-line-soft">
          {companies.map((c) => (
            <li key={c.id} className="py-3 flex items-center justify-between gap-3">
              <span className="text-sm">
                {c.name || "Untitled company"}
                {!c.onboardingComplete && <span className="ml-2 text-xs text-signal">onboarding unfinished</span>}
              </span>
              {c.id === companyId ? (
                <span className="text-xs text-verified">Active</span>
              ) : (
                <button className="btn-secondary text-xs" onClick={() => setCompanyId(c.id)}>
                  Make active
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link href="/onboarding?new=1" className="btn-secondary text-sm inline-block mt-4">
        Add another company
      </Link>
    </Section>
  );
}
