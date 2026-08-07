/**
 * Hand-owned handlers for the `session` tag. Scaffolded once by orval
 * (`handlerGenerationStrategy: "skip"`) and never overwritten; the sibling
 * `.context.ts` / `.zod.ts` files are regenerated.
 */
import { createFactory } from "hono/factory";
import { issueSession } from "../../models/session.ts";
import { zValidator } from "../validator";
import type { CreateSessionContext } from "./session.context";
import { CreateSessionBody, CreateSessionResponse } from "./session.zod";

const factory = createFactory();
export const createSessionHandlers = factory.createHandlers(
  zValidator("json", CreateSessionBody),
  zValidator("response", CreateSessionResponse),
  async (c: CreateSessionContext) => {
    // Unauthenticated bootstrap: issue a signed app-session token. The body
    // is optional (all fields optional) — an absent body or `{}` yields a
    // fresh session id; a present-but-malformed JSON body is rejected with
    // 400 by the generated request validator.
    const { sessionId } = c.req.valid("json");
    const issued = issueSession(sessionId);
    return c.json({ ...issued, tokenType: "Bearer" as const });
  },
);
