/**
 * `/channels/:channelId` — one channel's room: the compact header (name, goal,
 * member chips, invite/edit), the merged timeline (ChannelTimeline), and the
 * composer.
 *
 * The composer needs NO mention: a leading "@name " goes straight to that
 * member; anything else is routed by the backend — straight to the member in
 * a 1:1 channel, to the orchestrator otherwise, which answers and/or
 * delegates. Replies appear directly in the merged timeline (SSE
 * observation); nothing is relayed.
 */

import { PencilIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import { mutate } from "swr";
import {
  getGetChannelsKey,
  useCreateChannelMessage,
  useDeleteChannel,
  useDeleteChannelMember,
  useGetChannels,
  useUpdateChannel,
} from "../../api/channels/channels.ts";
import type { Channel, ChannelMember } from "../../api/schemas";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { bearer } from "../../lib/bearer.ts";
import { isInputRow, messageTimestamp } from "../../lib/message-time.ts";
import {
  type ConversationClientFactory,
  useObservedConversations,
} from "../../lib/useObservedConversation.ts";
import type { AppOutletContext } from "../../root.tsx";
import { ChannelTimeline, type PendingPost, parseChannelDispatch } from "./ChannelTimeline.tsx";
import { InviteMembersDialog } from "./InviteMembersDialog.tsx";
import {
  avatarColor,
  avatarInitials,
  memberTarget,
  mentionSlug,
  ORCHESTRATOR_LABEL,
  orchestratorTarget,
  resolveMention,
} from "./members.ts";

export default function ChannelRoute() {
  const { conversationFor, token } = useOutletContext<AppOutletContext>();
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const { data: channelsRes, isLoading } = useGetChannels({
    fetch: { headers: bearer(token) },
  });
  const channel =
    channelsRes?.status === 200
      ? (channelsRes.data.channels.find((c) => c.id === channelId) ?? null)
      : null;

  if (!channel) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        {isLoading ? "Loading…" : "Channel not found — it may have been deleted."}
      </div>
    );
  }

  return (
    <ChannelRoom
      // Remount per channel so composer/echo/observation state never leaks
      // across a channel switch.
      key={channel.id}
      conversationFor={conversationFor}
      token={token}
      channel={channel}
      onChanged={() => void mutate(getGetChannelsKey())}
      onDeleted={() => {
        void mutate(getGetChannelsKey());
        void navigate("/");
      }}
    />
  );
}

function ChannelRoom({
  conversationFor,
  token,
  channel,
  onChanged,
  onDeleted,
}: {
  conversationFor: ConversationClientFactory;
  token: string;
  channel: Channel;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const members = channel.members;
  const hasOrchestrator = members.length > 1;
  const targets = useMemo(
    () => [
      ...members.map((m) => memberTarget(m, channel.id)),
      ...(hasOrchestrator ? [orchestratorTarget(channel.id)] : []),
    ],
    [members, channel.id, hasOrchestrator],
  );
  const { snapshots, refresh } = useObservedConversations(conversationFor, targets);
  const anyLoading =
    targets.length > 0 &&
    Object.values(snapshots).some((s) => s.phase === "loading" || s.phase === "connecting");

  const [inputText, setInputText] = useState("");
  // Optimistic echo (see handleSubmit): the user's posts render immediately
  // from here while delivery runs behind them.
  const [pendingPosts, setPendingPosts] = useState<PendingPost[]>([]);
  const [postError, setPostError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  // The memberId travels in the BODY, so one mutation hook serves every
  // routing shape. The composer deliberately never locks.
  const { trigger: postMessage } = useCreateChannelMessage(channel.id, {
    fetch: { headers: bearer(token) },
  });

  // Retire an optimistic echo only when ITS OWN dispatch row is visible in a
  // conversation: same text AND newer than the echo's sentAt (with clock
  // slack). Matching by text alone would let an OLD row with identical text —
  // the user asking the same thing again later — retire the fresh echo.
  useEffect(() => {
    if (!pendingPosts.some((p) => p.delivered)) return;
    const newestRowAt = new Map<string, string>();
    for (const snapshot of Object.values(snapshots)) {
      for (const message of snapshot.conversation?.messages ?? []) {
        if (!isInputRow(message)) continue;
        const { text } = parseChannelDispatch(message);
        if (text === null) continue;
        const timestamp = messageTimestamp(message);
        if (timestamp > (newestRowAt.get(text) ?? "")) {
          newestRowAt.set(text, timestamp);
        }
      }
    }
    const CLOCK_SLACK_MS = 120_000;
    const rowIsOwn = (p: PendingPost): boolean => {
      const rowAt = Date.parse(newestRowAt.get(p.text) ?? "");
      return !Number.isNaN(rowAt) && rowAt >= Date.parse(p.sentAt) - CLOCK_SLACK_MS;
    };
    setPendingPosts((prev) => {
      const next = prev.filter((p) => !(p.delivered && rowIsOwn(p)));
      return next.length === prev.length ? prev : next;
    });
  }, [snapshots, pendingPosts]);

  // While a delivered echo is still waiting for its row, re-probe the
  // conversations — dispatch is admission-only and the SSE stream may have
  // gone quiet, so a periodic refresh is the reliable catch-up path.
  useEffect(() => {
    if (!pendingPosts.some((p) => p.delivered)) return;
    const timer = setInterval(() => {
      for (const target of targets) refresh(target);
    }, 3000);
    return () => clearInterval(timer);
  }, [pendingPosts, targets, refresh]);

  // The user's post shows up IMMEDIATELY as a pending bubble (optimistic
  // echo); delivery happens behind it and the real timeline row takes over
  // once the dispatch lands (the reconcile effect above swaps them). The
  // composer never locks.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    const mention = resolveMention(text, members);
    const body = mention ? mention.body : text;
    const note = mention
      ? `to ${mention.member.name}…`
      : members.length === 1
        ? `to ${members[0].name}…`
        : `${ORCHESTRATOR_LABEL} is on it…`;
    const pendingId = crypto.randomUUID();
    setPendingPosts((prev) => [
      ...prev,
      { id: pendingId, text: body, note, sentAt: new Date().toISOString() },
    ]);
    setInputText("");
    setPostError(null);
    try {
      const res = await postMessage({
        text: body,
        ...(mention && { memberId: mention.member.id }),
      });
      if (res.status === 202) {
        setPendingPosts((prev) =>
          prev.map((p) => (p.id === pendingId ? { ...p, delivered: true } : p)),
        );
        for (const target of targets) refresh(target);
        return;
      }
      throw new Error(
        res.status === 409
          ? "Invite at least one agent first."
          : `Post failed (HTTP ${res.status}).`,
      );
    } catch (err) {
      setPendingPosts((prev) => prev.filter((p) => p.id !== pendingId));
      setInputText(text); // let the user just hit send again
      setPostError(err instanceof Error ? err.message : "Post failed.");
    }
  };

  const prefillMention = (label: string) =>
    setInputText((prev) => `@${mentionSlug(label)} ${prev.replace(/^@\S+\s*/, "")}`);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      {/* The goal, always visible and compact (the channel exists for it). */}
      <header className="shrink-0 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-semibold text-base"># {channel.name}</h1>
          {hasOrchestrator && (
            <span
              className="flex items-center gap-1 rounded-full border border-dashed py-0.5 pr-1.5 pl-0.5 text-xs"
              title="The orchestrator reads unaddressed posts, answers coordination itself, and delegates work to members. Present in every multi-agent channel."
            >
              <span
                className={`flex size-4 items-center justify-center rounded-full text-[9px] text-white ${avatarColor(ORCHESTRATOR_LABEL)}`}
              >
                {avatarInitials(ORCHESTRATOR_LABEL)}
              </span>
              {ORCHESTRATOR_LABEL}
            </span>
          )}
          <Button variant="ghost" size="xs" type="button" onClick={() => setEditOpen(true)}>
            <PencilIcon className="size-3" />
          </Button>
        </div>
        {channel.goal && (
          <p className="truncate text-muted-foreground text-sm" title={channel.goal}>
            {channel.goal}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {members.map((member) => (
            <MemberChip
              key={member.id}
              channelId={channel.id}
              member={member}
              token={token}
              onChanged={onChanged}
            />
          ))}
          <Button variant="ghost" size="xs" type="button" onClick={() => setInviteOpen(true)}>
            <PlusIcon className="size-3" /> Invite
          </Button>
        </div>
      </header>

      <ChannelTimeline
        channel={channel}
        members={members}
        hasOrchestrator={hasOrchestrator}
        snapshots={snapshots}
        anyLoading={anyLoading}
        pendingPosts={pendingPosts}
        postError={postError}
        onReplyTo={prefillMention}
      />

      <div className="shrink-0 border-t px-4 py-3">
        {members.length > 1 && (
          <div className="mb-2 flex flex-wrap items-center gap-1">
            {members.map((member) => (
              <Button
                key={member.id}
                variant="outline"
                size="xs"
                type="button"
                onClick={() => prefillMention(member.name)}
              >
                @{mentionSlug(member.name)}
              </Button>
            ))}
          </div>
        )}
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <Input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              members.length === 0
                ? "Invite an agent to start talking"
                : members.length === 1
                  ? `Message ${members[0].name}`
                  : "Say something — @mention a member, or let the orchestrator coordinate"
            }
            disabled={members.length === 0}
          />
          <Button type="submit" disabled={!inputText.trim() || members.length === 0}>
            Send
          </Button>
        </form>
      </div>

      <EditChannelDialog
        open={editOpen}
        channel={channel}
        token={token}
        onClose={() => setEditOpen(false)}
        onChanged={onChanged}
        onDeleted={onDeleted}
      />
      <InviteMembersDialog
        open={inviteOpen}
        channel={channel}
        token={token}
        onClose={() => setInviteOpen(false)}
        onChanged={onChanged}
      />
    </div>
  );
}

/** One member chip in the header — owns its remove mutation. */
function MemberChip({
  channelId,
  member,
  token,
  onChanged,
}: {
  channelId: string;
  member: ChannelMember;
  token: string;
  onChanged: () => void;
}) {
  const { trigger: removeMember, isMutating: removing } = useDeleteChannelMember(
    channelId,
    member.id,
    { fetch: { headers: bearer(token) } },
  );

  const handleRemove = async () => {
    if (removing) return;
    await removeMember();
    onChanged();
  };

  return (
    <span
      className="flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-0.5 text-xs"
      title={member.role}
    >
      <span
        className={`flex size-4 items-center justify-center rounded-full text-[9px] text-white ${avatarColor(member.name)}`}
      >
        {avatarInitials(member.name)}
      </span>
      {member.name}
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        title="Remove from channel"
        disabled={removing}
        onClick={() => void handleRemove()}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

/** Edit name/goal, or delete the channel. */
function EditChannelDialog({
  open,
  channel,
  token,
  onClose,
  onChanged,
  onDeleted,
}: {
  open: boolean;
  channel: Channel;
  token: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(channel.name);
  const [goal, setGoal] = useState(channel.goal ?? "");
  const [error, setError] = useState<string | null>(null);

  const { trigger: update, isMutating: saving } = useUpdateChannel(channel.id, {
    fetch: { headers: bearer(token) },
  });
  const { trigger: remove, isMutating: deleting } = useDeleteChannel(channel.id, {
    fetch: { headers: bearer(token) },
  });

  const handleSave = async () => {
    if (saving || !name.trim()) return;
    setError(null);
    const trimmedGoal = goal.trim();
    const res = await update({
      name: name.trim(),
      // null clears the goal; a non-empty string replaces it.
      goal: trimmedGoal === "" ? null : trimmedGoal,
    });
    if (res.status !== 200) {
      setError(`Save failed (HTTP ${res.status}).`);
      return;
    }
    onChanged();
    onClose();
  };

  const handleDelete = async () => {
    if (deleting) return;
    const res = await remove();
    if (res.status !== 204) {
      setError(`Delete failed (HTTP ${res.status}).`);
      return;
    }
    onDeleted();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit #{channel.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-channel-name">Name</Label>
            <Input
              id="edit-channel-name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-channel-goal">Goal</Label>
            <Textarea
              id="edit-channel-goal"
              value={goal}
              maxLength={2000}
              rows={3}
              placeholder="Empty clears the goal."
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              type="button"
              className="text-destructive"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              Delete channel
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saving || !name.trim()}
                onClick={() => void handleSave()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
