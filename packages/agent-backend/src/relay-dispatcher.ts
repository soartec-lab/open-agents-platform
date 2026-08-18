/**
 * Relay dispatcher — how a delegated member's reply reaches the orchestrator.
 *
 * The third actor of a channel, next to the orchestrator and its members:
 * deterministic backend code, not an AI agent. Whenever the orchestrator
 * hands work to a member (src/channel-agents.ts calls maybeStartRelayWatcher
 * after the delegation is admitted), a watcher awaits that submission's
 * settlement via the flue handle's read() — the one sanctioned exception to
 * "outcomes are read from the conversations over HTTP" — and dispatches the
 * settled reply back to the orchestrator as a `memberReport` input, so a
 * hand-off chain can continue without the user relaying results by hand.
 *
 * This file is the SECOND flue seam (with src/channel-agents.ts): the only
 * two non-agent modules allowed to import @flue/runtime. Same module-cycle
 * rule applies — everything exported here is a hoisted `function` declaration
 * and every cross-module reference happens inside a function body.
 *
 * Cost bound: a report only spawns another watcher while the channel's relay
 * count is below MAX_RELAY_COUNT, so one user post triggers at most that many
 * report turns. The count lives in a module-scope prime map keyed by the
 * orchestrator instance id, written immediately before every orchestrator
 * dispatch (0 on a user post, n on the n-th report). The overwrite race with
 * queued submissions is the same accepted class as the agents' context prime
 * maps, and degrades safely in both directions: a fresh user post legitimately
 * resets the budget, a newer report can only cut an older chain short.
 *
 * Accepted v1 limit: watchers are in-memory. A backend restart mid-chain
 * drops the automated report — the member's reply still lands in its own
 * conversation and the user can continue with one message. read() is
 * re-attachable, so persisting (instance id, submission id, relay count) and
 * re-attaching at boot is a known follow-up.
 */

import { AgentRunError, type DispatchReceipt, dispatch, init } from "@flue/runtime";
import { Custom } from "./agents/chat/custom/agent.ts";
import {
  loadOrchestratorContext,
  Orchestrator,
  primeOrchestratorContext,
} from "./agents/chat/orchestrator/agent.ts";
import { memberInstanceId, orchestratorInstanceId } from "./channel-agents.ts";
import { MAX_RELAY_COUNT, RELAY_TIMEOUT_MS } from "./config.ts";
import type { Channel } from "./models/channel.ts";
import type { ChannelMember } from "./models/channel-member.ts";

/** A settled member run, as the orchestrator's memberReport input carries it. */
type MemberReport =
  | { member: string; text: string }
  | { member: string; outcome: "failed" | "aborted" };

/**
 * Report text cap before it enters the orchestrator's conversation — the
 * reply is agent output derived from user-written instructions, so it gets
 * the same length discipline as the roster briefs (prior art: the spike's
 * client-side relay used the same value).
 */
const MAX_REPORT_CHARS = 1500;

// Relay count of the orchestrator turn currently being primed, per
// orchestrator instance id (see the header for the accepted overwrite race).
const primedRelayCounts = new Map<string, number>();

/** A user post opens a fresh relay budget for the channel. */
export function resetRelayCount(channelId: string): void {
  primedRelayCounts.set(orchestratorInstanceId(channelId), 0);
}

/**
 * Start watching an orchestrator-delegated member run, unless the channel's
 * relay budget for this user post is already spent. Fire-and-forget: the
 * caller's dispatch path must not wait on the member's run.
 */
export function maybeStartRelayWatcher(
  member: ChannelMember,
  channel: Channel,
  receipt: DispatchReceipt,
): void {
  const relayCount = primedRelayCounts.get(orchestratorInstanceId(channel.id)) ?? 0;
  if (relayCount < MAX_RELAY_COUNT) void watchAndRelay(member, channel, receipt, relayCount);
}

/**
 * Await one delegated submission's settlement and relay it. Total by design:
 * this promise is void-ed by the starter, so every failure ends in the catch
 * below — an unhandled rejection here would be a process-level event.
 */
async function watchAndRelay(
  member: ChannelMember,
  channel: Channel,
  receipt: DispatchReceipt,
  relayCount: number,
): Promise<void> {
  try {
    const handle = init(Custom, { id: memberInstanceId(member.configId, channel.id) });
    let report: MemberReport;
    try {
      const reply = await handle.read(receipt, {
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });
      report = { member: member.name, text: reply.text.slice(0, MAX_REPORT_CHARS) };
    } catch (error) {
      // Timeouts and transport errors go to the outer catch: the member is
      // still running and its reply will land — only this relay is dropped.
      if (!(error instanceof AgentRunError)) throw error;
      // The run itself settled failed/aborted. The timeline never renders
      // settlements, so the orchestrator's one-line notice is the only way
      // the user learns the member could not finish.
      report = { member: member.name, outcome: error.outcome };
    }
    await dispatchOrchestratorReport(channel.id, report, relayCount + 1);
  } catch (error) {
    console.warn(
      `[relay-dispatcher] gave up (member=${member.name}, channel=${channel.id}):`,
      error,
    );
  }
}

/**
 * Deliver a member's report to the channel's orchestrator. The context is
 * re-read from the DB — minutes may have passed since the delegation, and the
 * roster or goal may have changed (loading also throws when the channel was
 * deleted mid-chain, which the watcher's catch absorbs).
 */
async function dispatchOrchestratorReport(
  channelId: string,
  report: MemberReport,
  relayCount: number,
): Promise<void> {
  const id = orchestratorInstanceId(channelId);
  const context = await loadOrchestratorContext(id);
  primeOrchestratorContext(id, context);
  primedRelayCounts.set(id, relayCount);
  // No top-level `message`/`instruction`: the timeline renders those as a
  // user post / hand-off. `firedAt` orders the (hidden) row in the merge.
  const input = {
    trigger: "channel",
    channelId,
    channelName: context.channel.name,
    ...(context.channel.goal !== null && { goal: context.channel.goal }),
    memberReport: report,
    relayCount,
    firedAt: new Date().toISOString(),
  };
  await dispatch(Orchestrator, {
    id,
    message: { kind: "signal", type: "channel", body: JSON.stringify(input, null, 2) },
  });
}
