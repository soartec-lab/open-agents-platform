/**
 * Member helpers for the channel room: how a ChannelMember maps to the flue
 * conversation it runs in, the mention slug it goes by, and a stable avatar
 * color — the pieces that make agents read as named teammates.
 *
 * The instance-id scheme mirrors the backend's src/channel-agents.ts: members
 * run as ("custom", `<configId>__channel-<channelId>`), the orchestrator as
 * ("orchestrator", `channel-<channelId>`). Labels need no roster join —
 * GET /channels embeds each member's name/role.
 */

import type { ChannelMember } from "../../api/schemas";
import type { ObservationTarget } from "../../lib/useObservedConversation.ts";

/** The orchestrator's display label (it is a fixture, not a member). */
export const ORCHESTRATOR_LABEL = "Orchestrator";

/** The flue conversation a member's channel runs land in. */
export function memberTarget(member: ChannelMember, channelId: string): ObservationTarget {
  return { name: "custom", id: `${member.configId}__channel-${channelId}` };
}

/** The orchestrator's per-channel conversation. */
export function orchestratorTarget(channelId: string): ObservationTarget {
  return { name: "orchestrator", id: `channel-${channelId}` };
}

/** Mention token: the name with whitespace collapsed to "-" (typable after "@"). */
export const mentionSlug = (label: string) => label.trim().replace(/\s+/g, "-");

/**
 * Resolve a leading "@name " mention against the members. Matches the slug
 * or the raw name.
 */
export function resolveMention(
  text: string,
  members: ChannelMember[],
): { member: ChannelMember; body: string } | null {
  const match = text.match(/^@(\S+)\s+([\s\S]+)$/);
  if (!match) return null;
  const member = members.find((m) => [mentionSlug(m.name), m.name].includes(match[1]));
  return member ? { member, body: match[2].trim() } : null;
}

/** Deterministic per-teammate avatar color (hash of the label). */
const AVATAR_COLORS = [
  "bg-sky-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-lime-600",
  "bg-indigo-600",
];

export function avatarColor(label: string): string {
  let hash = 0;
  for (const ch of label) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Avatar initials: up to two word-initials of the label. */
export function avatarInitials(label: string): string {
  const words = label.trim().split(/\s+/);
  const initials = words.slice(0, 2).map((w) => [...w][0] ?? "");
  return initials.join("").toUpperCase() || "?";
}
