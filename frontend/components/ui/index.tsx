"use client";

/**
 * GoPitch design system primitives. Every page composes these instead of re-styling the
 * same element, so a status badge, empty state or metric looks identical everywhere.
 */
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { AlertTriangle, ChevronRight, Inbox, Loader2, RefreshCw, Search, X } from "lucide-react";

// ---------- Layout ----------
export function Page({ children, width = "page" }: { children: React.ReactNode; width?: "page" | "form" | "full" }) {
  const max = width === "form" ? "max-w-form" : width === "full" ? "max-w-none" : "max-w-page";
  return <div className={`${max} mx-auto px-4 sm:px-8 py-8 sm:py-10`}>{children}</div>;
}

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-soft">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} aria-hidden />}
            {c.href ? (
              <Link href={c.href} className="hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  crumbs?: Crumb[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 sm:mb-8">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl break-words">{title}</h1>
          {description && <p className="text-ink-soft text-sm mt-1 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({ title, description, actions, children, id }: { title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="card p-5 sm:p-6 scroll-mt-24">
      {(title || actions) && (
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
          <div>
            {title && <h2 className="font-display text-lg">{title}</h2>}
            {description && <p className="text-xs text-ink-soft mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------- Tabs (link-based so the URL keeps context on back/refresh) ----------
export function Tabs({ tabs, active, label }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          aria-current={t.key === active ? "page" : undefined}
          className={`shrink-0 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
            t.key === active ? "border-verified text-verified font-medium" : "border-transparent text-ink-soft hover:text-ink"
          }`}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 font-mono text-xs opacity-70">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

// ---------- Data display ----------
export function MetricCard({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "danger" | "signal" }) {
  const body = (
    <>
      <p className="label mb-1">{label}</p>
      <p className={`font-display text-2xl ${tone === "danger" ? "text-danger" : tone === "signal" ? "text-signal" : "text-navy"}`}>{value}</p>
      {hint && <p className="text-[11px] text-ink-soft mt-1">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="card p-4 block hover:border-ink-soft transition-colors">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-surface-muted text-ink-soft" },
  ACTIVE: { label: "Active", cls: "bg-verified-soft text-verified" },
  PAUSED: { label: "Paused", cls: "bg-signal-soft text-signal" },
  COMPLETED: { label: "Completed", cls: "bg-line-soft text-ink-soft" },
  CANCELLED: { label: "Cancelled", cls: "bg-line-soft text-ink-soft" },
  QUEUED: { label: "Queued", cls: "bg-surface-muted text-ink-soft" },
  SENT: { label: "Sent", cls: "bg-verified-soft text-verified" },
  REPLIED: { label: "Replied", cls: "bg-teal-soft text-teal" },
  BOUNCED: { label: "Bounced", cls: "bg-danger-soft text-danger" },
  FAILED: { label: "Failed", cls: "bg-danger-soft text-danger" },
  SKIPPED_CAP_REACHED: { label: "Skipped", cls: "bg-line-soft text-ink-soft" },
  CONFIRMED: { label: "Confirmed", cls: "bg-verified-soft text-verified" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-line-soft text-ink-soft" };
  return <span className={`inline-block text-[10px] uppercase tracking-wide font-medium px-2 py-0.5 rounded ${s.cls}`}>{label ?? s.label}</span>;
}

export function ScorePill({ score, coverage }: { score: number; coverage?: number }) {
  const tone = score >= 75 ? "bg-verified text-white" : score >= 50 ? "bg-verified-soft text-verified" : "bg-surface-muted text-ink-soft";
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[2.75rem] px-2 py-1 rounded font-mono text-sm ${tone}`}
      title={coverage != null ? `Match score ${score}/100, based on ${Math.round(coverage * 100)}% of the scoring criteria (the rest had no data)` : `Match score ${score}/100`}
    >
      {Math.round(score)}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} className="h-1.5 bg-line-soft rounded-full overflow-hidden">
      <div className="h-full bg-verified transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** Step indicator for multi-step flows (onboarding, campaign creation). */
export function ProgressIndicator({ steps, current, onSelect }: { steps: string[]; current: number; onSelect?: (i: number) => void }) {
  return (
    <ol className="flex gap-1.5" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li key={s} className="flex-1 min-w-0">
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(i)}
              aria-current={state === "current" ? "step" : undefined}
              className="w-full text-left group disabled:cursor-default"
            >
              <span className={`block h-1 rounded-full mb-1.5 ${state === "upcoming" ? "bg-line" : "bg-verified"}`} />
              <span className={`hidden md:block text-[11px] truncate ${state === "current" ? "text-navy font-medium" : "text-ink-soft"} ${onSelect ? "group-hover:text-ink" : ""}`}>
                {i + 1}. {s}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- States ----------
export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card p-8 sm:p-10 text-center">
      <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-surface-muted flex items-center justify-center text-ink-soft" aria-hidden>
        {icon ?? <Inbox size={18} />}
      </div>
      <p className="font-display text-lg text-navy">{title}</p>
      {description && <p className="text-sm text-ink-soft mt-1 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-5 flex justify-center gap-2 flex-wrap">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card p-6 border-danger/30 bg-danger-soft/40" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1">
          <p className="text-sm text-danger">{message}</p>
          {onRetry && (
            <button className="btn-secondary text-xs mt-3 inline-flex items-center gap-1.5" onClick={onRetry}>
              <RefreshCw size={12} aria-hidden /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Notice({ tone = "signal", children, action }: { tone?: "signal" | "danger" | "info"; children: React.ReactNode; action?: React.ReactNode }) {
  const cls =
    tone === "danger" ? "text-danger bg-danger-soft border-danger/20" : tone === "info" ? "text-teal bg-teal-soft border-teal/20" : "text-signal bg-signal-soft border-signal/20";
  return (
    <div className={`text-sm border rounded px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2 ${cls}`} role={tone === "danger" ? "alert" : "status"}>
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

export function LoadingSkeleton({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card p-4 animate-shimmer">
          <div className="h-3 bg-line-soft rounded w-1/3 mb-2" />
          <div className="h-3 bg-line-soft rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-soft" role="status">
      <Loader2 size={14} className="animate-spin" aria-hidden />
      {label}
    </span>
  );
}

// ---------- Inputs ----------
export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative flex-1 min-w-[12rem]">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden />
      <input className="input-field pl-8 pr-8" placeholder={placeholder} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" onClick={() => onChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-soft hover:text-ink" aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-4">{children}</div>;
}

export function SelectFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select className="input-field sm:w-auto" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}: any</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Label + control + hint + error, wired with ids for screen readers. */
export function FormField({
  label,
  hint,
  error,
  optional,
  sensitive,
  children,
  id: idProp,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  sensitive?: boolean;
  id?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-navy mb-1">
        {label}
        {optional && <span className="ml-1.5 text-xs font-normal text-ink-soft">Optional</span>}
        {sensitive && <span className="ml-1.5 text-xs font-normal text-signal">Confidential</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink-soft mt-1">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Comma/Enter separated tag entry. */
export function TagInput({ value, onChange, placeholder, id, max = 15, ...aria }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string; max?: number; "aria-describedby"?: string }) {
  const [draft, setDraft] = useState("");
  function commit(raw: string) {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])].slice(0, max));
    setDraft("");
  }
  return (
    <div className="input-field flex flex-wrap gap-1.5 items-center py-1.5 min-h-[2.5rem]">
      {value.map((t) => (
        <span key={t} className="chip bg-verified-soft border-verified/20 text-verified">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="hover:text-ink">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        id={id}
        {...aria}
        className="flex-1 min-w-[8rem] outline-none bg-transparent text-sm py-0.5"
        placeholder={value.length ? "" : placeholder}
        value={draft}
        onChange={(e) => (e.target.value.endsWith(",") ? commit(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && commit(draft)}
      />
    </div>
  );
}

/** Multi-select as toggle chips (business type, skills, investor types…). */
export function ChoiceChips({ options, value, onChange, multiple = true, label }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; multiple?: boolean; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(multiple ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : on ? [] : [o.value])}
            className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${on ? "border-verified bg-verified-soft text-verified" : "border-line bg-surface text-ink-soft hover:border-ink-soft"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Debounced value for search inputs. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const money = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US")}`);
const INVESTOR_TYPES: Record<string, string> = {
  VC: "VC",
  MICRO_VC: "Micro VC",
  ANGEL: "Angel",
  ANGEL_NETWORK: "Angel network",
  CVC: "Corporate VC",
  ACCELERATOR: "Accelerator",
  FAMILY_OFFICE: "Family office",
  SYNDICATE: "Syndicate",
  OTHER: "Other",
};
export const investorTypeLabel = (t: string) => INVESTOR_TYPES[t] ?? t;
export const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
