import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET) {
  // Fail loudly at boot, not silently at the first login attempt in production
  throw new Error("JWT_SECRET is not set. Add it to .env before starting the server.");
}

export interface AuthTokenPayload {
  userId: string;
  role: "FOUNDER" | "ADMIN";
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

/** Requires a valid JWT for any logged-in user, founder or admin. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header." });
  }
  try {
    const token = header.slice("Bearer ".length);
    req.auth = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

/** Requires the authenticated user to be an admin. Must run after requireAuth. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}
