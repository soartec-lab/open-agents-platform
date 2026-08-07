/**
 * Backend HTTP application entrypoint (Hono), served on port 41080.
 *
 * This file is the COMPOSITION ROOT and the ROUTE MAP: flue v2 mounts nothing
 * implicitly, so every agent conversation surface is mounted here explicitly
 * (registration itself comes from the 'use agent' scan; a mount only builds
 * the HTTP surface). It is ONLY a route map: the whole middleware pipeline —
 * CORS plus every auth guard — is assembled in src/middlewares/index.ts and
 * mounted here as one app, so no route below repeats a guard.
 *
 *   - middleware         → CORS + the auth-scheme selector (public /health +
 *                          /session, app session everywhere else) + the two
 *                          read-only conversation guards
 *   - generated routes   → GET /health, POST /session, /agent-configs*,
 *                          /channels* (orval, from openapi/agent/openapi.yaml
 *                          — wiring in src/routes.ts, logic in hand-owned
 *                          per-tag handlers under src/handlers/<tag>/;
 *                          regenerate with `bun run generate`)
 *   - createAgentRouter  → GET /agents/<name>/:id (+ sub-paths) for every
 *                          agent directory — READ-ONLY over HTTP (the guards
 *                          403 everything but GET/HEAD); writes go through
 *                          POST /channels/:id/messages → src/channel-agents.ts
 *
 * The flue seam: the agent routers and the dispatch seam are the runtime;
 * everything else is the backend layer around it.
 */

import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import { CHAT_AGENTS } from "./agents/chat/index.ts";
import middleware from "./middlewares/index.ts";
import generatedRoutes from "./routes.ts";

const app = new Hono();

// The whole middleware pipeline, in front of every route below.
app.route("/", middleware);

// The orval-generated plain-REST surface.
app.route("/", generatedRoutes);

// Every agent's conversation surface. This loop is the whole HTTP exposure
// decision — but it is DERIVED, not hand-written: the catalog is the
// directory itself (src/agents/chat/index.ts globs ./<name>/agent.ts), so
// adding an agent directory adds its route with no edit here. The path
// segment is the directory name, which the catalog verifies equals the
// function's pinned `agentName`.
//
// The corollary: an agent OUTSIDE that directory has no HTTP surface at all —
// how a future private, dispatch-only agent would stay off HTTP.
for (const spec of CHAT_AGENTS) {
  app.route(`/agents/${spec.name}`, createAgentRouter(spec.agent));
}

export default app;
