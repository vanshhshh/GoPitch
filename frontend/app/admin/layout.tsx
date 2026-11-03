"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, clearToken, getStoredUser } from "@/lib/api";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/companies", label: "Companies" },
  { href: "/admin/investors", label: "Investors" },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/leads", label: "Enterprise enquiries" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/settings", label: "Settings" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string } | null>(null);

  useEffect(() => {
    const stored = getStoredUser();
    const token = localStorage.getItem("gopitch_token");
    if (!stored || !token) {
      router.replace("/login?next=/admin");
      return;
    }
    // Founders never see the admin shell; the role is re-checked server-side on every call too.
    if (stored.role !== "ADMIN") {
      router.replace("/dashboard");
      return;
    }
    setUser(stored);
    api
      .get<{ role: string; email: string }>("/api/auth/me")
      .then((me) => me.role !== "ADMIN" && router.replace("/dashboard"))
      .catch(() => {});
  }, [router]);

  if (!user) return <div className="min-h-screen flex items-center justify-center text-sm text-ink-soft">Loading…</div>;

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="md:w-56 border-b md:border-b-0 md:border-r border-line bg-white flex flex-col shrink-0 md:sticky md:top-0 md:h-screen">
        <Link href="/admin" className="font-display text-lg px-6 py-5 border-b border-line flex items-center gap-2">
          GoPitch
          <span className="text-[10px] uppercase tracking-wide bg-signal-soft text-signal px-1.5 py-0.5 rounded">
            Admin
          </span>
        </Link>
        <nav className="flex md:block md:flex-1 overflow-x-auto md:py-4" aria-label="Admin">
          {NAV.map((item) => {
            const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block shrink-0 whitespace-nowrap px-4 md:px-6 py-2.5 text-sm transition-colors ${
                  active ? "text-verified bg-verified-soft border-r-2 border-verified" : "text-ink-soft hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <button onClick={logout} className="md:hidden shrink-0 whitespace-nowrap px-4 py-2.5 text-sm text-ink-soft">
            Sign out
          </button>
        </nav>
        <div className="hidden md:block px-6 py-4 border-t border-line text-xs text-ink-soft">
          <p className="font-mono truncate mb-2">{user?.email}</p>
          <button onClick={logout} className="hover:text-ink transition-colors">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
