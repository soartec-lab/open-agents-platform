# Plan: Orchestrator relay (sequential hand-offs)

Status: **planned** (recorded 2026-08-18, not scheduled). Origin: demo prep — the
flow everyone expects from a multi-agent channel is *orchestrator → member A →
A's result carried to member B*, and v1 cannot do it autonomously.

## Problem

Member conversations are isolated; the shared timeline is a frontend merge.
The orchestrator receives only user posts — it never sees a member's reply, so
a delegation chain cannot continue without the user manually relaying content
(see the demo workaround: the user pastes a member's findings back into an
unmentioned post).

This is the v1 known limit recorded in AGENTS.md ("Members … cannot talk to
each other directly"). The relay is the smallest mechanism that turns a
channel from parallel fan-out into an actual working chain.

## Design sketch

Add a **turn-completion watcher** to the dispatch seam (`src/channel-agents.ts`):

1. `dispatchChannelMember(..., { delegatedBy: "orchestrator", hop })` starts a
   watcher after admission.
2. The watcher polls the member's conversation read-only (the same
   `?view=history` JSON the frontend observes — self-HTTP with an internally
   issued session token, or in-process `app.request()`), until the dispatched
   submission settles or a timeout (~2 min) passes.
3. On settlement it dispatches the ORCHESTRATOR with a new input shape:
   `{ trigger: "channel", memberReport: { member, text }, hop: hop + 1, ... }`.
4. The orchestrator's instructions gain a report-handling section: on a
   `memberReport`, either delegate ONCE more (with the relevant report content
   folded into the instruction — the member cannot see the timeline) or post a
   1–2 sentence wrap-up. Never re-delegate the same work.
5. **Loop bound**: the watcher only relays while `hop < MAX_HOPS` (e.g. 3).
   A chain beyond the cap simply stops being relayed; cost per user post stays
   bounded at ~(MAX_HOPS orchestrator turns + MAX_HOPS member turns).

Frontend: `parseChannelDispatch` learns the `memberReport` shape — those rows
are HIDDEN in the timeline (the member's reply is already rendered from its
own conversation); the orchestrator's follow-up delegation renders as usual.

## Open questions

- How to detect settlement reliably: match the settlement's `submissionId` if
  `dispatch()` returns it; otherwise watch for a new settled assistant turn
  after the dispatch offset.
- Should the report text be truncated/sanitized before entering the
  orchestrator prompt (it is agent output, but derived from user-written
  instructions)? Lean yes: same cap discipline as roster briefs.
- Whether a member's reply should also be relayable when the USER (not the
  orchestrator) dispatched it directly (@mention / 1:1). Lean no for the first
  cut: relay only orchestrator-initiated hand-offs.

## Non-goals

- Members talking to each other directly (no member tools — unchanged).
- Automatic rounds / scheduling (the spike's round machinery stays out).
