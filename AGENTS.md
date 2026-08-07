# AGENTS.md — open-agents-platform

Authoritative context file for Claude Code (and any fresh session) picking up this repo.
`CLAUDE.md` is a one-line import of this file (org convention).

---

## Project Purpose

`open-agents-platform` is an open agent management platform (AIaaS) extracted from the
`flue-with-mcp-apps` spike (vendored as a git submodule at `./flue-with-mcp-apps`, the
extraction source). Only two packages are being extracted and optimized here:

| package | role | port |
|---|---|---|
| `packages/agent-backend` | flue runtime + MCP client + `dataKey` cache + proxy + ambient-agent runner | 41080 |
| `packages/agent-frontend` | React Router chat UI + `@mcp-ui/client` AppRenderer + same-origin sandbox proxy | 41173 |

The MCP server is NOT part of this repo — the backend reaches whatever `MCP_SERVER_URL`
points at (default `http://localhost:41005/mcp`; the URL must include the `/mcp` path),
and its tool catalog degrades gracefully when the server is unreachable.

### Extraction status

- [x] Dev environment: `.devcontainer/` + `compose.yml` (workspace container; `apps`
      profile for the two services once package code exists)
- [x] Root workspace config: `package.json` / `bunfig.toml` / `tsconfig*.json` / `biome.json`
- [ ] `packages/agent-backend` — copy from the submodule, then optimize
- [ ] `packages/agent-frontend` — copy from the submodule, then optimize
- [ ] `openapi/agent/` contract + per-package orval regeneration
- [ ] Strip/decide CRM-facing seams (see "Optimization targets" below)

Development happens **inside the devcontainer** ("Reopen in Container"). The image carries
Bun AND real Node 22 — flue requires real Node ≥ 22.19 and refuses to run under Bun.

---

## Architecture

Two runtimes, fixed ports, plus an external MCP server:

- **agent-backend (:41080)** — flue is scoped to the agent runtime only: `'use agent'` hook
  functions (`useModel`, `useTool`, `useSkill`, `useAgentStart`, `usePersistentState`,
  `useResponseStart`), the ReAct loop served at `POST /agents/:name/:id` via explicit
  `createAgentRouter` mounts in `src/app.ts`. Everything else lives AROUND flue: the MCP
  client, the `dataKey` result cache, authed proxy endpoints (`/mcp/*`), app-session auth
  (`POST /session`, HMAC bearer), the ambient-agent catalog/runner, projects, and the
  contract-served AI jobs (`POST /workflows/<name>`). That seam is deliberate — flue could
  be swapped without touching the rest.
- **agent-frontend (:41173)** — React Router framework mode (SPA, `ssr: false`) + Tailwind +
  shadcn/ui. Routes: `/` (chat), `/fellows`, `/projects`, `/agents`, `/organization`.
  `sandbox_proxy.html` is a standalone mini Vite build (`sandbox/` → `public/`, built by
  `vite.sandbox.config.ts`), served same-origin at `/sandbox_proxy.html`.

### Key backend layout (as extracted)

```
packages/agent-backend/src/
  agents/
    chat/<name>/      # chat agents: agent.ts + instructions.md; index.ts = import.meta.glob catalog
    ambient/<name>/   # ambient agents (fire via Run now / events, read-only run log over HTTP)
    ambient/index.ts  # directory-derived catalog + runner (dispatch()); one of TWO @flue/runtime seams
    project-member-instructions.md  # shared paragraph appended by every agent
  project-agents.ts   # project-member dispatcher — the other @flue/runtime seam
  workflow-prompt.ts  # promptForResult() + the private, NEVER-mounted StructuredWorker agent
  workflows/          # AI jobs: run(input) modules, served via generated contract routes
  tools/factory.ts    # THE source of MCP-derived flue tools (ensureCatalog + createMcpToolsSync)
  tools/delegate.ts   # delegate_to_agent — the ONE hand-defined non-MCP tool (assistant only)
  mcp-client/         # MCP SDK client (holds the credential) + dataKey cache
  middlewares/index.ts # whole pipeline; app session is the DEFAULT auth (deny by default)
  models/             # Prisma model layer, one file per table (NOT src/db.ts)
  db.ts               # flue's RESERVED persistence-adapter slot (default sqlite export) — not a model
  handlers/ routes.ts # orval-generated REST boundary (hand-owned *.handlers.ts)
  app.ts              # composition root + route map (mounts derived from the two agent catalogs)
```

Conventions that MUST survive the extraction: directory name === agentName; prompt prose
lives in `instructions.md`, never TypeScript strings; the two directory catalogs are the
only agent registry (no spanning catalog module); an agent outside `chat/`/`ambient/` has
no HTTP surface (how `StructuredWorker` stays private).

---

## The Method-C Tool-Wrapper Contract (load-bearing)

flue's MCP integration flattens tool results to a string and never reads `_meta`, so a
structured `CallToolResult` + `ui://` reference cannot transit flue's tool-output channel.
The backend therefore wraps UI tools itself:

1. `tools/factory.ts` generates ALL MCP-derived tool defs from `tools/list` introspection —
   never hand-written per tool.
2. Tool without `_meta["ui/resourceUri"]`: run via the backend MCP client, return
   `{ output: { summary } }`.
3. Tool WITH it: run the MCP tool **exactly once**, cache the structured `CallToolResult`
   under a fresh `dataKey`, and return `{ output: { summary, _ui: { resourceUri, dataKey } } }`.

Read path (frontend): the `_ui` envelope arrives at **`part.output._ui`** on a
`dynamic-tool` part. `AppRenderer` fetches the template via `POST /mcp/resources-read` and
the structured result via `GET /mcp/tool-result?dataKey=...` — **the MCP tool is NOT
re-executed on the read path**, and the MCP credential never leaves the server. Cache:
sliding 30-min TTL, LRU 1000, owner-scoped (`project-`/`ambient-`-prefixed synthetic
subjects are shared-read; real sessions strictly owner-only).

The `_ui` envelope shape is a cross-package contract — never change it unilaterally.

---

## flue Version Caveats

- **Pin `flue`/`@flue/*` to exactly `2.0.1`** (and `@modelcontextprotocol/sdk` to `1.30.0`).
  Do not bump without re-verifying, in this order: (1) `formatMcpResult` still flattens
  (method C still required), (2) `_ui` still at `part.output._ui`, (3) the runtime still
  unwraps what `run()` returns.
- **A flue tool's `run()` MUST return `{ output, terminate? }`** — a bare object throws at
  runtime (bare `string` is shorthand; `void` allowed with no output schema). Do not adopt
  `terminate` in the method-C wrapper.
- **Build is `@flue/vite` + plain `vite dev`/`vite build`** — there is no `flue` CLI.
  Requires real Node ≥ 22.19; never run flue under Bun (`bun run dev` is fine — the vite
  binary resolves to real node).
- **`@flue/sdk` `send()` takes `{ message: { kind: "user", body } }`** — bare strings 400.
- **`sendMessage()` resolves on prompt admission**, not generation completion — track
  progress via `status`.
- **Dispatched submissions settle on v2 for at least one verified shape**; whether every
  shape (provider failure included) settles is unverified — keep derived-outcome fallbacks
  in run-log UIs.
- **v2 attaches no implicit sandbox**; the never-use-bash hard rules in agent prompts are
  defense in depth.
- **Env:** the dev stack reads exactly ONE env file, `packages/agent-backend/.env`
  (a repo-root `.env` is read by NOTHING — Bun loads per-cwd). The `google` provider reads
  `GEMINI_API_KEY` only.

---

## Build / Run

Inside the devcontainer:

```sh
bun install            # workspace install
bun --filter '*' dev   # start both processes (once packages exist)
bun run typecheck      # all packages
bun run biome          # lint + format check
bun run generate       # orval codegen after editing openapi/agent/
```

Or from the host: `docker compose --profile apps up`.

Dev caveats: `vite dev` hot reload drops live SSE connections and can wedge the flue
runtime (closed SQLite handle / drain timeout) — restart the stack rather than debugging
app code first. Treat `bun run generate` as a stack-restarting operation.

---

## Conventions

- **Validation:** valibot in hand-written code; zod ONLY in orval-generated REST boundary
  code. Never introduce zod by hand.
- **Codegen:** orval 8.19.0, per-package `orval.config.ts`, each with
  `output.tsconfig: "../../tsconfig.base.json"` pinned (do not remove — prevents `.ts`
  import-extension drift). Generated files are committed. AI-job input/result shapes live
  ONLY in the OpenAPI contract — never re-declare them in TypeScript (the response
  validator silently strips undeclared keys).
- **Lint/format:** Biome; `biome.json` overrides suppress rules only for generated paths.
- **Skills:** `prompts/skills/<name>/SKILL.md`, bare static import, registered via
  `useSkill()`; allow-list `activate_skill` alongside domain tools.
- **English** for code, docs, and commit messages. Commits are fine-grained, committed
  directly to `main`.

## Optimization targets (extraction TODO)

The extracted code still contains CRM-facing seams from the spike that this repo must
either strip or generalize: the `/channels/crm` flue channel + `requireInternalSecret`,
CRM-tool allow-lists in agent instructions, CRM URLs in frontend nav/config, and the
`workflows/` jobs that materialize CRM data. Decide per piece during optimization — do not
delete blindly; the ambient-agent event mechanism itself (channel → `fireCrmEvent` →
`dispatch()`) is the generic seam worth keeping.

## Do NOT

- Put MCP credentials, provider API keys, `APP_SESSION_SECRET`, or any server-side secret
  anywhere a browser can reach (response, bundle, `VITE_*` var).
- Hand-write MCP-derived flue tool definitions (factory only; `delegate_to_agent` is the
  sole hand-defined tool). Never wire `delegate_to_agent` into an ambient agent.
- Let the frontend hold or instantiate an MCP client.
- Re-execute MCP tools on the read path — a missing `dataKey` is a 404, never a re-fetch.
- Read `_ui` anywhere but `part.output._ui`.
- Bump `flue` off `2.0.1` without a reviewed re-verification.
- Return a bare value from a flue tool's `run()` — wrap it in `{ output: ... }`.
- Add an agent anywhere other than one directory under `src/agents/{chat,ambient}/<name>/`
  (agent.ts + instructions.md, directory name === agentName), or reintroduce a hand-written
  agent catalog / shared agent-hook module.
- Import `@flue/runtime` from any non-agent module other than the two seams
  (`src/agents/ambient/index.ts`, `src/project-agents.ts`). Never mount `StructuredWorker`.
- `POST` into an ambient agent's read-only `/agents/<name>/log` run log.
- Use `src/db.ts` for hand-written models — it is flue's reserved persistence-adapter slot.
