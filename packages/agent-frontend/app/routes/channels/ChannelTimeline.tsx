/**
 * ChannelTimeline — the channel's merged, "humans in a group chat" timeline.
 * Every member conversation (and, in a multi-member channel, the
 * orchestrator's) is observed live over SSE and merged by agent-authored
 * timestamps; agent turns get an avatar + name + timestamp header like a
 * Slack message, members currently producing output show a typing indicator,
 * and a Reply button prefills the member's @mention.
 *
 * Row shapes (each user post lands in exactly ONE conversation, so no
 * cross-conversation dedup is needed):
 *  - a member-conversation dispatch row: `delegatedBy: "orchestrator"` renders
 *    as the orchestrator's own "@member <instruction>" hand-off post;
 *    otherwise it is the user's bubble (1:1 channel or @mention).
 *  - an orchestrator-conversation dispatch row: the user's bubble.
 *  - agent turns: prose in bubbles; the orchestrator's delegate_to_member
 *    tool call renders as a one-line activity note ("asked X to help"), never
 *    a fake message. Contentless assistant turns (provider retries) are
 *    hidden unless still the conversation's newest message.
 */

import type {
  AgentConversationObservationSnapshot,
  FlueConversationMessage,
  FlueConversationPart,
} from "@flue/sdk";
import { CheckIcon, CircleAlertIcon, ReplyIcon } from "lucide-react";
import { Fragment, useMemo } from "react";
import type { Channel, ChannelMember } from "../../api/schemas";
import { Avatar, AvatarFallback } from "../../components/ui/avatar.tsx";
import { Bubble, BubbleContent } from "../../components/ui/bubble.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Marker, MarkerContent, MarkerIcon } from "../../components/ui/marker.tsx";
import { Message, MessageContent } from "../../components/ui/message.tsx";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../../components/ui/message-scroller.tsx";
import {
  avatarColor,
  avatarInitials,
  memberTarget,
  mentionSlug,
  ORCHESTRATOR_LABEL,
  orchestratorTarget,
} from "./members.ts";
import { observationKey } from "./useObservedConversation.ts";

/**
 * One optimistically-echoed user post: rendered the moment Send is pressed,
 * retired only when the REAL dispatch row shows up in a conversation (the
 * row can lag behind the 202 — clearing the echo any earlier makes the post
 * look deleted).
 */
export interface PendingPost {
  id: string;
  text: string;
  /** Status caption under the bubble ("to Researcher…"). */
  note: string;
  /** 202-accepted — the room now waits for the row to appear, re-probing. */
  delivered?: boolean;
  /**
   * When the user hit Send (ISO). The reconcile that retires this echo only
   * accepts a dispatch row NEWER than this (minus clock slack) — matching by
   * text alone would let an OLD row with the same text retire a fresh echo.
   */
  sentAt: string;
}

// ── Message classification (absorbed from the former lib/message-time.ts —
// these are timeline concerns, so they live with the timeline) ──────────────
//
// Two load-bearing projection facts the merge is built on:
//  - `metadata` is entirely AGENT-authored — every agent in the backend
//    stamps `{ timestamp }` itself with a `useResponseStart` hook, and a
//    dispatch input row carries its own `firedAt` field inside its JSON body.
//  - Messages carry a typed `purpose` (`user` / `assistant` / `dispatch` /
//    `advisory`), so detecting an input row does not rely on role heuristics.

/**
 * An input row: a dispatched input (a user post or an orchestrator
 * delegation) or a real user chat message. Everything else is agent output
 * (or a runtime advisory).
 */
export function isInputRow(message: FlueConversationMessage): boolean {
  return message.purpose === "dispatch" || message.purpose === "user";
}

/**
 * A runtime advisory (resource-change narrations, terminal advisories). The
 * merge skips these — they are model-facing bookkeeping, not conversation.
 */
function isAdvisoryRow(message: FlueConversationMessage): boolean {
  return message.purpose === "advisory";
}

/**
 * Best-effort ISO timestamp for ordering the merge: the agent-authored
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

/** Compact display form of an ISO timestamp ("2026-08-17 12:34:56"). */
const formatWhen = (iso: string | null | undefined) =>
  iso ? iso.slice(0, 19).replace("T", " ") : null;

/** Who a merged row belongs to: a member conversation or the orchestrator's. */
export type RowSource = { kind: "member"; member: ChannelMember } | { kind: "orchestrator" };

/** Stable per-row key across the merge (member id or the orchestrator). */
const rowKeyOf = (source: RowSource, message: FlueConversationMessage) =>
  `${source.kind === "member" ? source.member.id : "orchestrator"}:${message.id}`;

/** The channel dispatch input fields the timeline renders (src/channel-agents.ts). */
export function parseChannelDispatch(message: FlueConversationMessage): {
  /** The user's post (`message`) or the delivered work item (`instruction`). */
  text: string | null;
  delegatedBy: string | null;
} {
  const raw = message.parts.find((p) => p.type === "text")?.text ?? "";
  try {
    const parsed = JSON.parse(raw) as {
      instruction?: string;
      message?: string;
      delegatedBy?: string;
    };
    return {
      text: parsed.instruction ?? parsed.message ?? null,
      delegatedBy: parsed.delegatedBy ?? null,
    };
  } catch {
    return { text: raw || null, delegatedBy: null };
  }
}

/** An agent is "typing" while its latest turn is still producing output. */
export function isTyping(snapshot: AgentConversationObservationSnapshot | undefined): boolean {
  const messages = snapshot?.conversation?.messages ?? [];
  const last = messages[messages.length - 1];
  if (!last) return false;
  // A dispatch input with no reply yet: the agent is about to speak.
  if (isInputRow(last)) return true;
  return last.parts.some(
    (p) =>
      ((p.type === "text" || p.type === "reasoning") && p.state === "streaming") ||
      (p.type === "dynamic-tool" && p.state === "input-available"),
  );
}

function MemberAvatar({ label }: { label: string }) {
  return (
    <Avatar size="sm" className="mt-0.5 shrink-0">
      <AvatarFallback className={`${avatarColor(label)} font-medium text-white`}>
        {avatarInitials(label)}
      </AvatarFallback>
    </Avatar>
  );
}

/** Humanized delegate-tool activity: "asked Researcher to help", not raw JSON. */
const delegateTargetOf = (part: FlueConversationPart & { type: "dynamic-tool" }): string => {
  const member = (part.input as { member?: unknown } | undefined)?.member;
  return typeof member === "string" ? member : "a member";
};

const summaryOf = (part: FlueConversationPart & { type: "dynamic-tool" }): string | undefined => {
  const summary = (part.output as { summary?: unknown } | undefined)?.summary;
  return typeof summary === "string" ? summary : undefined;
};

/** One part of an agent turn: prose in a bubble; tool work as an activity note. */
function AgentPart({ part }: { part: FlueConversationPart }) {
  if (part.type === "text") {
    if (!part.text.trim()) return null;
    return (
      <Bubble variant="muted">
        <BubbleContent className="whitespace-pre-wrap">{part.text}</BubbleContent>
      </Bubble>
    );
  }

  if (part.type === "dynamic-tool") {
    if (part.state === "input-available") {
      return (
        <span className="shimmer text-muted-foreground text-xs">
          asking {delegateTargetOf(part)} to help…
        </span>
      );
    }
    if (part.state === "output-error") {
      return (
        <span className="text-destructive text-xs">
          <CircleAlertIcon className="mr-1 inline size-3" />
          couldn't delegate to {delegateTargetOf(part)}: {part.errorText}
        </span>
      );
    }
    if (part.state === "output-available") {
      return (
        <span className="text-muted-foreground text-xs" title={summaryOf(part)}>
          <CheckIcon className="mr-1 inline size-3" />
          asked {delegateTargetOf(part)} to help
        </span>
      );
    }
  }

  return null;
}

/**
 * A hand-off rendered as the orchestrator's own chat post: "@member
 * <instruction>" under its avatar and name — delegation must read like
 * teammates talking, never like a system event.
 */
function HandOffPost({
  when,
  mentionLabel,
  text,
}: {
  when: string | null;
  mentionLabel: string;
  text: string;
}) {
  return (
    <div className="flex gap-2">
      <MemberAvatar label={ORCHESTRATOR_LABEL} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{ORCHESTRATOR_LABEL}</span>
          {when && <span className="text-muted-foreground text-xs">{when}</span>}
        </div>
        <Message align="start" className="max-w-full">
          <MessageContent>
            <Bubble variant="muted">
              <BubbleContent className="whitespace-pre-wrap">
                <span className="font-medium text-sky-600">@{mentionSlug(mentionLabel)}</span>{" "}
                {text}
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </div>
    </div>
  );
}

/** Whether an agent message has anything a teammate would have "said". */
const hasRenderableContent = (message: FlueConversationMessage): boolean =>
  message.parts.some((p) => (p.type === "text" && p.text.trim()) || p.type === "dynamic-tool");

/** One agent turn as a Slack-style row: avatar + name + role + time, then the parts. */
function AgentTurn({
  label,
  role,
  message,
  onReplyTo,
}: {
  label: string;
  role?: string;
  message: FlueConversationMessage;
  /** Prefill the member's @mention; absent for the orchestrator (not mentionable). */
  onReplyTo?: (label: string) => void;
}) {
  const when = formatWhen(messageTimestamp(message) || null);

  return (
    <div className="group flex gap-2">
      <MemberAvatar label={label} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{label}</span>
          {role && <span className="text-muted-foreground text-xs">{role}</span>}
          {when && <span className="text-muted-foreground text-xs">{when}</span>}
          {onReplyTo && (
            <Button
              variant="ghost"
              size="xs"
              type="button"
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => onReplyTo(label)}
            >
              <ReplyIcon className="size-3" /> Reply
            </Button>
          )}
        </div>
        {hasRenderableContent(message) ? (
          <Message align="start" className="max-w-full">
            <MessageContent>
              {message.parts.map((part, idx) => (
                <AgentPart
                  key={part.type === "dynamic-tool" ? part.toolCallId : `${part.type}-${idx}`}
                  part={part}
                />
              ))}
            </MessageContent>
          </Message>
        ) : (
          // A failed turn can leave a contentless assistant message; the cause
          // is not visible here, but the dominant one is a missing/limited LLM
          // key. Say it the way a teammate would, as this agent's own post.
          <Message align="start" className="max-w-full">
            <MessageContent>
              <Bubble variant="muted">
                <BubbleContent className="text-muted-foreground italic">
                  Sorry — I couldn't finish that one. The model may be unavailable or rate-limited;
                  please try again in a little while.
                </BubbleContent>
              </Bubble>
            </MessageContent>
          </Message>
        )}
      </div>
    </div>
  );
}

interface ChannelTimelineProps {
  channel: Channel;
  members: ChannelMember[];
  /** Whether the orchestrator conversation is part of the merge (members > 1). */
  hasOrchestrator: boolean;
  snapshots: Record<string, AgentConversationObservationSnapshot>;
  anyLoading: boolean;
  pendingPosts: PendingPost[];
  postError: string | null;
  onReplyTo: (label: string) => void;
}

export function ChannelTimeline({
  channel,
  members,
  hasOrchestrator,
  snapshots,
  anyLoading,
  pendingPosts,
  postError,
  onReplyTo,
}: ChannelTimelineProps) {
  // Merge every conversation into one timeline, ordered by agent-authored
  // timestamps (dispatch rows carry their own firedAt).
  const rows = useMemo(() => {
    const merged: {
      source: RowSource;
      message: FlueConversationMessage;
      timestamp: string;
    }[] = [];
    for (const member of members) {
      const snapshot = snapshots[observationKey(memberTarget(member, channel.id))];
      for (const message of snapshot?.conversation?.messages ?? []) {
        if (isAdvisoryRow(message)) continue; // runtime bookkeeping, not chat
        merged.push({
          source: { kind: "member", member },
          message,
          timestamp: messageTimestamp(message),
        });
      }
    }
    if (hasOrchestrator) {
      const snapshot = snapshots[observationKey(orchestratorTarget(channel.id))];
      for (const message of snapshot?.conversation?.messages ?? []) {
        if (isAdvisoryRow(message)) continue;
        merged.push({
          source: { kind: "orchestrator" },
          message,
          timestamp: messageTimestamp(message),
        });
      }
    }
    merged.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    return merged;
  }, [members, snapshots, channel.id, hasOrchestrator]);

  const typingSources: { key: string; label: string }[] = [
    ...members
      .filter((m) => isTyping(snapshots[observationKey(memberTarget(m, channel.id))]))
      .map((m) => ({ key: m.id, label: m.name })),
    ...(hasOrchestrator && isTyping(snapshots[observationKey(orchestratorTarget(channel.id))])
      ? [{ key: "orchestrator", label: ORCHESTRATOR_LABEL }]
      : []),
  ];
  const typingKeys = new Set(typingSources.map((t) => t.key));

  // Newest message per conversation. An EARLIER contentless assistant message
  // is retry noise and is hidden; only a still-last one earns the honest
  // "couldn't finish" note.
  const lastMessageKeys = useMemo(() => {
    const keys = new Set<string>();
    const collect = (source: RowSource, target: { name: string; id: string }) => {
      const messages = snapshots[observationKey(target)]?.conversation?.messages ?? [];
      const last = messages[messages.length - 1];
      if (last) keys.add(rowKeyOf(source, last));
    };
    for (const member of members) {
      collect({ kind: "member", member }, memberTarget(member, channel.id));
    }
    if (hasOrchestrator) {
      collect({ kind: "orchestrator" }, orchestratorTarget(channel.id));
    }
    return keys;
  }, [members, snapshots, channel.id, hasOrchestrator]);

  const renderInputRow = (source: RowSource, message: FlueConversationMessage) => {
    const { text, delegatedBy } = parseChannelDispatch(message);
    if (text === null) return null;
    const when = formatWhen(messageTimestamp(message) || null);

    // The orchestrator handing work to a member — its own @mention post.
    if (source.kind === "member" && delegatedBy === "orchestrator") {
      return <HandOffPost when={when} mentionLabel={source.member.name} text={text} />;
    }

    // The user's own post. Caption which member it went to when it was
    // addressed directly in a multi-member channel (mention or 1:1 routing is
    // obvious from context otherwise).
    const caption =
      source.kind === "member" && members.length > 1 ? `to ${source.member.name}` : null;
    return (
      <Message align="end">
        <MessageContent>
          {caption && <span className="text-right text-muted-foreground text-xs">{caption}</span>}
          <Bubble>
            <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  };

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport className="px-4 py-4">
          <MessageScrollerContent className="gap-3">
            {rows.length === 0 && typingSources.length === 0 && pendingPosts.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground text-sm">
                {anyLoading
                  ? "Loading the channel…"
                  : members.length === 0
                    ? "No members yet — invite agents to get the channel going."
                    : "No activity yet. Say something below."}
              </p>
            ) : (
              rows.map((row) => {
                const rowKey = rowKeyOf(row.source, row.message);
                const typingKey =
                  row.source.kind === "member" ? row.source.member.id : "orchestrator";
                // A contentless agent turn renders as its own "couldn't
                // finish" post — but only the newest one (earlier ones are
                // retry noise) and only once the agent is no longer typing (a
                // streaming turn starts contentless).
                const hiddenContentless =
                  row.message.role !== "user" &&
                  !hasRenderableContent(row.message) &&
                  (!lastMessageKeys.has(rowKey) || typingKeys.has(typingKey));
                const rendered = isInputRow(row.message) ? (
                  renderInputRow(row.source, row.message)
                ) : hiddenContentless ? null : row.source.kind === "member" ? (
                  <AgentTurn
                    label={row.source.member.name}
                    role={row.source.member.role}
                    message={row.message}
                    onReplyTo={onReplyTo}
                  />
                ) : (
                  <AgentTurn label={ORCHESTRATOR_LABEL} message={row.message} />
                );
                if (rendered === null) return <Fragment key={rowKey} />;
                return <MessageScrollerItem key={rowKey}>{rendered}</MessageScrollerItem>;
              })
            )}

            {/* Optimistic echo: the user's just-sent posts, visible instantly
                while delivery runs behind them. */}
            {pendingPosts.map((post) => (
              <MessageScrollerItem key={`pending:${post.id}`}>
                <Message align="end">
                  <MessageContent>
                    <Bubble>
                      <BubbleContent className="whitespace-pre-wrap">{post.text}</BubbleContent>
                    </Bubble>
                    <span className="shimmer text-right text-muted-foreground text-xs">
                      {post.note}
                    </span>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}

            {typingSources.map((t) => (
              <MessageScrollerItem key={`typing:${t.key}`}>
                <div className="flex items-center gap-2">
                  <MemberAvatar label={t.label} />
                  <span className="shimmer text-muted-foreground text-sm">
                    {t.label} is typing…
                  </span>
                </div>
              </MessageScrollerItem>
            ))}

            {postError && (
              <MessageScrollerItem>
                <Marker>
                  <MarkerIcon>
                    <CircleAlertIcon className="text-destructive" />
                  </MarkerIcon>
                  <MarkerContent className="text-destructive">{postError}</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
