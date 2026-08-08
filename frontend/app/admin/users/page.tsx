"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  sendReputationScore: number;
  complaintReportedAt: string | null;
  campaignCount: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);

  function refresh() {
    api.get<AdminUser[]>("/api/admin/users").then(setUsers);
  }
  useEffect(refresh, []);

  async function clearComplaint(id: string) {
    try {
      await api.post(`/api/admin/users/${id}/clear-complaint`);
      toast.success("Complaint cleared, sending resumed.");
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't clear.");
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-10">
      <h1 className="font-display text-2xl mb-1">Founders</h1>
      <p className="text-ink-soft text-sm mb-8">Every founder account, with send health at a glance.</p>

      {users === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : (
        <div className="card divide-y divide-line-soft">
          {users.map((u) => (
            <div key={u.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{u.email}</p>
                <p className="text-xs text-ink-soft font-mono">
                  {u.campaignCount} campaigns · reputation {u.sendReputationScore.toFixed(2)} · joined{" "}
                  {new Date(u.createdAt).toLocaleDateString()}
                </p>
              </div>
              {u.complaintReportedAt && (
                <button className="btn-secondary text-xs" onClick={() => clearComplaint(u.id)}>
                  Clear spam flag
                </button>
              )}
            </div>
          ))}
          {users.length === 0 && <p className="p-4 text-sm text-ink-soft">No founders yet.</p>}
        </div>
      )}
    </div>
  );
}
