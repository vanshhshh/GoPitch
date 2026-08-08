"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, getStoredUser } from "@/lib/api";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/companies", label: "Companies" },
  { href: "/admin/investors", label: "Investors" },
  { href: "/admin/campaigns", label: "Campaigns" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/support", label: "Support" },
  { href: "/admin/settings", label: "Settings" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string } | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r border-line bg-white flex flex-col shrink-0">
        <Link href="/admin" className="font-display text-lg px-6 py-5 border-b border-line flex items-center gap-2">
          Pitch-OS
          <span className="text-[10px] uppercase tracking-wide bg-signal-soft text-signal px-1.5 py-0.5 rounded">
            Admin
          </span>
        </Link>
        <nav className="flex-1 py-4">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block px-6 py-2.5 text-sm transition-colors ${
                  active ? "text-verified bg-verified-soft border-r-2 border-verified" : "text-ink-soft hover:text-ink"
                }`}
              >
                {item.label}
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
