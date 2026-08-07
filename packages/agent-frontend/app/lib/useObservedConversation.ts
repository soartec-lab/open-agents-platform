/**
 * useObservedConversation — live, READ-ONLY view of one flue conversation via
 * the conversation client's `observe()` (SSE). This is the ONLY read path of
 * the channel room: every agent conversation is read-only over HTTP (writes
 * go through POST /channels/:id/messages), so the write surface must not
 * exist here — observe() has none.
 *
 * The SDK is conversation-scoped, so both hooks take the app's
 * conversation-client factory (root.tsx) and resolve one client per target;
 * the factory memoizes per (agent, instance), so effect identities stay
 * stable.
 *
 * Effect-based rather than useMemo + useSyncExternalStore: StrictMode
 * double-runs mount effects in dev, and a memoized observation would be closed
 * by the first cleanup and never reopened. Each (factory, name, id) change
 * tears the observation down and opens a fresh one.
 *
 * `absent` re-probing: an observation opened before the conversation exists
 * settles at phase "absent" and does NOT self-attach when a dispatch later
 * creates the conversation — without a re-probe, a member's first run would
 * stay invisible in an already-open room. Both hooks therefore refresh() any
 * still-absent observation every ABSENT_REPROBE_MS (a cheap probe that 404s
 * until the conversation exists, then attaches live).
 */

import type {
  AgentConversationObservation,
  AgentConversationObservationSnapshot,
  FlueClient,
} from "@flue/sdk";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The app's conversation-client factory: one memoized, conversation-scoped
 * FlueClient per (agentName, instanceId). Built by root.tsx (it owns the
 * session token the clients carry); declared here so the lib layer does not
 * import from the route tree.
 */
export type ConversationClientFactory = (agentName: string, instanceId: string) => FlueClient;

const ABSENT_REPROBE_MS = 10_000;

export function useObservedConversation(
  conversationFor: ConversationClientFactory,
  name: string,
  id: string,
) {
  const [snapshot, setSnapshot] = useState<AgentConversationObservationSnapshot | null>(null);
  const observationRef = useRef<AgentConversationObservation | null>(null);

  useEffect(() => {
    const observation = conversationFor(name, id).observe({ live: "sse" });
    observationRef.current = observation;
    setSnapshot(observation.getSnapshot());
    const unsubscribe = observation.subscribe(() => setSnapshot(observation.getSnapshot()));
    const reprobe = setInterval(() => {
      if (observation.getSnapshot().phase === "absent") observation.refresh();
    }, ABSENT_REPROBE_MS);
    return () => {
      clearInterval(reprobe);
      unsubscribe();
      observation.close();
      observationRef.current = null;
    };
  }, [conversationFor, name, id]);

  // Re-probe the conversation — used after posting into an `absent` channel
  // (the conversation 404s until the first dispatch materializes it).
  const refresh = useCallback(() => observationRef.current?.refresh(), []);

  return { snapshot, refresh };
}

/** One conversation to observe: a flue agent name + instance id. */
export interface ObservationTarget {
  name: string;
  id: string;
}

/** Snapshot-map key for a target — agent names cannot contain ":" (flue). */
export const observationKey = (target: ObservationTarget) => `${target.name}:${target.id}`;

/**
 * Plural variant for merged rooms (a channel's member conversations + the
 * orchestrator's): one live observation per (agent, instance) target, merged
 * by the caller. Same effect-based lifecycle as above; the target list is
 * keyed by value (join) so re-renders with an equal list do not tear the
 * streams down. N targets = N SSE connections while the room is open — fine
 * for a handful (browsers allow 6 per host on HTTP/1.1).
 */
export function useObservedConversations(
  conversationFor: ConversationClientFactory,
  targets: readonly ObservationTarget[],
) {
  const [snapshots, setSnapshots] = useState<Record<string, AgentConversationObservationSnapshot>>(
    {},
  );
  const observationsRef = useRef<Map<string, AgentConversationObservation>>(new Map());
  const targetsKey = targets.map(observationKey).join(",");

  useEffect(() => {
    const observations = new Map<string, AgentConversationObservation>();
    for (const key of targetsKey.split(",").filter(Boolean)) {
      const at = key.indexOf(":");
      const observation = conversationFor(key.slice(0, at), key.slice(at + 1)).observe({
        live: "sse",
      });
      observations.set(key, observation);
      const update = () => setSnapshots((prev) => ({ ...prev, [key]: observation.getSnapshot() }));
      observation.subscribe(update);
      update();
    }
    observationsRef.current = observations;
    const reprobe = setInterval(() => {
      for (const observation of observations.values()) {
        if (observation.getSnapshot().phase === "absent") observation.refresh();
      }
    }, ABSENT_REPROBE_MS);
    return () => {
      clearInterval(reprobe);
      for (const observation of observations.values()) observation.close();
      observationsRef.current = new Map();
      setSnapshots({});
    };
  }, [conversationFor, targetsKey]);

  const refresh = useCallback(
    (target: ObservationTarget) => observationsRef.current.get(observationKey(target))?.refresh(),
    [],
  );

  return { snapshots, refresh };
}
