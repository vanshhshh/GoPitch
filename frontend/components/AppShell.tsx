"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Bell, Building2, ChevronsUpDown, CreditCard, LayoutDashboard, LogOut, Menu, Send, Settings, Shield, Users, X } from "lucide-react";
import { api, clearToken } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { QUOTA_EXHAUSTED_EVENT } from "@/lib/events";
import { UpgradePrompt } from "@/components/UpgradePrompt";

export const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/company", label: "My Company", icon: Building2 },
  { href: "/dashboard/investors", label: "Investor Discovery", icon: Users },
  { href: "/dashboard/outreach", label: "Outreach", icon: Send },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, companies, company, setCompanyId } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [plan, setPlan] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<{ tier: string; limit: number } | null>(null);

  useEffect(() => {
    setMobileOpen(false);
    api.get<{ unread: number }>("/api/notifications/unread-count").then((n) => setUnread(n.unread)).catch(() => {});
  }, [pathname]);

  useEffect(() => {
    api
      .get<{ quotaExhausted: boolean; entitlementTier: string; investorEmailsTotal: number }>("/api/sends/quota")
      .then((q) => {
        setPlan(q.entitlementTier);
        if (q.quotaExhausted && sessionStorage.getItem("gopitch_upgrade_dismissed") !== "1") setUpgrade({ tier: q.entitlementTier, limit: q.investorEmailsTotal });
      })
      .catch(() => {});
    const onExhausted = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      setUpgrade({ tier: d.tier ?? "FREE", limit: d.limit ?? 30 });
    };
    window.addEventListener(QUOTA_EXHAUSTED_EVENT, onExhausted);
    return () => window.removeEventListener(QUOTA_EXHAUSTED_EVENT, onExhausted);
  }, []);

  const dismissUpgrade = useCallback(() => {
    sessionStorage.setItem("gopitch_upgrade_dismissed", "1");
    setUpgrade(null);
  }, []);

  function logout() {
    clearToken();
    router.push("/login");
  }

  const nav = (
    <nav aria-label="Main" className="px-3 py-3 space-y-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${active ? "bg-verified-soft text-verified font-medium" : "text-ink-soft hover:text-ink hover:bg-surface-muted"}`}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="mt-auto border-t border-line px-3 py-3 space-y-1 text-sm">
      {user?.role === "ADMIN" && (
        <Link href="/admin" className="flex items-center gap-3 px-3 py-2 rounded text-ink-soft hover:text-ink hover:bg-surface-muted">
          <Shield size={16} aria-hidden /> Admin
        </Link>
      )}
      <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded text-ink-soft hover:text-ink hover:bg-surface-muted">
        <LogOut size={16} aria-hidden /> Sign out
      </button>
      <p className="px-3 pt-1 text-[11px] text-ink-soft truncate font-mono" title={user?.email}>
        {user?.email}
      </p>
    </div>
  );

  return (
    <div className="min-h-screen md:flex bg-paper">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn-primary">
        Skip to content
      </a>

      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-line bg-surface sticky top-0 h-screen">
        <Link href="/dashboard" className="font-display text-xl text-navy px-6 py-5">
          GoPitch
        </Link>
        <CompanySwitcher companies={companies} activeName={company?.name ?? null} onSelect={setCompanyId} />
        {nav}
        {footer}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-surface/90 backdrop-blur border-b border-line flex items-center justify-between gap-3 px-4 sm:px-8 h-14">
          <div className="flex items-center gap-2 min-w-0">
            <button className="md:hidden btn-ghost p-2 -ml-2" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="mobile-nav">
              <Menu size={18} />
            </button>
            <Link href="/dashboard" className="md:hidden font-display text-lg text-navy">
              GoPitch
            </Link>
            {company && <span className="hidden md:inline text-sm text-ink-soft truncate">{company.name}</span>}
          </div>
          <div className="flex items-center gap-2">
            {plan && (
              <Link href="/dashboard/billing" className="chip hover:border-ink-soft" title="Your plan">
                {plan === "FREE" ? "Free plan" : `${plan.charAt(0)}${plan.slice(1).toLowerCase()} plan`}
              </Link>
            )}
            <NotificationsBell unread={unread} onRead={() => setUnread(0)} />
          </div>
        </header>
        <main id="main" className="flex-1 min-w-0">
          {children}
        </main>
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-ink/40" onMouseDown={(e) => e.target === e.currentTarget && setMobileOpen(false)}>
          <div id="mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation" className="bg-surface w-72 max-w-[85vw] h-full flex flex-col shadow-card">
            <div className="flex items-center justify-between px-5 py-4">
              <span className="font-display text-xl text-navy">GoPitch</span>
              <button className="btn-ghost p-2" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X size={18} />
              </button>
            </div>
            <CompanySwitcher companies={companies} activeName={company?.name ?? null} onSelect={setCompanyId} />
            {nav}
            {footer}
          </div>
        </div>
      )}

      <UpgradePrompt open={!!upgrade && !pathname.startsWith("/dashboard/billing")} onClose={dismissUpgrade} tier={upgrade?.tier ?? "FREE"} limit={upgrade?.limit ?? 30} />
    </div>
  );
}

function CompanySwitcher({ companies, activeName, onSelect }: { companies: { id: string; name: string; onboardingComplete: boolean }[] | null; activeName: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!companies || companies.length === 0) return null;
  if (companies.length === 1) {
    return <p className="mx-6 mb-2 text-xs text-ink-soft truncate">{activeName}</p>;
  }
  return (
    <div ref={ref} className="relative mx-3 mb-1">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded border border-line text-sm hover:border-ink-soft">
        <span className="truncate">{activeName ?? "Select company"}</span>
        <ChevronsUpDown size={14} aria-hidden />
      </button>
      {open && (
        <ul role="listbox" aria-label="Companies" className="absolute z-40 mt-1 w-full card py-1 shadow-card">
          {companies.map((c) => (
            <li key={c.id}>
              <button
                role="option"
                aria-selected={c.name === activeName}
                onClick={() => {
                  onSelect(c.id);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-muted"
              >
                {c.name || "Untitled company"}
                {!c.onboardingComplete && <span className="ml-1 text-[10px] text-signal">draft</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Note {
  id: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

function NotificationsBell({ unread, onRead }: { unread: number; onRead: () => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    api.get<Note[]>("/api/notifications").then((n) => setNotes(n.slice(0, 8))).catch(() => setNotes([]));
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function markAll() {
    await api.post("/api/notifications/read-all").catch(() => {});
    setNotes((n) => n?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
    onRead();
  }

  return (
    <div ref={ref} className="relative">
      <button className="btn-ghost p-2 relative" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}>
        <Bell size={18} />
        {unread > 0 && <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-signal text-white text-[10px] leading-4 text-center">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] card shadow-card z-40" role="region" aria-label="Notifications">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line-soft">
            <p className="text-sm font-medium text-navy">Notifications</p>
            {unread > 0 && (
              <button className="text-xs text-verified hover:underline" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-line-soft">
            {notes === null ? (
              <li className="px-4 py-3 text-sm text-ink-soft">Loading…</li>
            ) : notes.length === 0 ? (
              <li className="px-4 py-6 text-sm text-ink-soft text-center">You're all caught up.</li>
            ) : (
              notes.map((n) => (
                <li key={n.id} className={`px-4 py-3 ${n.readAt ? "" : "bg-verified-soft/40"}`}>
                  <p className="text-sm text-ink">{n.title}</p>
                  {n.body && <p className="text-xs text-ink-soft mt-0.5">{n.body}</p>}
                  <p className="text-[10px] text-ink-soft mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                </li>
              ))
            )}
          </ul>
          <Link href="/dashboard/settings?tab=notifications" className="block text-center text-xs text-verified py-2.5 border-t border-line-soft hover:underline" onClick={() => setOpen(false)}>
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
