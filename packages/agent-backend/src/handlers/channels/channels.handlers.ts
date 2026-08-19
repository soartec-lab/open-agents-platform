/**
 * Hand-owned handlers for the `channels` tag. Scaffolded once by orval
 * (`handlerGenerationStrategy: "skip"`) and never overwritten; the sibling
 * `.context.ts` / `.zod.ts` files are regenerated.
 *
 * A channel is a name + optional goal + invited member agents. The messages
 * endpoint is the SOLE write path into any agent conversation (the /agents/*
 * HTTP surface is read-only observation): a message goes directly to the
 * member when the channel has exactly one (or when `memberId` names one),
 * and to the orchestrator otherwise, which delegates via its tool. The
 * catalog is shared across sessions (deferred ownership); the middleware
 * pipeline gates access.
 */
import { createFactory } from "hono/factory";
import {
  dispatchChannelMember,
  dispatchOrchestrator,
} from "../../dispatchers/message-dispatcher.ts";
import { AgentConfig } from "../../models/agent-config.ts";
import { Channel } from "../../models/channel.ts";
import { ChannelMember } from "../../models/channel-member.ts";
import { zValidator } from "../validator";
import type {
  CreateChannelContext,
  CreateChannelMemberContext,
  CreateChannelMessageContext,
  DeleteChannelContext,
  DeleteChannelMemberContext,
  GetChannelsContext,
  UpdateChannelContext,
} from "./channels.context";
import {
  CreateChannelBody,
  CreateChannelMemberBody,
  CreateChannelMemberParams,
  CreateChannelMessageBody,
  CreateChannelMessageParams,
  DeleteChannelMemberParams,
  DeleteChannelParams,
  GetChannelsResponse,
  UpdateChannelBody,
  UpdateChannelParams,
  UpdateChannelResponse,
} from "./channels.zod";

const factory = createFactory();

// The REST contract expresses "no goal"/"no role" as ABSENT fields; the
// models use null. Serialize through these mappings or the generated
// response validator rejects the row ("expected string, received null").
// (`instructions` on a member is in-process data the validator strips.)
const memberToApi = (member: ChannelMember) => ({
  ...member,
  role: member.role ?? undefined,
});

const withMembers = async (channel: Channel) => ({
  ...channel,
  goal: channel.goal ?? undefined,
  members: (await ChannelMember.listByChannel(channel.id)).map(memberToApi),
});

/** The loose ValidationError shape the generated validators emit. */
const validationError = (path: string, message: string) => ({
  success: false as const,
  error: { issues: [{ path: [path], message }] },
});

export const getChannelsHandlers = factory.createHandlers(
  zValidator("response", GetChannelsResponse),
  async (c: GetChannelsContext) => {
    const channels = await Channel.list();
    return c.json({ channels: await Promise.all(channels.map(withMembers)) });
  },
);

export const createChannelHandlers = factory.createHandlers(
  zValidator("json", CreateChannelBody),
  async (c: CreateChannelContext) => {
    const channel = await Channel.create(c.req.valid("json"));
    return c.json({ ...channel, goal: channel.goal ?? undefined, members: [] }, 201);
  },
);

export const updateChannelHandlers = factory.createHandlers(
  zValidator("param", UpdateChannelParams),
  zValidator("json", UpdateChannelBody),
  zValidator("response", UpdateChannelResponse),
  async (c: UpdateChannelContext) => {
    const { id } = c.req.valid("param");
    const channel = await Channel.update(id, c.req.valid("json"));
    if (!channel) return c.json({ error: "Channel not found" }, 404);
    return c.json(await withMembers(channel));
  },
);

export const deleteChannelHandlers = factory.createHandlers(
  zValidator("param", DeleteChannelParams),
  async (c: DeleteChannelContext) => {
    const { id } = c.req.valid("param");
    if (!(await Channel.remove(id))) {
      return c.json({ error: "Channel not found" }, 404);
    }
    return c.body(null, 204);
  },
);

export const createChannelMemberHandlers = factory.createHandlers(
  zValidator("param", CreateChannelMemberParams),
  zValidator("json", CreateChannelMemberBody),
  async (c: CreateChannelMemberContext) => {
    const { id } = c.req.valid("param");
    const { configId } = c.req.valid("json");
    if (!(await Channel.get(id))) {
      return c.json({ error: "Channel not found" }, 404);
    }
    // Target existence cannot be a schema check — the catalog lives in the DB.
    if (!(await AgentConfig.get(configId))) {
      return c.json(validationError("configId", "agent config not found"), 400);
    }
    const member = await ChannelMember.create({ channelId: id, configId });
    if (member === "already_member") {
      return c.json({ error: "Agent is already a channel member" }, 409);
    }
    return c.json({ ...member, role: member.role ?? undefined }, 201);
  },
);

export const deleteChannelMemberHandlers = factory.createHandlers(
  zValidator("param", DeleteChannelMemberParams),
  async (c: DeleteChannelMemberContext) => {
    const { id, memberId } = c.req.valid("param");
    if (!(await Channel.get(id))) {
      return c.json({ error: "Channel not found" }, 404);
    }
    const member = await ChannelMember.get(memberId);
    if (!member || member.channelId !== id) {
      return c.json({ error: "Channel member not found" }, 404);
    }
    await ChannelMember.remove(memberId);
    return c.body(null, 204);
  },
);

export const createChannelMessageHandlers = factory.createHandlers(
  zValidator("param", CreateChannelMessageParams),
  zValidator("json", CreateChannelMessageBody),
  async (c: CreateChannelMessageContext) => {
    const { id } = c.req.valid("param");
    const { text, memberId } = c.req.valid("json");
    const channel = await Channel.get(id);
    if (!channel) return c.json({ error: "Channel not found" }, 404);
    const members = await ChannelMember.listByChannel(id);
    if (members.length === 0) {
      return c.json({ error: "Channel has no members" }, 409);
    }

    // Routing: an explicit memberId (the frontend resolves a leading
    // @mention) or a single-member channel delivers straight to the member;
    // anything else goes to the orchestrator, which answers and/or delegates.
    if (memberId !== undefined) {
      const member = members.find((m) => m.id === memberId);
      if (!member) return c.json({ error: "Channel member not found" }, 404);
      await dispatchChannelMember(member, channel, text);
    } else if (members.length === 1) {
      await dispatchChannelMember(members[0], channel, text);
    } else {
      await dispatchOrchestrator(channel, members, text);
    }
    // dispatch() resolves on admission only — the reply is read from the
    // conversation streams the frontend observes.
    return c.body(null, 202);
  },
);
