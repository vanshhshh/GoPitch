"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError, getStoredUser, getToken, homeFor, StoredUser } from "@/lib/api";
import { GoogleButton, GoogleRedirectHandler, OrDivider, completeSignIn } from "@/components/GoogleSignIn";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const onError = useCallback((msg: string) => setError(msg), []);
  const onInfo = useCallback((msg: string) => setInfo(msg), []);

  // Already signed in (e.g. back button to /login): go home instead of showing the form.
  useEffect(() => {
    const user = getStoredUser();
    if (getToken() && user && !searchParams.get("google_code") && !searchParams.get("expired")) router.replace(homeFor(user));
  }, [router, searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: StoredUser }>("/api/auth/login", { email, password });
      completeSignIn(router, res.token, res.user, searchParams.get("next"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6">
      <div className="w-full max-w-sm animate-fade-up">
        <Link href="/" className="text-sm text-ink-soft hover:text-ink inline-block mb-4">
          ← Back to home
        </Link>
        <h1 className="font-display text-3xl mb-1">GoPitch</h1>
        <p className="text-ink-soft text-sm mb-8">Sign in to continue your raise.</p>

        {info && !error && (
          <div className="text-sm text-signal bg-signal-soft border border-signal/20 rounded px-3 py-2 mb-4" role="status">
            {info}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="label block mb-1.5">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" placeholder="you@company.com" autoComplete="email" />
          </label>
          <label className="block">
            <span className="label block mb-1.5">Password</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input-field" autoComplete="current-password" />
          </label>
          {error && (
            <div className="text-sm text-danger bg-danger-soft border border-danger/20 rounded px-3 py-2" role="alert">
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-xs text-ink-soft">
            Forgot your password?{" "}
            <Link href="/contact" className="text-verified hover:underline">
              Contact support
            </Link>{" "}
            to reset it.
          </p>
        </form>

        <OrDivider />
        <GoogleRedirectHandler onError={onError} onInfo={onInfo} />
        <GoogleButton />

        <p className="text-sm text-ink-soft mt-6">
          New here?{" "}
          <Link href="/signup" className="text-verified hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
