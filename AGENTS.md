# AGENTS.md — open-agents-platform

Authoritative context file for Claude Code (and any fresh session) picking up this repo.
`CLAUDE.md` is a one-line import of this file (org convention).

---

## Project Purpose

`open-agents-platform` is an open-source agent management platform: users create their own
agents (name + instructions, stored in the DB), invite one or more of them into
**Discord-like channels** with an optional goal, and an **orchestrator** agent coordinates
multi-agent channels — answering directly or delegating work to members, whose replies land
straight in the shared timeline. A channel with a single member is a 1:1 chat; a channel
with several is a small agent organization. The long-term goal is letting anyone compose
their own organization of cooperating agents and finish real work inside it.

Extracted from the `flue-with-mcp-apps` spike (vendored as a git submodule at
`./flue-with-mcp-apps` — the extraction source and design-history archive; see its own
AGENTS.md/docs for the full verified-facts ledger this repo's conventions descend from).

| package | role | port |
|---|---|---|
| `packages/agent-backend` | flue runtime + channel dispatch seam + REST (Hono + Prisma/SQLite) | 42080 |
| `packages/agent-frontend` | React Router SPA: sidebar + channel rooms + agent management | 42173 |

**v1 scope decisions (deliberate):** Anthropic Sonnet only (`AGENT_MODEL` env, one model for
every agent); **no MCP integration** (no tool factory, no dataKey cache, no `/mcp/*` proxy,
no AppRenderer/sandbox — the method-C machinery lives in the submodule and returns when MCP
does); no ambient agents; no AI-job workflows; no per-session custom instructions; no
session-switcher UI (the app session is silent auth plumbing — channels are the unit of
conversation). The ONE tool in the whole system is the orchestrator's `delegate_to_member`.

### Extraction status

- [x] Dev environment: `.devcontainer/` + `compose.yml` (workspace container; `apps` profile)
- [x] Root workspace config: `package.json` / `bunfig.toml` / `tsconfig*.json` / `biome.json`
- [x] `openapi/agent/` contract + per-package orval generation
- [x] `packages/agent-backend`
- [x] `packages/agent-frontend`
- [x] CRM seams stripped (no `/channels/crm`, no internal secret, no CRM presets/workflows)
- [x] End-to-end browser verification with a real `ANTHROPIC_API_KEY` (2026-08-18: the
      recorded demo walked agent creation → channel with goal → orchestrator delegation →
      member replies in the merged timeline; see the video in README.md)

Development happens **inside the devcontainer** ("Reopen in Container"). The image carries
Bun AND real Node 22 — flue requires real Node ≥ 22.19 and refuses to run under Bun
(`bun run dev` is fine — the vite binary resolves to real node).

---

## Architecture

### The message flow (the heart of the product)

```
user posts to a channel (POST /channels/:id/messages, 202 on admission)
  ├─ body has memberId (frontend resolved a leading @mention) → dispatch to that member
  ├─ channel has exactly ONE member                            → dispatch to that member
  └─ otherwise → dispatch to the orchestrator (instance `channel-<id>`)
        └─ orchestrator answers and/or calls delegate_to_member
              └─ in-process dispatch to the member (instance `<configId>__channel-<id>`)

frontend observes every member conversation + (multi-member) the orchestrator's over SSE
(read-only GET), merges them client-side by agent-authored timestamps → ONE timeline.
Member replies appear directly; the orchestrator never relays them.
```

**Load-bearing invariant: every `/agents/*` conversation is READ-ONLY over HTTP** (GET/HEAD
for SSE observation; the two guards 403 everything else including `/abort`). The ONLY write
path into any conversation is the in-process dispatch behind `POST /channels/:id/messages`.
This is what made a session-binding table unnecessary — authorization is channel
membership, not conversation ownership.

### Backend layout

```
packages/agent-backend/src/
  agents/
    chat/<name>/      # agent.ts + instructions.md; index.ts = import.meta.glob catalog
      custom/         # THE platform agent: serves every user-created AgentConfig via
                      #   composite instance id <configId>__channel-<channelId>
      orchestrator/   # THE facilitator: per-channel instance channel-<channelId>;
                      #   prompt templated from instructions.md ({{CHANNEL}}/{{GOAL}}/{{ROSTER}})
    channel-member-instructions.md  # shared paragraph appended to every member's base rules
  channel-agents.ts   # THE flue seam (the only non-agent @flue/runtime importer):
                      #   instance-id scheme + dispatchChannelMember/dispatchOrchestrator
  tools/delegate.ts   # delegate_to_member — the ONE hand-defined tool (orchestrator only),
                      #   a per-render factory over the live member roster
  middlewares/index.ts # whole pipeline; app session is the DEFAULT auth (deny by default;
                      #   public: /health + POST /session) + the two read-only guards
  models/             # Prisma model layer, one file per table: agent-config (owns
                      #   composeInstructions, the user-instruction trust boundary),
                      #   channel, channel-member, session, custom-instance-id, prisma
  db.ts               # flue's RESERVED persistence-adapter slot — not a model
  handlers/ routes.ts # orval-generated REST boundary (hand-owned *.handlers.ts)
  app.ts              # composition root: middleware → generated routes → derived agent mounts
```

Conventions that MUST survive: directory name === agentName (the catalog throws at boot on
a mismatch); prompt prose lives in `instructions.md`, never TypeScript strings; the
directory catalog is the only agent registry; an agent outside `chat/` has no HTTP surface;
`src/db.ts` is flue's slot — hand-written models go in `src/models/`.

### The context-priming pattern (v2 timing constraint)

flue agent functions render synchronously when a submission starts, BEFORE the async
`useAgentStart` seam runs — so both agents use three layers: (1) a module-scope prime map
written by `channel-agents.ts` immediately before every dispatch, (2) a
`usePersistentState` backstop for durable-queue replays after restart, (3) a per-delivered-
message DB re-read in `useAgentStart` (which is also the freshness story: config edits,
invites/removals, and goal changes apply on the next message).

### Trust separation

`composeInstructions` (src/models/agent-config.ts) is the trust boundary for user-written
agent instructions: sanitized (4000-char cap, role-marker lines dropped, chat tokens
stripped, wrapper tag re-escaped) and folded UNDER the operator hard rules as an explicitly
lower-priority `<user-customization>` section. The orchestrator's roster lines (member
names/roles/instruction briefs — all user text) are whitespace-collapsed, length-capped,
and marked untrusted in its prompt.

### Frontend layout

```
packages/agent-frontend/app/
  root.tsx            # silent session bootstrap + memoized conversation-client factory
                      #   (owns the ConversationClientFactory type)
  components/Sidebar.tsx  # channels list (+ create) + Agents nav — shared by all routes
  routes/
    home/             # empty state
    channels/         # the room: goal header, member chips, merged timeline, composer;
                      #   also owns useObservedConversation.ts (SSE observation hooks) and
                      #   the message classification/timestamp helpers (in ChannelTimeline)
    agents/           # AgentConfig CRUD
  lib/utils.ts        # the ONLY lib file (shadcn regenerates imports against it) —
                      #   do not grow lib/ back; pair helpers with their consumers instead
  api/                # orval-generated SWR client (base URL baked from the contract)
    fetcher.ts        # hand-written custom-fetch mutator: owns REST auth end to end
                      #   (root.tsx deposits the session token; no call site passes headers)
```

Frontend gotchas that are load-bearing: the room is keyed per channel id (state must not
leak across switches); optimistic echoes reconcile against the REAL dispatch row with a
time window + clock slack (text-only matching resurrects old rows); `absent` SSE
observations never self-attach — the hooks re-probe every 10s; `shimmer`/`scrollbar-*`
utility classes come from `@import "shadcn/tailwind.css"` in app.css.

---

## flue Version Caveats

- **Pin `flue`/`@flue/*` to exactly `2.0.1`.** Do not bump without re-verifying: (1) a
  tool's `run()` still returns the `{ output, terminate? }` envelope (bare objects throw),
  (2) message `purpose`/agent-authored `metadata` projection is unchanged, (3) the
  `'use agent'` scan + `createAgentRouter` mounting still work as wired.
- **`useResponseStart(() => ({ timestamp: ... }))` must be spelled verbatim in every
  agent** — the merged timelines sort by this metadata key, flue types don't check it, and
  a typo fails silently (rows sort to the top).
- **`dispatch()` resolves on admission only** — outcomes are read from the conversations.
  Dispatched failures were observed to SETTLE on 2.0.1 (`outcome: "failed"` with the
  provider error), but keep derived-outcome fallbacks in any run-log UI.
- **v2 attaches no implicit sandbox**; the never-use-bash lines in agent prompts are
  defense in depth.
- **Env:** the dev stack reads exactly ONE env file, `packages/agent-backend/.env`
  (a repo-root `.env` is read by NOTHING — Bun loads per-cwd).
- **`vite dev` reload hazards:** hot reload drops live SSE connections and can wedge the
  flue runtime (closed SQLite handle / drain timeout) — restart the stack rather than
  debugging app code first. Treat `bun run generate` as a stack-restarting operation.

---

## Build / Run

Inside the devcontainer:

```sh
bun install            # workspace install
cp .env.example packages/agent-backend/.env   # then set ANTHROPIC_API_KEY
bun --filter '*' dev   # start both processes
bun run typecheck      # all packages
bun run biome          # lint + format check (submodule excluded)
bun run generate       # orval codegen after editing openapi/agent/
```

Or from the host: `docker compose --profile apps up`.

---

## Conventions

- **Validation:** valibot in hand-written code; zod ONLY in orval-generated REST boundary
  code. Never introduce zod by hand.
- **Codegen:** orval 8.19.0, per-package `orval.config.ts`, each with
  `output.tsconfig: "../../tsconfig.base.json"` pinned (do not remove — prevents `.ts`
  import-extension drift). Generated files are committed. Request/response shapes live
  ONLY in the OpenAPI contract — never re-declare them in TypeScript (the response
  validator silently strips undeclared keys; nullable model fields must be mapped to
  ABSENT fields in handlers or the response validator rejects the row).
- **Contract `servers` entry** (`http://localhost:42080`) must stay — the frontend orval
  config bakes its REST base URL from it. The frontend config also pins
  `override.mutator` to `app/api/fetcher.ts` (hand-written, regen-safe) — REST auth is
  injected there, never passed per call site.
- **Lint/format:** Biome; overrides suppress rules only for generated paths; the
  `flue-with-mcp-apps` submodule is excluded (it is its own biome root).
- **English** for code, docs, and commit messages. Commits are fine-grained, committed
  directly to `main`.

## Known limits (v1, accepted)

- No ownership/user identity: the agent and channel catalogs are shared across sessions
  (same deferred-ownership stance as the spike).
- N members + orchestrator = N+1 SSE streams per open room; HTTP/1.1 allows 6 per host, so
  channels with more than ~4 members may starve the re-probe. Revisit before large rosters.
- Members have no tools and cannot talk to each other directly — collaboration flows
  through the orchestrator's delegation and the shared timeline.

## Do NOT

- Put provider API keys, `APP_SESSION_SECRET`, or any server-side secret anywhere a
  browser can reach (response, bundle, `VITE_*` var).
- Add a write path to any `/agents/*` conversation. Read-only over HTTP is the platform's
  authorization model — writes go through `POST /channels/:id/messages` only.
- Hand-define more flue tools without a recorded decision (`delegate_to_member` is the
  sole one), and never wire it into a member agent (no agent→agent→agent chains).
- Import `@flue/runtime` from any non-agent module other than `src/channel-agents.ts`.
- Convert `channel-agents.ts`'s exports to arrow-function consts — the agent↔seam import
  cycle is safe only because they are hoisted function declarations referenced inside
  function bodies.
- Skip `composeInstructions` when user-written instruction text enters a prompt.
- Add an agent anywhere other than one directory under `src/agents/chat/<name>/`
  (agent.ts + instructions.md, directory name === agentName), or reintroduce a hand-written
  agent catalog / shared agent-hook module.
- Use `src/db.ts` for hand-written models — it is flue's reserved persistence-adapter slot.
- Bump `flue` off `2.0.1` without a reviewed re-verification.
