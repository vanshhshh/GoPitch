"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CloudOff, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api";

export type SaveState = { status: "idle" | "saving" | "saved" | "error"; message?: string; field?: string };

/**
 * Debounced autosave: each change waits `delay` ms of quiet, then saves the latest value.
 * Saves never overlap; a change during a save is saved right after. `flush()` saves
 * immediately (used before navigating to the next step).
 */
export function useAutosave<T>(value: T, save: (v: T) => Promise<void>, delay = 800) {
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const latest = useRef(value);
  const dirty = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Only content that differs from what was last saved (or loaded) is saved — no saves on
  // mount, on React's dev-mode double effects, or when an edit is reverted.
  const lastSaved = useRef(JSON.stringify(value));
  const saveRef = useRef(save);
  saveRef.current = save;

  const run = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    if (!dirty.current) return true;
    dirty.current = false;
    const snapshot = JSON.stringify(latest.current);
    if (snapshot === lastSaved.current) return true;
    setState({ status: "saving" });
    let ok = true;
    inFlight.current = saveRef
      .current(latest.current)
      .then(() => {
        lastSaved.current = snapshot;
        setState({ status: "saved" });
      })
      .catch((err) => {
        ok = false;
        dirty.current = true;
        setState({
          status: "error",
          message: err instanceof ApiError ? err.message : "Couldn't save — check your connection.",
          field: err instanceof ApiError ? err.body?.details?.field : undefined,
        });
      })
      .finally(() => (inFlight.current = null));
    await inFlight.current;
    return ok;
  }, []);

  useEffect(() => {
    latest.current = value;
    if (JSON.stringify(value) === lastSaved.current) return;
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
    return () => clearTimeout(timer.current);
  }, [value, delay, run]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    return run();
  }, [run]);

  return { state, flush };
}

export function SaveStatus({ state }: { state: SaveState }) {
  if (state.status === "idle") return <span className="text-xs text-ink-soft">Changes save automatically</span>;
  if (state.status === "saving")
    return (
      <span className="text-xs text-ink-soft inline-flex items-center gap-1" role="status">
        <Loader2 size={12} className="animate-spin" aria-hidden /> Saving…
      </span>
    );
  if (state.status === "saved")
    return (
      <span className="text-xs text-verified inline-flex items-center gap-1" role="status">
        <Check size={12} aria-hidden /> Saved
      </span>
    );
  return (
    <span className="text-xs text-danger inline-flex items-center gap-1" role="alert">
      <CloudOff size={12} aria-hidden /> {state.message}
    </span>
  );
}
