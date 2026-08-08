"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[] | null>(null);

  function refresh() {
    api.get<Notification[]>("/api/notifications").then(setNotifications);
  }

  useEffect(refresh, []);

  async function markRead(id: string) {
    await api.post(`/api/notifications/${id}/read`);
    refresh();
  }

  async function markAllRead() {
    await api.post("/api/notifications/read-all");
    refresh();
  }

  const unreadCount = notifications?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display text-2xl">Notifications</h1>
        {unreadCount > 0 && (
          <button className="text-sm text-verified hover:underline" onClick={markAllRead}>
            Mark all read
          </button>
        )}
      </div>
      <p className="text-ink-soft text-sm mb-8">Campaign activity, sends, and account alerts.</p>

      {notifications === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : notifications.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm">Nothing yet.</p>
        </div>
      ) : (
        <div className="card divide-y divide-line-soft">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.readAt && markRead(n.id)}
              className={`w-full text-left p-4 transition-colors ${!n.readAt ? "bg-verified-soft/40" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="text-xs text-ink-soft mt-0.5">{n.body}</p>}
                </div>
                {!n.readAt && <span className="w-2 h-2 rounded-full bg-verified shrink-0 mt-1.5" />}
              </div>
              <p className="text-[10px] text-ink-soft mt-2">{new Date(n.createdAt).toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
