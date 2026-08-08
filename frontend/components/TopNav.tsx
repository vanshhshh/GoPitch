"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearToken, getStoredUser } from "@/lib/api";
import { useEffect, useState } from "react";

export function TopNav() {
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <nav className="border-b border-line bg-white/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href={user?.role === "ADMIN" ? "/admin" : "/dashboard"} className="font-display text-lg tracking-tight">
          GoPitch
        </Link>
        {user && (
          <div className="flex items-center gap-4 text-sm text-ink-soft">
            <span className="font-mono text-xs">{user.email}</span>
            {user.role === "ADMIN" && (
              <span className="text-[10px] uppercase tracking-wide bg-signal-soft text-signal px-2 py-0.5 rounded">
                Admin
              </span>
            )}
            <button onClick={logout} className="hover:text-ink transition-colors">
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
