"use client";

import { useEffect } from "react";

/** Accessible overlay dialog: Escape and backdrop click close it; body scroll is locked while open. */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-ink/50 flex items-center justify-center p-4 z-50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className="bg-white rounded-lg shadow-card p-6 sm:p-8 max-w-md w-full max-h-[90vh] overflow-y-auto animate-fade-up">
        {children}
      </div>
    </div>
  );
}
