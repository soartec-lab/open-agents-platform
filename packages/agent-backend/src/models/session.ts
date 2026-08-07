/**
 * App-session authentication.
 *
 * ── Auth model ────────────────────────────────────────────────────────────────
 *   The browser authenticates to the backend with an APP-SESSION token: a signed,
 *   expiring bearer token issued by `POST /session`. Every protected route
 *   (the REST surface and the read-only `/agents/*` observation endpoints)
 *   requires it. The token's subject (`sub`) is the app-session id.
 *
 *   There is no external IdP, so `POST /session` issues a token for a
 *   client-chosen (or generated) session id. The signing/verification machinery
 *   is real (HMAC-SHA256, expiry-checked, constant-time compare) to keep the
 *   production shape; wiring it to a real IdP is a drop-in replacement of the
 *   `issueSession` entry point.
 *
 * This module owns the token crypto (issue/verify) and the session-subject
 * context contract (`setSessionSubject`/`sessionIdOf` around a private key).
 * The Hono middleware itself lives in src/middlewares/require-session.ts and
 * is imported ONLY by src/middlewares/index.ts — handlers read the subject
 * through `sessionIdOf` here, never through the middleware module. This module
 * is part of the backend layer AROUND flue and has no flue dependency.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { APP_SESSION_SECRET, APP_SESSION_TTL_SECONDS } from "../config.ts";

interface SessionClaims {
  /** App-session subject id. */
  sub: string;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string): string {
  return base64url(createHmac("sha256", APP_SESSION_SECRET).update(payload).digest());
}

/** Issue a signed app-session token for a (possibly new) subject id. */
export function issueSession(subject?: string): {
  token: string;
  sessionId: string;
  expiresIn: number;
} {
  const sub = subject && subject.length > 0 ? subject : `sess_${randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { sub, iat: now, exp: now + APP_SESSION_TTL_SECONDS };
  const body = base64url(JSON.stringify(claims));
  const token = `${body}.${sign(body)}`;
  return { token, sessionId: sub, expiresIn: APP_SESSION_TTL_SECONDS };
}

/** Verify a token and return its subject, or null if invalid/expired. */
export function verifySession(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = sign(body);
  // Constant-time compare; lengths must match for timingSafeEqual.
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: SessionClaims;
  try {
    claims = JSON.parse(base64urlDecode(body).toString("utf8")) as SessionClaims;
  } catch {
    return null;
  }
  if (typeof claims.sub !== "string" || typeof claims.exp !== "number") return null;
  if (Math.floor(Date.now() / 1000) >= claims.exp) return null;
  return claims.sub;
}

const SESSION_CONTEXT_KEY = "appSessionId";

/** Store the verified session subject in the request context (middleware-side half). */
export function setSessionSubject(c: Context, sub: string): void {
  c.set(SESSION_CONTEXT_KEY, sub);
}

/** Read the authenticated session subject inside a protected handler. */
export function sessionIdOf(c: Context): string {
  const sub = c.get(SESSION_CONTEXT_KEY) as string | undefined;
  if (!sub) throw new Error("sessionIdOf called outside requireSession-protected route");
  return sub;
}
