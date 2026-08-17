/**
 * Custom fetch for the orval-generated client (wired via `override.mutator`
 * in orval.config.ts) — hand-written, never touched by regeneration.
 *
 * Owns the REST auth concern end to end: root.tsx deposits the app-session
 * token here after bootstrap (`setSessionToken`), and every generated call
 * sends it as the Authorization bearer — no call site passes headers, no
 * component threads the token around. The flue conversation clients (SSE)
 * are separate: they carry the token inside the factory root.tsx builds.
 *
 * The return shape mirrors what the generated code declares per operation
 * ({ data, status, headers } unions) — orval's documented custom-fetch
 * contract.
 */

let sessionToken: string | null = null;

/** Deposit (or clear) the app-session token every generated call sends. */
export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

async function bodyOf(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function customFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (sessionToken !== null && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${sessionToken}`);
  }
  const response = await fetch(url, { ...options, headers });
  const data = await bodyOf(response);
  return { data, status: response.status, headers: response.headers } as T;
}

export default customFetch;
