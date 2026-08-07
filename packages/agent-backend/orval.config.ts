/**
 * orval config for packages/agent-backend.
 *
 * Generates Hono route validators and handler scaffolding from the agent REST
 * contract. The flue conversation endpoint (GET /agents/:name/:id) is NOT
 * covered here — it is served by flue's own agent routers.
 *
 * Run from repo root: bun run generate (fans out via bun --filter), or
 * `bun run generate` inside this package. Paths are relative to this config
 * file's directory (packages/agent-backend/).
 */
import { defineConfig } from "orval";

export default defineConfig({
  api: {
    input: { target: "../../openapi/agent/openapi.yaml" },
    output: {
      client: "hono",
      mode: "tags-split",
      // Keep the handlers and their per-tag context/zod together under
      // src/handlers/<tag>/, with schemas + validator alongside.
      target: "./src/handlers",
      schemas: "./src/handlers/schemas",
      formatter: "biome",
      // Pin to the shared base tsconfig so generated import extensions stay
      // consistent regardless of per-package allowImportingTsExtensions.
      tsconfig: "../../tsconfig.base.json",
      override: {
        hono: {
          // The composed, mountable Hono app.
          compositeRoute: "./src/routes.ts",
          // Explicit path so the validator lands with the handlers (a bare-dir
          // target otherwise leaves orval unable to derive its filename).
          validatorOutputPath: "./src/handlers/validator.ts",
          // Per-tag handler files are scaffolded ONCE then owned by hand —
          // 'skip' guarantees regeneration never overwrites an existing handler.
          handlerGenerationStrategy: "skip",
        },
      },
    },
  },
});
