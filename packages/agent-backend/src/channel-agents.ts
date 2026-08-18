/**
 * Channel agents — how channel messages become agent runs.
 *
 * A channel's agents run in PER-CHANNEL flue conversations: the orchestrator
 * on its own name with instance id `channel-<channelId>`, and each member on
 * the `custom` platform agent with the composite
 * `<configId>__channel-<channelId>`. The channel room observes these
 * conversations read-only over HTTP (SSE) and merges them client-side; this
 * module's in-process dispatch() calls are the ONLY write path into them.
 *
 * This file is a deliberate flue SEAM: with src/relay-dispatcher.ts, one of
 * the two non-agent modules that import @flue/runtime. dispatch() targets the
 * agent FUNCTION and delivers a `kind: "signal"` message whose body is the
 * pretty-printed JSON input (the timeline UIs parse it back). Both agents'
 * synchronous contexts are primed here before dispatching, because in-process
 * dispatches never pass an HTTP guard that could do the priming (see the v2
 * timing note in src/agents/chat/custom/agent.ts). dispatch() resolves on
 * admission only — outcomes are read from the conversations, with ONE
 * exception: the relay dispatcher read()s orchestrator-delegated member
 * submissions and reports them back (src/relay-dispatcher.ts).
 *
 * Module-cycle note: this module and the two agent modules import each other
 * (agents need the id helpers / the delegate tool needs the dispatcher).
 * Everything exported here is a hoisted `function` declaration and every
 * cross-reference happens inside a function body, so the cycle is safe under
 * ESM live bindings — do not convert these to const arrow functions.
 */

import { dispatch } from "@flue/runtime";
import { Custom, primeCustomConfig } from "./agents/chat/custom/agent.ts";
import {
  Orchestrator,
  type OrchestratorContext,
  primeOrchestratorContext,
} from "./agents/chat/orchestrator/agent.ts";
import type { Channel } from "./models/channel.ts";
import type { ChannelMember } from "./models/channel-member.ts";
import { CUSTOM_INSTANCE_SEPARATOR } from "./models/custom-instance-id.ts";
import { maybeStartRelayWatcher, resetRelayCount } from "./relay-dispatcher.ts";

/** The orchestrator's per-channel conversation instance id. */
export function orchestratorInstanceId(channelId: string): string {
  return `channel-${channelId}`;
}

/** The channel id back out of an orchestrator instance id, or null. */
export function channelIdFromInstanceId(instanceId: string): string | null {
  if (!instanceId.startsWith("channel-")) return null;
  const channelId = instanceId.slice("channel-".length);
  return channelId === "" ? null : channelId;
}

/** A member's per-channel conversation instance id (on the `custom` agent). */
export function memberInstanceId(configId: string, channelId: string): string {
  return `${configId}${CUSTOM_INSTANCE_SEPARATOR}${orchestratorInstanceId(channelId)}`;
}

/**
 * Deliver one piece of work to a member agent. The dispatch input extends a
 * shared envelope ({trigger: "channel", channel context, firedAt}) so member
 * prompts and the room's timeline need no per-source handling: `delegatedBy`
 * is present when the orchestrator handed the work over and absent when the
 * user posted directly (1:1 channel or @mention).
 */
export async function dispatchChannelMember(
  member: ChannelMember,
  channel: Channel,
  instruction: string,
  options: { delegatedBy?: "orchestrator" } = {},
): Promise<void> {
  const id = memberInstanceId(member.configId, channel.id);
  // In-process dispatches never pass an HTTP guard, so the custom agent's
  // synchronous config context is primed here (v2: the composed prompt is
  // rendered before the async intake seam runs).
  primeCustomConfig(id, { name: member.name, instructions: member.instructions });
  const input = {
    trigger: "channel",
    channelId: channel.id,
    channelName: channel.name,
    ...(channel.goal !== null && { goal: channel.goal }),
    instruction,
    ...(options.delegatedBy !== undefined && { delegatedBy: options.delegatedBy }),
    firedAt: new Date().toISOString(),
  };
  const receipt = await dispatch(Custom, {
    id,
    message: { kind: "signal", type: "channel", body: JSON.stringify(input, null, 2) },
  });
  // Orchestrator hand-offs get a relay watcher: the settled reply is reported
  // back so the orchestrator can take one next step (src/relay-dispatcher.ts).
  if (options.delegatedBy === "orchestrator") {
    maybeStartRelayWatcher(member, channel, receipt);
  }
}

/**
 * Deliver a user's post to the channel's orchestrator, which answers and/or
 * delegates to members via its tool. The roster is primed from the rows the
 * handler already loaded — `useAgentStart` re-reads the DB per delivered
 * message anyway, so freshness never depends on this snapshot alone.
 */
export async function dispatchOrchestrator(
  channel: Channel,
  members: ChannelMember[],
  text: string,
): Promise<void> {
  const id = orchestratorInstanceId(channel.id);
  const context: OrchestratorContext = { channel, members };
  primeOrchestratorContext(id, context);
  resetRelayCount(channel.id);
  const input = {
    trigger: "channel",
    channelId: channel.id,
    channelName: channel.name,
    ...(channel.goal !== null && { goal: channel.goal }),
    message: text,
    from: "user",
    firedAt: new Date().toISOString(),
  };
  await dispatch(Orchestrator, {
    id,
    message: { kind: "signal", type: "channel", body: JSON.stringify(input, null, 2) },
  });
}
