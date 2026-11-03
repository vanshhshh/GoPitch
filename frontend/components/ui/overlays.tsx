"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/Modal";

/** Moves focus into an overlay, keeps Tab inside it, and restores focus on close. */
function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(ref.current!.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, ref]);
}

/** Side panel for quick inspection without leaving the list (full screen on phones). */
export function DetailDrawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="bg-paper w-full sm:max-w-lg h-full flex flex-col shadow-card animate-fade-up">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line bg-surface">
          <h2 className="font-display text-lg truncate">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="border-t border-line bg-surface px-5 py-3 flex flex-wrap gap-2 justify-end">{footer}</div>}
      </div>
    </div>
  );
}

/** Explicit confirmation for destructive or irreversible actions. */
export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} labelledBy="confirm-title">
      <h3 id="confirm-title" className="font-display text-xl mb-2">
        {title}
      </h3>
      <div className="text-sm text-ink-soft mb-6">{message}</div>
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <button className="btn-secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className={destructive ? "btn-danger" : "btn-primary"} onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
  /** Hidden in the mobile card layout (still visible on desktop). */
  hideOnMobile?: boolean;
}

/** Table on desktop, stacked cards on phones — no horizontal scrolling. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, caption }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; caption: string }) {
  return (
    <>
      <div className="hidden md:block card overflow-hidden">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-muted text-left">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`px-4 py-2.5 label font-medium ${c.className ?? ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                className={onRowClick ? "hover:bg-surface-muted/60 cursor-pointer" : ""}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-top ${c.className ?? ""}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden space-y-2" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)}>
            <div
              className={`card p-4 space-y-2 ${onRowClick ? "cursor-pointer" : ""}`}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="flex items-start justify-between gap-3 text-sm">
                    <span className="label shrink-0 pt-0.5">{c.header}</span>
                    <span className="text-right min-w-0">{c.render(r)}</span>
                  </div>
                ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
