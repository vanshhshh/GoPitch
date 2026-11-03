"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getStoredUser, getToken, setStoredUser, StoredUser } from "@/lib/api";
import { WorkspaceProvider } from "@/lib/workspace";
import { AppShell } from "@/components/AppShell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);

  // Validate the session with the server, not just the presence of a token.
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
        // Founders finish onboarding before using company features. Overview (which points
        // them back to onboarding), Settings and Billing stay reachable.
        const open = pathname === "/dashboard" || pathname.startsWith("/dashboard/settings") || pathname.startsWith("/dashboard/billing");
        if (me.role !== "ADMIN" && me.hasCompany === false && !open) {
          router.replace("/onboarding");
        }
      })
      .catch(() => {}); // 401 is handled globally (redirect to /login)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!user) return <div className="min-h-screen flex items-center justify-center text-sm text-ink-soft">Loading…</div>;

  return (
    <WorkspaceProvider user={user}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
