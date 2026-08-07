/**
 * Hand-owned handlers for the `meta` tag. Scaffolded once by orval
 * (`handlerGenerationStrategy: "skip"`) and never overwritten; the sibling
 * `.context.ts` / `.zod.ts` files are regenerated.
 */
import { createFactory } from "hono/factory";
import { HAS_ANTHROPIC_KEY } from "../../config.ts";
import { zValidator } from "../validator";
import type { GetHealthContext } from "./meta.context";
import { GetHealthResponse } from "./meta.zod";

const factory = createFactory();
export const getHealthHandlers = factory.createHandlers(
  zValidator("response", GetHealthResponse),
  async (c: GetHealthContext) => {
    // Liveness. `liveLlm` reports whether a live LLM key is configured (the
    // agents admit prompts regardless; generation needs the key).
    return c.json({ ok: true, service: "agent-backend", liveLlm: HAS_ANTHROPIC_KEY });
  },
);
