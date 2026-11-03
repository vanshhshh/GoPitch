"use client";

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex items-center justify-between gap-3 mt-4 text-sm" aria-label="Pagination">
      <p className="text-ink-soft text-xs">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex gap-2">
        <button className="btn-secondary text-xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span className="text-xs text-ink-soft self-center font-mono">
          {page}/{pages}
        </span>
        <button className="btn-secondary text-xs" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}
