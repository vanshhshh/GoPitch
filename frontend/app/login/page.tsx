"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, ApiError, setToken, setStoredUser } from "@/lib/api";

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
        <h1 className="font-display text-3xl mb-1">Pitch-OS</h1>
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
