"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, setToken, setStoredUser } from "@/lib/api";

function GoogleHandler({ onError }: { onError: (msg: string) => void }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const token = searchParams.get("google_token");
    const googleError = searchParams.get("google_error");
    if (token) {
      setToken(token);
      api.get<{ id: string; email: string; role: string; hasCompany: boolean }>("/api/auth/me")
        .then((user) => {
          setStoredUser(user);
          if (user.hasCompany) {
            router.push(user.role === "ADMIN" ? "/admin" : "/dashboard");
          } else {
            router.push("/onboarding");
          }
        })
        .catch(() => router.push("/login"));
    } else if (googleError) {
      const messages: Record<string, string> = {
        access_denied: "Google sign-in was cancelled.",
        invalid_state: "Invalid OAuth state. Please try again.",
        no_id_token: "Failed to get identity token from Google.",
        missing_profile: "Could not retrieve your Google profile.",
        auth_failed: "Google authentication failed. Please try again.",
      };
      onError(messages[googleError] || "Google authentication failed.");
    }
  }, [searchParams, router, onError]);

  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: { id: string; email: string; role: string } }>(
        "/api/auth/login",
        { email, password }
      );
      setToken(res.token);
      setStoredUser(res.user);
      router.push(res.user.role === "ADMIN" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-up">
        <Link href="/" className="text-sm text-ink-soft hover:text-ink inline-block mb-4">
          ← Back to home
        </Link>
        <h1 className="font-display text-3xl mb-1">GoPitch</h1>
        <p className="text-ink-soft text-sm mb-8">Sign in to continue your raise.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label block mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="label block mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
            />
          </div>
          {error && (
            <div className="text-sm text-danger bg-danger-soft border border-danger/20 rounded px-3 py-2">
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-line"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-3 bg-white text-ink-soft">OR</span>
          </div>
        </div>

        <Suspense fallback={null}>
          <GoogleHandler onError={setError} />
        </Suspense>

        <button
          type="button"
          onClick={() => { window.location.href = `${process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000"}/auth/google/signin`; }}
          className="w-full flex items-center justify-center gap-3 border border-line rounded bg-white py-2.5 text-sm font-medium text-ink hover:bg-line-soft transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.3v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

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
