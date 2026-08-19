/**
 * Channel model (hand-owned) — 1:1 with the `Channel` table.
 *
 * Names align across layers: the API schema (`Channel` in openapi/agent), the
 * table, and this backend model all use `Channel`.
 *
 * A record is a Discord-like channel: a name, an optional goal, and (via
 * ./channel-member.ts) invited member agents. The catalog is shared across
 * sessions (same deferred-ownership stance as AgentConfig). Callers are the
 * `/channels` handlers and the channel dispatcher (src/dispatchers/message-dispatcher.ts).
 * This module is part of the backend layer AROUND flue and has no flue
 * dependency.
 */
import { prisma } from "./prisma.ts";

export interface Channel {
  id: string;
  name: string;
  goal: string | null;
  /** ISO 8601 — the REST contract uses a string, so the Date is mapped on read. */
  createdAt: string;
}

const toRecord = (r: {
  id: string;
  name: string;
  goal: string | null;
  createdAt: Date;
}): Channel => ({
  id: r.id,
  name: r.name,
  goal: r.goal,
  createdAt: r.createdAt.toISOString(),
});

export const Channel = {
  /** All channels, newest first. */
  async list(): Promise<Channel[]> {
    const rows = await prisma.channel.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toRecord);
  },

  /** One channel by id, or null. */
  async get(id: string): Promise<Channel | null> {
    const row = await prisma.channel.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  },

  /** Create a channel (members start empty). */
  async create(input: { name: string; goal?: string }): Promise<Channel> {
    const row = await prisma.channel.create({
      data: { name: input.name, goal: input.goal ?? null },
    });
    return toRecord(row);
  },

  /**
   * Update name and/or goal. Field semantics: undefined = keep, null (goal
   * only) = clear. Returns null when the id does not exist (a 404 at the
   * handler).
   */
  async update(
    id: string,
    input: { name?: string; goal?: string | null },
  ): Promise<Channel | null> {
    try {
      const row = await prisma.channel.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.goal !== undefined && { goal: input.goal }),
        },
      });
      return toRecord(row);
    } catch {
      // P2025 (record not found) → treat as a 404 at the handler.
      return null;
    }
  },

  /**
   * Delete a channel. Members are removed by the relation's
   * `onDelete: Cascade`. Agent conversations in flue's store are left as-is —
   * they are unreachable once the channel row is gone. Returns false when the
   * id does not exist.
   */
  async remove(id: string): Promise<boolean> {
    try {
      await prisma.channel.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  },
};
