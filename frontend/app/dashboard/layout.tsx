"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, getStoredUser, api } from "@/lib/api";

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
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const stored = getStoredUser();
    setUser(stored);
    api
      .get<{ readAt: string | null }[]>("/api/notifications")
      .then((n) => setUnreadCount(n.filter((x) => !x.readAt).length))
      .catch(() => {});
  }, [pathname]);

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-line bg-white flex flex-col shrink-0">
        <Link href="/dashboard" className="font-display text-lg px-6 py-5 border-b border-line">
          Pitch-OS
        </Link>
        <nav className="flex-1 py-4">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between px-6 py-2.5 text-sm transition-colors ${
                  active ? "text-verified bg-verified-soft border-r-2 border-verified" : "text-ink-soft hover:text-ink"
                }`}
              >
                {item.label}
                {item.label === "Notifications" && unreadCount > 0 && (
                  <span className="text-[10px] bg-signal text-white rounded-full px-1.5">{unreadCount}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 py-4 border-t border-line text-xs text-ink-soft">
          <p className="font-mono truncate mb-2">{user?.email}</p>
          <button onClick={logout} className="hover:text-ink transition-colors">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
