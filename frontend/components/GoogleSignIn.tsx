"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE, ApiError, api, homeFor, setStoredUser, setToken, StoredUser } from "@/lib/api";

const GOOGLE_ERRORS: Record<string, string> = {
  access_denied: "Google sign-in was cancelled.",
  invalid_state: "That sign-in attempt expired or was started in another browser. Please try again.",
  no_id_token: "Google didn't return an identity token. Please try again.",
  missing_profile: "Couldn't read your Google profile.",
  email_unverified: "Your Google account's email isn't verified, so it can't be used to sign in.",
  auth_failed: "Google authentication failed. Please try again.",
};

/** Safe post-login destination: only same-site paths, and never back to auth pages. */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login") || next.startsWith("/signup")) return null;
  return next;
}

export function completeSignIn(router: ReturnType<typeof useRouter>, token: string, user: StoredUser, next: string | null) {
  setToken(token);
  setStoredUser(user);
  const home = homeFor(user);
  // Founders who still need onboarding go there first; otherwise honour ?next=.
  router.replace(home === "/onboarding" ? home : safeNext(next) ?? home);
}

/** Handles ?google_code / ?google_error on return from Google, and ?expired from a lapsed session. */
export function GoogleRedirectHandler({ onError, onInfo }: { onError: (msg: string) => void; onInfo?: (msg: string) => void }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const code = searchParams.get("google_code");
    const googleError = searchParams.get("google_error");
    if (searchParams.get("expired")) onInfo?.("Your session expired. Please sign in again.");
    if (code) {
      // Remove the code from the address bar/history before using it.
      window.history.replaceState(null, "", window.location.pathname);
      api
        .post<{ token: string; user: StoredUser }>("/api/auth/google/exchange", { code })
        .then((res) => completeSignIn(router, res.token, res.user, searchParams.get("next")))
        .catch((err) => onError(err instanceof ApiError ? err.message : "Google sign-in failed. Please try again."));
    } else if (googleError) {
      onError(GOOGLE_ERRORS[googleError] || "Google authentication failed.");
    }
  }, [searchParams, router, onError, onInfo]);

  return null;
}

export function GoogleButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = `${API_BASE}/auth/google/signin`;
      }}
      className="w-full flex items-center justify-center gap-3 border border-line rounded bg-white py-2.5 text-sm font-medium text-ink hover:bg-line-soft transition-colors"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.3v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
      Continue with Google
    </button>
  );
}

export function OrDivider() {
  return (
    <div className="relative my-6">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-line" />
      </div>
      <div className="relative flex justify-center text-sm">
        <span className="px-3 bg-paper text-ink-soft">OR</span>
      </div>
    </div>
  );
}
