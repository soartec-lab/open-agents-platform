/**
 * Runtime configuration for the frontend.
 *
 * Points to the backend. Override via VITE_BACKEND_URL when deploying to a
 * non-localhost environment.
 *
 * NOTE: Only VITE_* prefixed variables are exposed to the browser bundle.
 * Never put ANTHROPIC_API_KEY or any server-side secret here.
 *
 * This is used ONLY for the flue conversation URLs (SSE observation) — the
 * generated REST client bakes its base URL in from the OpenAPI contract's
 * `servers` entry instead.
 */

export const BACKEND_URL: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://localhost:42080";
