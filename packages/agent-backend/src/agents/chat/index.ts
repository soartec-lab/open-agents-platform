/**
 * Chat agents — this directory's catalog.
 *
 * THE DIRECTORY IS THE REGISTRY: every ./<name>/agent.ts module is one chat
 * agent — the directory name is the agent name (the module pins the same
 * string as its `agentName` static) and the module's `description` export is
 * spec metadata. Adding an agent = adding its directory: this catalog and
 * src/app.ts's mounts follow from the path. There is no hand-maintained list
 * anywhere.
 *
 * This platform ships exactly two: `orchestrator` (the channel facilitator)
 * and `custom` (the platform agent serving every user-created AgentConfig
 * through composite instance ids).
 *
 * NOT an agent module — no `'use agent'` directive, so v2's content-based scan
 * ignores it; and the glob below matches only <dir>/agent.ts, so this file is
 * never mistaken for one of its own entries. It imports no flue value (the
 * `Agent` type is erased), so it is not a flue seam.
 */

import type { Agent } from "@flue/runtime";

/** What a ./<name>/agent.ts module exports: spec metadata + the agent function. */
interface ChatAgentModule {
  description?: string;
  [exportName: string]: unknown;
}

export interface ChatAgentSpec {
  /** flue agent name (= this module's directory name = its `agentName` static). */
  name: string;
  /** The agent function — the dispatch/mount handle. */
  agent: Agent;
  /** One-line spec description. */
  description: string;
}

// Eagerly import every chat agent module; vite resolves this glob at build time
// (and re-evaluates it in dev when directories are added or removed). The
// pattern is relative to THIS file.
const modules = import.meta.glob<ChatAgentModule>("./*/agent.ts", { eager: true });

/** Every chat agent, in directory-name order. */
export const CHAT_AGENTS: ChatAgentSpec[] = Object.entries(modules)
  .map(([path, mod]): ChatAgentSpec => {
    // "./custom/agent.ts" → "custom"
    const name = path.split("/").at(-2);
    if (!name) throw new Error(`chat agent path has no directory segment: ${path}`);
    // The convention is enforced, not guessed: the module must export a function
    // whose pinned agentName equals its directory name. A mismatch would move the
    // agent's URL away from its stored history silently.
    const agent = Object.values(mod).find(
      (value): value is Agent => typeof value === "function" && (value as Agent).agentName === name,
    );
    if (!agent) {
      throw new Error(
        `${path} exports no agent function with agentName "${name}" — the directory name must equal the pinned agentName`,
      );
    }
    return { name, agent, description: mod.description ?? "" };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
