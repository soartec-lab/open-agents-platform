/**
 * ChannelMember model (hand-owned) — 1:1 with the `ChannelMember` table.
 *
 * One invited agent in a channel. Every read joins the member's AgentConfig
 * so callers get the display name, role, and instructions in one shape:
 * the REST layer serializes name/role (the generated response validator
 * strips `instructions`), and the dispatcher (src/channel-agents.ts) and the
 * orchestrator's context loader consume name/instructions in-process.
 * Duplicate membership is backed by the DB compound unique
 * (`@@unique([channelId, configId])`), surfaced as the `"already_member"`
 * sentinel. This module is part of the backend layer AROUND flue and has no
 * flue dependency.
 */
import { prisma } from "./prisma.ts";

export interface ChannelMember {
  id: string;
  channelId: string;
  configId: string;
  /** Display name, denormalized from the member's AgentConfig. */
  name: string;
  /** Job-title label, denormalized from the member's AgentConfig. */
  role: string | null;
  /** Instructions, denormalized for in-process dispatch (never serialized). */
  instructions: string;
  /** ISO 8601 — the REST contract uses a string, so the Date is mapped on read. */
  createdAt: string;
}

const toRecord = (r: {
  id: string;
  channelId: string;
  configId: string;
  createdAt: Date;
  config: { name: string; role: string | null; instructions: string };
}): ChannelMember => ({
  id: r.id,
  channelId: r.channelId,
  configId: r.configId,
  name: r.config.name,
  role: r.config.role,
  instructions: r.config.instructions,
  createdAt: r.createdAt.toISOString(),
});

export const ChannelMember = {
  /** A channel's members, in invite order, with their configs joined. */
  async listByChannel(channelId: string): Promise<ChannelMember[]> {
    const rows = await prisma.channelMember.findMany({
      where: { channelId },
      include: { config: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toRecord);
  },

  /** One member by id, or null. */
  async get(id: string): Promise<ChannelMember | null> {
    const row = await prisma.channelMember.findUnique({
      where: { id },
      include: { config: true },
    });
    return row ? toRecord(row) : null;
  },

  /**
   * Whether the agent is a member of the channel (the conversation guard's
   * membership check).
   */
  async exists(channelId: string, configId: string): Promise<boolean> {
    const row = await prisma.channelMember.findUnique({
      where: { channelId_configId: { channelId, configId } },
    });
    return row !== null;
  },

  /**
   * Invite an agent; `"already_member"` on the compound-unique violation.
   * The handler validates that the config exists before calling this.
   */
  async create(input: {
    channelId: string;
    configId: string;
  }): Promise<ChannelMember | "already_member"> {
    try {
      const row = await prisma.channelMember.create({
        data: input,
        include: { config: true },
      });
      return toRecord(row);
    } catch (err) {
      if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002") {
        return "already_member";
      }
      throw err;
    }
  },

  /**
   * Remove a member. Its per-channel conversation is left in place so a
   * re-invite reattaches the same history. Returns false when the id does
   * not exist.
   */
  async remove(id: string): Promise<boolean> {
    try {
      await prisma.channelMember.delete({ where: { id } });
      return true;
    } catch {
      // P2025 (record not found) → treat as a 404 at the handler.
      return false;
    }
  },
};
