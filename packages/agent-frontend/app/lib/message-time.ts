/**
 * Message-classification helpers for flue v2 conversations.
 *
 * Two load-bearing projection facts the timelines are built on:
 *  - `metadata` is entirely AGENT-authored — every agent in the backend
 *    stamps `{ timestamp }` itself with a `useResponseStart` hook spelled out
 *    in its own agent.ts, and a dispatch input row carries its own `firedAt`
 *    field inside its JSON body instead.
 *  - Messages carry a typed `purpose` (`user` / `assistant` / `dispatch` /
 *    `advisory`), so detecting an input row does not rely on role heuristics.
 */

import type { FlueConversationMessage } from "@flue/sdk";

/**
 * An input row: a dispatched input (a user post or an orchestrator
 * delegation) or a real user chat message. Everything else is agent output
 * (or a runtime advisory).
 */
export function isInputRow(message: FlueConversationMessage): boolean {
  return message.purpose === "dispatch" || message.purpose === "user";
}

/**
 * A runtime advisory (v2: resource-change narrations, terminal advisories).
 * Chat-style timelines skip these — they are model-facing bookkeeping, not
 * conversation.
 */
export function isAdvisoryRow(message: FlueConversationMessage): boolean {
  return message.purpose === "advisory";
}

/**
 * Best-effort ISO timestamp for ordering merged timelines: the agent-authored
 * response metadata first, then a dispatch input's own `firedAt`. Empty string
 * when neither exists (sorts first — stable enough for display).
 */
export function messageTimestamp(message: FlueConversationMessage): string {
  const stamped = message.metadata?.timestamp;
  if (typeof stamped === "string") return stamped;
  if (isInputRow(message)) {
    const text = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
    try {
      const parsed: unknown = JSON.parse(text);
      const firedAt = (parsed as { firedAt?: unknown }).firedAt;
      if (typeof firedAt === "string") return firedAt;
    } catch {
      // plain-text input (a real chat message) — no timestamp to recover
    }
  }
  return "";
}

/** Compact display form of an ISO timestamp ("2026-08-07 12:34:56"). */
export const formatWhen = (iso: string | null | undefined) =>
  iso ? iso.slice(0, 19).replace("T", " ") : null;
