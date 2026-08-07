/**
 * Authorization header for the generated REST client. Every call site passes
 * auth explicitly (`{ fetch: { headers: bearer(token) } }`) — there is no
 * fetch interceptor and no auth context provider.
 */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
