/**
 * Root route (React Router framework mode, SPA).
 *
 * Owns everything the routes share: the app-session bootstrap (POST /session
 * → token + sessionId, silent — sessions are auth plumbing here, not a UI
 * concept; channels are the unit of conversation) and the conversation-client
 * factory (flue's SDK is conversation-scoped — one FlueClient per
 * conversation URL, so the app hands routes a memoizing factory instead of
 * one deployment-wide client). Routes receive both through the router's
 * outlet context (`useOutletContext<AppOutletContext>()`), and the sidebar —
 * channels list + agents nav — renders here so every route shares it.
 */

import { createFlueClient, type FlueClient } from "@flue/sdk";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { setSessionToken } from "./api/fetcher.ts";
import { createSession } from "./api/session/session.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { BACKEND_URL } from "./config.ts";

import "./app.css";

/**
 * Resolves the memoized conversation client for one flue conversation —
 * `${BACKEND_URL}/agents/<agentName>/<instanceId>` under the current session
 * token. Stable identity per (agentName, instanceId) for the lifetime of a
 * session, so hooks can key effects on the returned client. (REST calls are
 * separate: the generated client authenticates itself via api/fetcher.ts.)
 */
export type ConversationClientFactory = (agentName: string, instanceId: string) => FlueClient;

/**
 * localStorage key holding the app-session id. Persisting the id (never the
 * short-lived token) lets a reload resume the SAME session subject silently.
 */
const SESSION_ID_STORAGE_KEY = "open-agents-platform.session-id";

/** Shared state the routes receive via useOutletContext. */
export interface AppOutletContext {
  conversationFor: ConversationClientFactory;
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Open Agents Platform</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback() {
  return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      <p>Loading…</p>
    </div>
  );
}

export default function App() {
  const [sessionData, setSessionData] = useState<{ token: string; sessionId: string } | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const bootstrapSession = useCallback((resumeId: string | null) => {
    // Bootstrap an app-session (POST /session) via the generated client.
    // Passing a known sessionId makes the backend re-issue a token for the
    // same session subject; only the short-lived token is minted fresh (and
    // never stored). `null` starts a brand-new session.
    createSession(resumeId ? { sessionId: resumeId } : {})
      .then((res) => {
        if (res.status !== 200) {
          throw new Error(`Session bootstrap failed: ${res.status}`);
        }
        const id = res.data.sessionId;
        localStorage.setItem(SESSION_ID_STORAGE_KEY, id);
        // The REST layer authenticates itself from here on (api/fetcher.ts);
        // deposit the token BEFORE anything rendering generated hooks mounts.
        setSessionToken(res.data.token);
        setSessionData({ token: res.data.token, sessionId: id });
      })
      .catch((err: unknown) => {
        setBootstrapError(err instanceof Error ? err.message : "Session bootstrap failed");
      });
  }, []);

  // Guarded ref: React StrictMode double-runs mount effects in dev — without
  // the guard, a first-ever visit would mint two fresh sessions.
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    bootstrapSession(localStorage.getItem(SESSION_ID_STORAGE_KEY));
  }, [bootstrapSession]);

  // The SDK client addresses ONE conversation by URL. The factory hands out
  // one memoized client per (agent, instance) so consumers get stable
  // identities to key effects on; the cache lives inside the memo, so a
  // re-bootstrap (new token) rebuilds every client.
  const [conversationFor, setConversationFor] = useState<ConversationClientFactory | null>(null);
  useEffect(() => {
    if (!sessionData) {
      setConversationFor(null);
      return;
    }
    const cache = new Map<string, FlueClient>();
    setConversationFor(() => (agentName: string, instanceId: string) => {
      const key = `${agentName}:${instanceId}`;
      let conversation = cache.get(key);
      if (!conversation) {
        conversation = createFlueClient({
          url: `${BACKEND_URL}/agents/${agentName}/${instanceId}`,
          token: sessionData.token,
        });
        cache.set(key, conversation);
      }
      return conversation;
    });
  }, [sessionData]);

  if (bootstrapError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 p-8">
        <p className="text-destructive">Failed to connect to backend: {bootstrapError}</p>
        <p className="text-muted-foreground text-sm">
          Make sure the backend is running on port 41080.
        </p>
      </div>
    );
  }

  if (!sessionData || !conversationFor) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <p>Connecting…</p>
      </div>
    );
  }

  const context: AppOutletContext = { conversationFor };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="min-h-0 min-w-0 flex-1">
        <Outlet context={context} />
      </div>
    </div>
  );
}
