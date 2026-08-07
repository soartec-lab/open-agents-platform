/**
 * App-session middleware: `requireSession`.
 *
 * Verifies the `Authorization: Bearer` app-session token and puts the verified
 * SUBJECT into the Hono context via `setSessionSubject`. The subject is derived
 * ONLY from the token's HMAC-verified claims — never from a path segment,
 * query, or body — so a caller cannot act as another session by passing
 * someone else's id around.
 *
 * ./index.ts decides WHERE this applies: it is the default scheme for every
 * request except `/health` and `POST /session`. Modules under
 * src/middlewares/ are imported ONLY by ./index.ts. Handlers read the subject
 * with `sessionIdOf` from src/models/session.ts, which also owns the token
 * crypto and the context-key contract.
 */

import type { Context, MiddlewareHandler } from "hono";
import { setSessionSubject, verifySession } from "../models/session.ts";

function bearerFrom(c: Context): string | null {
  const header = c.req.header("authorization") ?? c.req.header("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

/** Hono middleware: require a valid app-session bearer token. */
export const requireSession: MiddlewareHandler = async (c, next) => {
  const token = bearerFrom(c);
  const sub = token ? verifySession(token) : null;
  if (!sub) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  setSessionSubject(c, sub);
  await next();
};
