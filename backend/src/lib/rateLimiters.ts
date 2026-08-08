import rateLimit from "express-rate-limit";

/**
 * Rate limits auth endpoints specifically (not the whole API) — login/signup are the
 * highest-value brute-force targets. 20 requests per 15 minutes per IP is generous
 * enough for a real user who mistypes a password a few times, tight enough to make
 * credential-stuffing impractical.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes." },
});

/** Looser general API limiter — protects against runaway scripts/bugs, not meant to
 * constrain normal interactive use. */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Slow down." },
});

/** Tighter limiter for public, unauthenticated write endpoints (contact form) — these
 * have no per-user identity to rate-limit against, so IP-based limiting needs to be
 * strict enough to block spam/abuse without a login wall in the way. */
export const publicWriteRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Try again later." },
});
