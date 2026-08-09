"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, ApiError } from "@/lib/api";

interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  isDefault: boolean;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);

  function refresh() {
    api.get<Template[]>("/api/email-templates").then(setTemplates).catch(() => toast.error("Couldn't load templates."));
  }

  useEffect(refresh, []);

  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-display text-2xl">Email templates</h1>
        {!showForm && (
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            + New template
          </button>
        )}
      </div>
      <p className="text-ink-soft text-sm mb-8">
        Reusable starting points for your own manual follow-ups. Campaign outreach emails are
        still generated per-investor from real match reasoning — templates don't replace that.
      </p>

      {showForm && (
        <TemplateForm
          initial={editing}
          onSaved={() => {
            refresh();
            setShowForm(false);
            setEditing(null);
          }}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}

      {templates === null ? (
        <p className="text-ink-soft text-sm">Loading…</p>
      ) : templates.length === 0 && !showForm ? (
        <div className="card p-10 text-center">
          <p className="text-ink-soft text-sm">No templates yet.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map((t) => (
            <div key={t.id} className="card p-5 animate-fade-up">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm">{t.name}</h3>
                  {t.isDefault && (
                    <span className="text-[10px] bg-verified-soft text-verified px-1.5 py-0.5 rounded">Default</span>
                  )}
                </div>
                <div className="flex gap-3 text-xs">
                  <button
                    className="text-ink-soft hover:text-ink transition-colors"
                    onClick={() => {
                      setEditing(t);
                      setShowForm(true);
                    }}
                  >
                    Edit
                  </button>
                  <DeleteButton templateId={t.id} onDeleted={refresh} />
                </div>
              </div>
              <p className="text-xs text-ink-soft">{t.subject}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteButton({ templateId, onDeleted }: { templateId: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    try {
      await api.delete(`/api/email-templates/${templateId}`);
      toast.success("Template deleted.");
      onDeleted();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't delete template.");
    }
  }

  if (confirming) {
    return (
      <button className="text-danger" onClick={handleDelete}>
        Confirm?
      </button>
    );
  }
  return (
    <button className="text-ink-soft hover:text-danger transition-colors" onClick={() => setConfirming(true)}>
      Delete
    </button>
  );
}

function TemplateForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: Template | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    subject: initial?.subject ?? "",
    body: initial?.body ?? "",
    isDefault: initial?.isDefault ?? false,
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (initial) {
        await api.patch(`/api/email-templates/${initial.id}`, form);
      } else {
        await api.post("/api/email-templates", form);
      }
      toast.success("Template saved.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't save template.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 mb-6 space-y-3 animate-fade-up">
      <input
        required
        placeholder="Template name"
        className="input-field"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <input
        required
        placeholder="Subject"
        className="input-field"
        value={form.subject}
        onChange={(e) => setForm({ ...form, subject: e.target.value })}
      />
      <textarea
        required
        rows={6}
        placeholder="Body"
        className="input-field"
        value={form.body}
        onChange={(e) => setForm({ ...form, body: e.target.value })}
      />
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
        />
        Set as default
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save template"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
