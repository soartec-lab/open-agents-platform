/**
 * Conversation guard for the `custom` agent, mounted by
 * src/middlewares/index.ts on `/agents/custom/:id/*` AFTER the auth-scheme
 * selector and BEFORE the agent router.
 *
 * Every agent conversation on this platform is READ-ONLY over HTTP: the room
 * observes it live (GET/HEAD = stream / history), and the only write path is
 * the in-process dispatch behind POST /channels/:id/messages. This guard
 * therefore does two things:
 *
 *   - 404s a malformed composite id or one whose AgentConfig no longer exists
 *     (a deleted config revokes observation this way — memberships are
 *     cascade-deleted with it), and
 *   - 403s every method except GET/HEAD, including /abort — nothing may
 *     inject instructions into a member conversation by chatting into it.
 *
 * There is no session binding and no context priming here (the spike's guard
 * did both): reads render nothing, and priming happens at dispatch time in
 * src/channel-agents.ts. Reads are shared across sessions — the same
 * deferred-ownership stance as the rest of the catalog.
 *
 * A single trailing-`/*` pattern covers the bare conversation path too —
 * Hono matches `/…/:id/*` against the bare `/…/:id`, and `:id` still
 * resolves.
 */

import type { MiddlewareHandler } from "hono";
import { AgentConfig } from "../models/agent-config.ts";
import { parseCustomInstanceId } from "../models/custom-instance-id.ts";

export const requireCustomConversation: MiddlewareHandler = async (c, next) => {
  const id = c.req.param("id");
  const parsed = id ? parseCustomInstanceId(id) : null;
  if (!parsed) {
    return c.json({ error: "Agent config not found" }, 404);
  }
  if (!(await AgentConfig.get(parsed.configId))) {
    return c.json({ error: "Agent config not found" }, 404);
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.json({ error: "Agent conversations are read-only over HTTP" }, 403);
  }
  await next();
};
