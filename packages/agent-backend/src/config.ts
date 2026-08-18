/**
 * Backend runtime configuration, resolved from environment.
 *
 * The app-session secret and the provider API key are SERVER-SIDE ONLY. They
 * are read here (or by flue's provider layer) and never serialized into any
 * response the browser can observe.
 */

function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    return "";
  }
  return value;
}

/**
 * HMAC secret used to sign app-session tokens. Backend-only.
 * A fixed dev default keeps the stack runnable without external config;
 * override in any shared/persistent environment.
 */
export const APP_SESSION_SECRET = env(
  "APP_SESSION_SECRET",
  "dev-only-insecure-app-session-secret-change-me",
);

/** App-session token lifetime in seconds (default 12h). */
export const APP_SESSION_TTL_SECONDS = Number(env("APP_SESSION_TTL_SECONDS", "43200"));

/** Browser origin allowed to call the backend with credentials (CORS). */
export const FRONTEND_ORIGIN = env("FRONTEND_ORIGIN", "http://localhost:42173");

/**
 * The model every agent runs on, as `provider/model-id`. flue resolves the
 * provider key from the provider id (`anthropic` reads ANTHROPIC_API_KEY).
 */
export const DEFAULT_AGENT_MODEL = env("AGENT_MODEL", "anthropic/claude-sonnet-4-6");

/** Whether an ANTHROPIC_API_KEY is present (live LLM turns possible). */
export const HAS_ANTHROPIC_KEY = env("ANTHROPIC_API_KEY") !== "";

/**
 * Max member reports relayed back to a channel's orchestrator per user post.
 * Bounds the cost of an autonomous hand-off chain: one post can trigger at
 * most this many orchestrator report-turns (and as many member turns).
 */
export const MAX_RELAY_COUNT = Number(env("MAX_RELAY_COUNT", "3"));

/**
 * How long the relay dispatcher waits for a delegated member run to finish
 * before giving up on relaying it (the member keeps running; only the
 * automated report is dropped).
 */
export const RELAY_TIMEOUT_MS = Number(env("RELAY_TIMEOUT_MS", "120000"));
