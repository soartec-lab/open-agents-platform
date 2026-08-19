"use agent";

/**
 * The channel orchestrator — the facilitator agent of every multi-member
 * channel. It receives the user's unmentioned posts (dispatched by
 * POST /channels/:id/messages), answers coordination itself, and hands real
 * work to the channel's member agents through its one tool,
 * `delegate_to_member` (src/tools/delegate.ts). Members' replies land in
 * their own per-channel conversations, which the frontend merges into the
 * channel timeline — the orchestrator never relays them.
 *
 * Mounted at `/agents/orchestrator` (see src/app.ts) with instance id
 * `channel-<channelId>`, one conversation per channel. The HTTP surface is
 * READ-ONLY (GET/HEAD observation; src/middlewares/orchestrator-guard.ts
 * 403s everything else): the only write path is the in-process dispatch from
 * src/dispatchers/message-dispatcher.ts.
 *
 * Same three-layer context priming as the custom agent (see
 * ./custom/agent.ts for the v2 timing constraint): the dispatcher primes the
 * channel + roster synchronously before every dispatch, `useAgentStart`
 * re-reads the DB per delivered message (invites/removals and goal edits
 * apply on the next message), and a persistent-state backstop covers
 * durable-queue replays after a restart. Unlike the custom agent the model
 * is a fixed env value — the priming exists for the roster and goal, which
 * the synchronous render needs for the prompt and the delegate picklist.
 */

import {
  type AgentProps,
  useAgentStart,
  useModel,
  usePersistentState,
  useResponseStart,
  useTool,
} from "@flue/runtime";
import { DEFAULT_AGENT_MODEL } from "../../../config.ts";
import { channelIdFromInstanceId } from "../../../dispatchers/message-dispatcher.ts";
import { Channel } from "../../../models/channel.ts";
import { ChannelMember } from "../../../models/channel-member.ts";
import { createChannelDelegateTool } from "../../../tools/delegate.ts";
import instructionsMd from "./instructions.md";

// Spec metadata read by src/agents/chat/index.ts's directory scan.
export const description = "Channel facilitator: answers directly or delegates to member agents.";

/** Everything a render needs, resolved from the channel + its members. */
export interface OrchestratorContext {
  channel: Channel;
  members: ChannelMember[];
}

// Synchronously readable per-conversation context, written by the dispatcher
// before a submission is admitted (same pattern as the custom agent's map).
const primedContexts = new Map<string, OrchestratorContext>();

/** Preload a channel's context so the next render can read it. */
export function primeOrchestratorContext(instanceId: string, context: OrchestratorContext): void {
  primedContexts.set(instanceId, context);
}

/** Resolve a channel's context from the DB (throws when broken). */
export async function loadOrchestratorContext(instanceId: string): Promise<OrchestratorContext> {
  const channelId = channelIdFromInstanceId(instanceId);
  if (!channelId) {
    throw new Error(`orchestrator instance id is not channel-scoped: ${instanceId}`);
  }
  const [channel, members] = await Promise.all([
    Channel.get(channelId),
    ChannelMember.listByChannel(channelId),
  ]);
  if (!channel) throw new Error(`channel not found: ${channelId}`);
  return { channel, members };
}

/**
 * One roster line per member: name, role, and a short capability brief taken
 * from the member's user-written instructions. All three are end-user text —
 * whitespace is collapsed and the brief capped so a member's instructions
 * cannot sprawl into (or restructure) the orchestrator's prompt; the prompt
 * additionally marks the whole roster section as untrusted.
 */
const BRIEF_MAX = 200;
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function rosterLines(members: ChannelMember[]): string {
  if (members.length === 0) return "(no members invited yet)";
  return members
    .map((m) => {
      const role = m.role ? ` (${oneLine(m.role)})` : "";
      const brief = oneLine(m.instructions).slice(0, BRIEF_MAX);
      return `- ${oneLine(m.name)}${role}: ${brief}`;
    })
    .join("\n");
}

export function Orchestrator({ id }: AgentProps): string {
  const [persisted, setPersisted] = usePersistentState<OrchestratorContext | null>("context", null);
  // Per delivered message: re-read the channel + roster so invites, removals,
  // renames, and goal edits apply to the live conversation.
  useAgentStart(async () => {
    const fresh = await loadOrchestratorContext(id);
    primedContexts.set(id, fresh);
    setPersisted(fresh);
  });

  const context = primedContexts.get(id) ?? persisted;
  if (!context) {
    throw new Error(`orchestrator context not primed: ${id}`);
  }

  useModel(DEFAULT_AGENT_MODEL);
  // Merged channel timelines order rows by this metadata key; v2 stamps none
  // itself, so every agent stamps its own. Copy this line verbatim into any
  // new agent — the key is checked by nothing and a typo fails silently.
  useResponseStart(() => ({ timestamp: new Date().toISOString() }));
  // The delegate tool is rebuilt per render from the live roster (v2 hooks
  // are declared per render, so a conditional tool is legal). No members =
  // no tool — the orchestrator can only answer directly.
  if (context.members.length > 0) {
    useTool(createChannelDelegateTool(context));
  }
  return instructionsMd
    .replace("{{CHANNEL}}", oneLine(context.channel.name))
    .replace("{{GOAL}}", context.channel.goal ? oneLine(context.channel.goal) : "(no goal set)")
    .replace("{{ROSTER}}", rosterLines(context.members));
}

// The durable facilitator identity — every channel's orchestrator
// conversation lives under this one name.
Orchestrator.agentName = "orchestrator";
