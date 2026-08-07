/**
 * Hand-owned handlers for the `agent-configs` tag. Scaffolded once by orval
 * (`handlerGenerationStrategy: "skip"`) and never overwritten; the sibling
 * `.context.ts` / `.zod.ts` files are regenerated.
 *
 * A config is a user-created agent (name + instructions + optional role)
 * served by the single `custom` flue agent. Names are unique — they are the
 * labels the orchestrator's delegate tool and @mentions resolve against, so
 * a collision answers 409 (the model surfaces Prisma's unique violation as
 * the `"name_taken"` sentinel). The catalog is shared across sessions
 * (deferred ownership); the middleware pipeline gates access.
 */
import { createFactory } from "hono/factory";
import { AgentConfig } from "../../models/agent-config.ts";
import { zValidator } from "../validator";
import type {
  CreateAgentConfigContext,
  DeleteAgentConfigContext,
  GetAgentConfigsContext,
  UpdateAgentConfigContext,
} from "./agent-configs.context";
import {
  CreateAgentConfigBody,
  DeleteAgentConfigParams,
  GetAgentConfigsResponse,
  UpdateAgentConfigBody,
  UpdateAgentConfigParams,
  UpdateAgentConfigResponse,
} from "./agent-configs.zod";

const factory = createFactory();

// The REST contract expresses "no role" as an ABSENT field; the model uses
// null. Serialize through this mapping or the generated response validator
// rejects the row ("expected string, received null").
const toApi = (config: AgentConfig) => ({ ...config, role: config.role ?? undefined });

export const getAgentConfigsHandlers = factory.createHandlers(
  zValidator("response", GetAgentConfigsResponse),
  async (c: GetAgentConfigsContext) => {
    return c.json({ configs: (await AgentConfig.list()).map(toApi) });
  },
);

export const createAgentConfigHandlers = factory.createHandlers(
  zValidator("json", CreateAgentConfigBody),
  async (c: CreateAgentConfigContext) => {
    const created = await AgentConfig.create(c.req.valid("json"));
    if (created === "name_taken") {
      return c.json({ error: "Agent name is already taken" }, 409);
    }
    return c.json(toApi(created), 201);
  },
);

export const updateAgentConfigHandlers = factory.createHandlers(
  zValidator("param", UpdateAgentConfigParams),
  zValidator("json", UpdateAgentConfigBody),
  zValidator("response", UpdateAgentConfigResponse),
  async (c: UpdateAgentConfigContext) => {
    const { id } = c.req.valid("param");
    const updated = await AgentConfig.update(id, c.req.valid("json"));
    if (updated === "name_taken") {
      return c.json({ error: "Agent name is already taken" }, 409);
    }
    if (!updated) return c.json({ error: "Agent config not found" }, 404);
    return c.json(toApi(updated));
  },
);

export const deleteAgentConfigHandlers = factory.createHandlers(
  zValidator("param", DeleteAgentConfigParams),
  async (c: DeleteAgentConfigContext) => {
    const { id } = c.req.valid("param");
    if (!(await AgentConfig.remove(id))) {
      return c.json({ error: "Agent config not found" }, 404);
    }
    return c.body(null, 204);
  },
);
