"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, StoredUser } from "@/lib/api";

export interface CompanySummary {
  id: string;
  name: string;
  oneLiner: string | null;
  onboardingComplete: boolean;
}

interface Workspace {
  user: StoredUser | null;
  companies: CompanySummary[] | null;
  /** The active company; every company-scoped page reads from here. */
  companyId: string | null;
  company: CompanySummary | null;
  setCompanyId: (id: string) => void;
  refreshCompanies: () => Promise<void>;
}

const Ctx = createContext<Workspace | null>(null);
const KEY = "gopitch_active_company";

export function WorkspaceProvider({ user, children }: { user: StoredUser | null; children: React.ReactNode }) {
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [companyId, setCompanyIdState] = useState<string | null>(null);

  const refreshCompanies = useCallback(async () => {
    try {
      const list = await api.get<CompanySummary[]>("/api/company-profile/companies");
      setCompanies(list);
      setCompanyIdState((current) => {
        const stored = current ?? safeGet(KEY);
        if (stored && list.some((c) => c.id === stored)) return stored;
        return list.find((c) => c.onboardingComplete)?.id ?? list[0]?.id ?? null;
      });
    } catch {
      setCompanies([]);
    }
  }, []);

  useEffect(() => {
    if (user) refreshCompanies();
  }, [user, refreshCompanies]);

  const setCompanyId = useCallback((id: string) => {
    setCompanyIdState(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  }, []);

  const company = companies?.find((c) => c.id === companyId) ?? null;
  return <Ctx.Provider value={{ user, companies, companyId, company, setCompanyId, refreshCompanies }}>{children}</Ctx.Provider>;
}

function safeGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useWorkspace(): Workspace {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside the dashboard");
  return ctx;
}

/** Appends ?companyId= for company-scoped API calls. */
export function withCompany(path: string, companyId: string | null) {
  if (!companyId) return path;
  return `${path}${path.includes("?") ? "&" : "?"}companyId=${encodeURIComponent(companyId)}`;
}
