/**
 * delegate_to_member — the ONE hand-defined flue tool in this backend, and
 * the only tool in the platform (v1 ships no MCP integration). It hands a
 * piece of work to one of the channel's member agents through the in-process
 * dispatcher — the same seam POST /channels/:id/messages uses.
 *
 * Wired ONLY into the `orchestrator` agent. Member agents never get it, so
 * no agent→agent→agent chains can form.
 *
 * Built per render from the orchestrator's primed context: the picklist is
 * the channel's CURRENT member names, so invites and removals reshape the
 * tool on the next message with no registry anywhere.
 *
 * Delegation is fire-and-forget: dispatch() is admission-only, so the tool
 * returns as soon as the run is queued. The member's reply lands in its own
 * per-channel conversation, which the frontend merges into the channel
 * timeline — never relayed through the orchestrator.
 */

import { defineTool, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import type { OrchestratorContext } from "../agents/chat/orchestrator/agent.ts";
import { dispatchChannelMember } from "../channel-agents.ts";

export function createChannelDelegateTool(context: OrchestratorContext): ToolDefinition {
  // The picklist is non-empty by construction: the orchestrator only declares
  // this tool when the channel has at least one member.
  const names = context.members.map((m) => m.name) as [string, ...string[]];
  return defineTool({
    name: "delegate_to_member",
    description:
      "Hand a concrete piece of work to one invited member agent of this " +
      "channel. Fire-and-forget: the member's reply appears directly in the " +
      "channel timeline by itself — never promise to relay it.",
    input: v.object({
      member: v.pipe(v.picklist(names), v.description("The member agent to hand the work to.")),
      instruction: v.pipe(
        v.string(),
        v.minLength(1),
        v.maxLength(4000),
        v.description(
          "The concrete request the member should carry out, written in the " +
            "user's language, with any conversation context the member cannot see.",
        ),
      ),
    }),
    async run({ data }) {
      const member = context.members.find((m) => m.name === data.member);
      if (!member) {
        // The picklist should prevent this; degrade to text so the model can
        // recover instead of failing the turn.
        return { output: { summary: `No member named ${data.member} in this channel.` } };
      }
      // `delegatedBy` marks the run's origin in the dispatch input so the
      // channel timeline can render it as the orchestrator's hand-off.
      await dispatchChannelMember(member, context.channel, data.instruction, {
        delegatedBy: "orchestrator",
      });
      return {
        output: {
          summary: `Delegated to ${data.member}. Their reply will appear in the channel timeline.`,
        },
      };
    },
  });
}
