/**
 * The middleware pipeline, assembled as one mountable Hono app.
 *
 * src/app.ts mounts this at `/` BEFORE any route, so everything registered
 * here runs for every request: Hono matches entries in registration order, and
 * `app.route("/", middleware)` copies these entries in before the route mounts
 * that follow. That is what lets app.ts stay a pure route map — it carries no
 * `use()` call at all, and no route has to remember which guard it needs.
 *
 * Two shapes are combined:
 *
 *   - `use("*", …)` for anything that applies to (nearly) every request: CORS
 *     and the auth-scheme selector below. One registration, path branching
 *     inside.
 *   - `use("/<pattern>", …)` for the guards that need PATH PARAMS (`:id`) —
 *     a `"*"` mount would leave `c.req.param()` empty, so these keep a
 *     pattern. A trailing `/*` matches the bare path too and still resolves
 *     the param.
 *
 * Ordering is load-bearing: `requireAuth` runs first, so a pattern-scoped
 * guard always runs inside an authenticated request.
 */

import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { FRONTEND_ORIGIN } from "../config.ts";
import { requireCustomConversation } from "./custom-agent-guard.ts";
import { requireOrchestratorReadOnly } from "./orchestrator-guard.ts";
import { requireSession } from "./require-session.ts";

/**
 * Pick and enforce the auth scheme for this request. The app session is the
 * DEFAULT, which is the point: a newly added endpoint (generated or
 * hand-written) is guarded without an edit here, and forgetting to exempt a
 * genuinely public one costs a loud 401 instead of a silent unauthenticated
 * hole.
 */
const requireAuth: MiddlewareHandler = (c, next) => {
  const path = c.req.path;
  // The only two endpoints served without a session: session issuance itself,
  // and the liveness probe.
  if (path === "/health" || path === "/session") return next();
  // Everything else, including a path that matches no route at all.
  return requireSession(c, next);
};

const middleware = new Hono();

// CORS for the browser app. Credentials enabled so the Authorization header
// (app-session bearer) is accepted from the frontend origin (cross-origin:
// frontend :42173 → backend :42080). Registered first so a preflight is
// answered before any guard runs.
middleware.use(
  "*",
  cors({
    origin: FRONTEND_ORIGIN,
    // PATCH is used by /agent-configs/{id} and /channels/{id}.
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowHeaders: ["Authorization", "Content-Type"],
    credentials: true,
    maxAge: 600,
  }),
);

middleware.use("*", requireAuth);

// Conversation guards: every agent conversation is read-only over HTTP (the
// room's SSE observation); the only write path is POST /channels/:id/messages.
middleware.use("/agents/custom/:id/*", requireCustomConversation);
middleware.use("/agents/orchestrator/:id/*", requireOrchestratorReadOnly);

export default middleware;
