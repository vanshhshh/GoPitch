"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { clearToken, getStoredUser, getToken, api, setStoredUser, StoredUser } from "@/lib/api";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { QUOTA_EXHAUSTED_EVENT } from "@/lib/events";

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/campaigns", label: "Campaigns" },
  { href: "/dashboard/templates", label: "Email templates" },
  { href: "/dashboard/outreach", label: "Outreach" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/notifications", label: "Notifications" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [upgrade, setUpgrade] = useState<{ tier: string; limit: number } | null>(null);

  // Validate the session with the server once, not just the presence of a token.
  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setUser(getStoredUser());
    api
      .get<StoredUser>("/api/auth/me")
      .then((me) => {
        setStoredUser(me);
        setUser(me);
      })
      .catch(() => {}); // a 401 is handled globally by lib/api (redirects to /login)

    api
      .get<{ quotaExhausted: boolean; entitlementTier: string; investorEmailsTotal: number }>("/api/sends/quota")
      .then((q) => {
        if (q.quotaExhausted && sessionStorage.getItem("gopitch_upgrade_dismissed") !== "1") {
          setUpgrade({ tier: q.entitlementTier, limit: q.investorEmailsTotal });
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    if (!getToken()) return;
    api
      .get<{ unread: number }>("/api/notifications/unread-count")
      .then((n) => setUnreadCount(n.unread))
      .catch(() => {});
  }, [pathname]);

  useEffect(() => {
    const onExhausted = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      setUpgrade({ tier: detail.tier ?? "FREE", limit: detail.limit ?? 30 });
    };
    window.addEventListener(QUOTA_EXHAUSTED_EVENT, onExhausted);
    return () => window.removeEventListener(QUOTA_EXHAUSTED_EVENT, onExhausted);
  }, []);

  const dismissUpgrade = useCallback(() => {
    sessionStorage.setItem("gopitch_upgrade_dismissed", "1");
    setUpgrade(null);
  }, []);

  // Signed-out visitors are redirected; don't mount pages (and fire API calls) meanwhile.
  if (!user) return <div className="min-h-screen flex items-center justify-center text-sm text-ink-soft">Loading…</div>;

  function logout() {
    clearToken();
    router.push("/login");
  }

  const nav = (
    <nav className="flex-1 py-4" aria-label="Dashboard">
      {NAV.map((item) => {
        const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between px-6 py-2.5 text-sm transition-colors ${
              active ? "text-verified bg-verified-soft border-r-2 border-verified" : "text-ink-soft hover:text-ink"
            }`}
          >
            {item.label}
            {item.label === "Notifications" && unreadCount > 0 && (
              <span className="text-[10px] bg-signal text-white rounded-full px-1.5" aria-label={`${unreadCount} unread`}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="px-6 py-4 border-t border-line text-xs text-ink-soft">
      <p className="font-mono truncate mb-2" title={user?.email}>
        {user?.email}
      </p>
      {user?.role === "ADMIN" && (
        <Link href="/admin" className="block mb-2 hover:text-ink transition-colors">
          Admin panel
        </Link>
      )}
      <button onClick={logout} className="hover:text-ink transition-colors">
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen md:flex">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-white border-b border-line flex items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="font-display text-lg">
          GoPitch
        </Link>
        <button className="btn-secondary text-xs" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-controls="mobile-nav">
          {menuOpen ? "Close" : "Menu"}
          {!menuOpen && unreadCount > 0 && <span className="ml-1.5 text-[10px] bg-signal text-white rounded-full px-1.5">{unreadCount}</span>}
        </button>
      </header>
      {menuOpen && (
        <div id="mobile-nav" className="md:hidden bg-white border-b border-line flex flex-col">
          {nav}
          {footer}
        </div>
      )}

      <aside className="hidden md:flex w-56 border-r border-line bg-white flex-col shrink-0 sticky top-0 h-screen">
        <Link href="/dashboard" className="font-display text-lg px-6 py-5 border-b border-line">
          GoPitch
        </Link>
        {nav}
        {footer}
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      <UpgradePrompt open={!!upgrade && !pathname.startsWith("/dashboard/billing")} onClose={dismissUpgrade} tier={upgrade?.tier ?? "FREE"} limit={upgrade?.limit ?? 30} />
    </div>
  );
}
