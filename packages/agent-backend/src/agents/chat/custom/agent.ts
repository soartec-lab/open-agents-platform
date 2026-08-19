"use agent";

/**
 * The platform-mode agent: ONE flue agent serving EVERY user-created agent —
 * no per-user rebuild, no per-user route.
 *
 * Mounted at `/agents/custom` (see src/app.ts). The instance id is composite:
 * `<configId>__channel-<channelId>` — one conversation per (agent, channel)
 * pair. The HTTP surface is READ-ONLY (GET/HEAD observation; the guard in
 * src/middlewares/custom-agent-guard.ts 403s everything else): the only write
 * path is the in-process dispatch from src/dispatchers/message-dispatcher.ts, fired by
 * POST /channels/:id/messages or by the orchestrator's delegate tool.
 *
 * v2 timing constraint (why `primeCustomConfig` exists): the agent function
 * renders synchronously when a submission starts, BEFORE the async
 * `useAgentStart` seam runs — so a fresh conversation's first submission
 * cannot learn its config (name/instructions for the composed prompt) from a
 * DB read inside `useAgentStart`. Instead the one entry path preloads it:
 * `dispatchChannelMember` primes before every dispatch. `useAgentStart` then
 * re-reads the DB per delivered message (config edits keep applying to live
 * conversations) and refreshes both the prime map and a persistent-state
 * backstop — the backstop covers durable-queue replays after a restart, when
 * the dispatcher did not re-prime the map.
 */

import {
  type AgentProps,
  useAgentStart,
  useModel,
  usePersistentState,
  useResponseStart,
} from "@flue/runtime";
import { DEFAULT_AGENT_MODEL } from "../../../config.ts";
import { AgentConfig, composeInstructions } from "../../../models/agent-config.ts";
import { ChannelMember } from "../../../models/channel-member.ts";
import { parseCustomInstanceId } from "../../../models/custom-instance-id.ts";
import channelMemberInstructions from "../../channel-member-instructions.md";
import instructionsMd from "./instructions.md";

// Spec metadata read by src/agents/chat/index.ts's directory scan.
export const description = "User-configured agent (platform mode).";

/** Everything a render needs, resolved from the AgentConfig. */
export interface CustomAgentContext {
  name: string;
  instructions: string;
}

// Synchronously readable per-conversation config, written by the dispatcher
// before a submission is admitted. Entries are refreshed on every dispatch
// and every delivered message; the population is one entry per live custom
// conversation.
const primedContexts = new Map<string, CustomAgentContext>();

/** Preload a custom conversation's context so the next render can read it. */
export function primeCustomConfig(instanceId: string, context: CustomAgentContext): void {
  primedContexts.set(instanceId, context);
}

/** The conversation-id prefix of a channel conversation (`channel-<channelId>`). */
const CHANNEL_CONVERSATION_PREFIX = "channel-";

/** Resolve a custom conversation's context from the DB (throws when broken). */
export async function loadCustomAgentContext(instanceId: string): Promise<CustomAgentContext> {
  const parsed = parseCustomInstanceId(instanceId);
  if (!parsed) {
    throw new Error(`custom agent instance id is not composite: ${instanceId}`);
  }
  if (!parsed.conversationId.startsWith(CHANNEL_CONVERSATION_PREFIX)) {
    throw new Error(`custom agent conversation is not channel-scoped: ${instanceId}`);
  }
  const channelId = parsed.conversationId.slice(CHANNEL_CONVERSATION_PREFIX.length);
  const [config, isMember] = await Promise.all([
    AgentConfig.get(parsed.configId),
    ChannelMember.exists(channelId, parsed.configId),
  ]);
  // The dispatcher only fires current members; reaching here without a config
  // or membership means a stale replay or a programming error — fail loudly.
  if (!config) throw new Error(`agent config not found: ${parsed.configId}`);
  if (!isMember) throw new Error(`agent is not a member of the channel: ${instanceId}`);
  return { name: config.name, instructions: config.instructions };
}

// Operator hard rules for EVERY user-created agent (prose in
// ./instructions.md, plus the shared channel-member paragraph). The user's
// free-form instructions are folded in below them as a sanitized lower-trust
// section (composeInstructions) and can never relax these. v2 attaches no
// sandbox unless useSandbox() is declared, so the bash/filesystem built-ins
// do not exist here; the prohibition stays as defense in depth.
const CUSTOM_BASE_RULES = [instructionsMd.trimEnd(), "", channelMemberInstructions.trimEnd()].join(
  "\n",
);

export function Custom({ id }: AgentProps): string {
  const [persisted, setPersisted] = usePersistentState<CustomAgentContext | null>("config", null);
  // Per delivered message: re-read the config so edits apply to live
  // conversations (a deleted config or revoked membership fails the
  // submission loudly).
  useAgentStart(async () => {
    const fresh = await loadCustomAgentContext(id);
    primedContexts.set(id, fresh);
    setPersisted(fresh);
  });

  const context = primedContexts.get(id) ?? persisted;
  if (!context) {
    // The dispatcher did not prime this conversation and no earlier message
    // persisted a snapshot — fail loudly rather than run on wrong instructions.
    throw new Error(`custom agent context not primed: ${id}`);
  }

  useModel(DEFAULT_AGENT_MODEL);
  // Merged channel timelines order rows by this metadata key; v2 stamps none
  // itself, so every agent stamps its own. Copy this line verbatim into any
  // new agent — the key is checked by nothing and a typo fails silently.
  useResponseStart(() => ({ timestamp: new Date().toISOString() }));
  // Same trust-separation path for every user-created agent: the config's
  // free-form text is sanitized and folded in under the hard rules.
  return composeInstructions(CUSTOM_BASE_RULES, {
    name: context.name,
    text: context.instructions,
  });
}

// The reserved platform-agent identity — every composite-id conversation
// lives under this one durable name.
Custom.agentName = "custom";
