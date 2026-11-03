export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export interface StoredUser {
  id: string;
  email: string;
  role: string;
  name?: string | null;
  hasCompany?: boolean;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("gopitch_token");
}

export function setToken(token: string) {
  localStorage.setItem("gopitch_token", token);
}

export function clearToken() {
  localStorage.removeItem("gopitch_token");
  localStorage.removeItem("gopitch_user");
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("gopitch_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user: StoredUser) {
  localStorage.setItem("gopitch_user", JSON.stringify(user));
}

/** Where a user belongs right after signing in: admins → /admin, founders without a company → onboarding. */
export function homeFor(user: { role: string; hasCompany?: boolean }): string {
  if (user.role === "ADMIN") return "/admin";
  return user.hasCompany === false ? "/onboarding" : "/dashboard";
}

// Auth endpoints answer 401 for bad credentials — that's not an expired session.
const SESSION_EXEMPT = ["/api/auth/login", "/api/auth/signup", "/api/auth/google/exchange"];

function handleExpiredSession(path: string) {
  if (typeof window === "undefined" || SESSION_EXEMPT.some((p) => path.startsWith(p))) return;
  if (!getToken()) return;
  clearToken();
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?expired=1&next=${next}`;
}

async function parse<T>(path: string, res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) handleExpiredSession(path);
    throw new ApiError(data.error || `Request failed with status ${res.status}`, res.status, data);
  }
  return data as T;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError("Can't reach GoPitch right now. Check your connection and try again.", 0);
  }
  return parse<T>(path, res);
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  postForm: async <T,>(path: string, formData: FormData) => {
    const token = getToken();
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
    } catch {
      throw new ApiError("Can't reach GoPitch right now. Check your connection and try again.", 0);
    }
    return parse<T>(path, res);
  },
};

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Starts Gmail connection. The consent URL is fetched with the Authorization header (the
 * session token never goes in a URL). `returnTo` is where to go after the connection is
 * confirmed on the Settings page.
 */
export async function startGmailConnect(returnTo?: string) {
  if (returnTo) sessionStorage.setItem("gopitch_gmail_return_to", returnTo);
  const { url } = await api.post<{ url: string }>("/api/profile/gmail/connect");
  window.location.href = url;
}

export function takeGmailReturnTo(): string | null {
  const value = sessionStorage.getItem("gopitch_gmail_return_to");
  sessionStorage.removeItem("gopitch_gmail_return_to");
  return value && value.startsWith("/") ? value : null;
}

/** Downloads an uploaded deck with the session header (a plain link can't send it). */
export async function downloadDeck(deckId: string, fileName: string) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/decks/file/${deckId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || "Couldn't open the deck.", res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
