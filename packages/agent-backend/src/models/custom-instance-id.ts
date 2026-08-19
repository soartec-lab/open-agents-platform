/**
 * Composite instance-id format for the `custom` agent.
 *
 * The flue instance id of a user-created agent's per-channel conversation is
 * `<configId>__channel-<channelId>` (`<configId>__<conversationId>` in
 * general). This module is the single source of truth for that format — pure
 * string parsing with no DB, Hono, or flue dependency. Consumers: the
 * conversation guard (src/middlewares/custom-agent-guard.ts), the channel
 * dispatcher (src/dispatchers/message-dispatcher.ts), and the `custom` agent's context loader
 * (src/agents/chat/custom/agent.ts) — the loader must re-parse because flue
 * hands it only the raw `{ id }`, with no channel to forward the guard's
 * result.
 */

/** Separator between the config id and the conversation id. */
export const CUSTOM_INSTANCE_SEPARATOR = "__";

/** Split a composite instance id, or null when it is not of the composite shape. */
export function parseCustomInstanceId(
  id: string,
): { configId: string; conversationId: string } | null {
  const at = id.indexOf(CUSTOM_INSTANCE_SEPARATOR);
  if (at <= 0) return null;
  const configId = id.slice(0, at);
  const conversationId = id.slice(at + CUSTOM_INSTANCE_SEPARATOR.length);
  if (conversationId === "") return null;
  return { configId, conversationId };
}
