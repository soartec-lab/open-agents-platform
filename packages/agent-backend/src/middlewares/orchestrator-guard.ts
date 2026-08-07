/**
 * Read-only guard for the orchestrator's conversations, mounted by
 * src/middlewares/index.ts on `/agents/orchestrator/:id/*` AFTER the
 * auth-scheme selector and BEFORE the agent router.
 *
 * Same policy as the custom-agent guard: GET/HEAD (the room's live
 * observation) pass for any authenticated session; every other method —
 * including /abort — is rejected, because the only write path into an
 * orchestrator conversation is the in-process dispatch behind
 * POST /channels/:id/messages. Chatting into the orchestrator directly would
 * bypass the channel's routing (and the roster priming that goes with it).
 */

import type { MiddlewareHandler } from "hono";

export const requireOrchestratorReadOnly: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.json({ error: "Agent conversations are read-only over HTTP" }, 403);
  }
  await next();
};
