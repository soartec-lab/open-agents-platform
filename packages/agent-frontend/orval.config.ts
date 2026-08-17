/**
 * orval config for packages/agent-frontend.
 *
 * Generates SWR hooks (useSWR for GETs, useSWRMutation for writes) plus the
 * underlying typed fetch functions from the agent REST contract.
 * The flue conversation endpoint (GET /agents/:name/:id, read-only SSE
 * observation) is NOT covered here — it stays on @flue/sdk.
 *
 * Run from repo root: bun run generate
 * Paths are relative to this config file's directory (packages/agent-frontend/).
 */
import { defineConfig } from "orval";

export default defineConfig({
  api: {
    input: { target: "../../openapi/agent/openapi.yaml" },
    output: {
      client: "swr",
      mode: "tags-split", // one directory per tag (meta / session / agent-configs / channels)
      target: "./app/api/api.ts",
      schemas: "./app/api/schemas",
      formatter: "biome",
      // Pin to the shared base tsconfig so generated import extensions stay
      // consistent regardless of per-package allowImportingTsExtensions.
      tsconfig: "../../tsconfig.base.json",
      // Base URL comes from the spec's `servers` entry (http://localhost:41080)
      // so the canonical port lives only in the OpenAPI contract.
      baseUrl: { getBaseUrlFromSpecification: true },
      override: {
        // All generated calls go through the hand-written fetcher, which owns
        // the Authorization header (root.tsx deposits the session token there)
        // — call sites never pass auth explicitly.
        mutator: {
          path: "./app/api/fetcher.ts",
          name: "customFetch",
        },
      },
    },
  },
});
