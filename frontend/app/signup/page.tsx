"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, StoredUser } from "@/lib/api";
import { GoogleButton, GoogleRedirectHandler, OrDivider, completeSignIn } from "@/components/GoogleSignIn";

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*[0-9]).{8,128}$/;

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const onError = useCallback((msg: string) => setError(msg), []);
  const passwordOk = PASSWORD_RULE.test(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordOk) {
      setError("Password must be at least 8 characters and include a letter and a number.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: StoredUser }>("/api/auth/signup", { email, password, name });
      completeSignIn(router, res.token, res.user, null);
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
        <h1 className="font-display text-3xl mb-1">Start your raise</h1>
        <p className="text-ink-soft text-sm mb-8">Deck, matched investors, and outreach — one flow. Free to start.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="label block mb-1.5">Your name</span>
            <input type="text" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="Full name" autoComplete="name" />
          </label>
          <label className="block">
            <span className="label block mb-1.5">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" placeholder="you@company.com" autoComplete="email" />
          </label>
          <label className="block">
            <span className="label block mb-1.5">Password</span>
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              autoComplete="new-password"
              aria-describedby="password-hint"
            />
            <span id="password-hint" className={`text-xs mt-1 block ${password && !passwordOk ? "text-danger" : "text-ink-soft"}`}>
              At least 8 characters, including a letter and a number.
            </span>
          </label>
          {error && (
            <div className="text-sm text-danger bg-danger-soft border border-danger/20 rounded px-3 py-2" role="alert">
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <OrDivider />
        <Suspense fallback={null}>
          <GoogleRedirectHandler onError={onError} />
        </Suspense>
        <GoogleButton />

        <p className="text-sm text-ink-soft mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-verified hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
