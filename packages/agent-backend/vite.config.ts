import { flue } from "@flue/vite";
import { defineConfig } from "vite";

// Flue v2 is a Vite plugin: `vite dev` / `vite build` own the application
// (there is no `flue` CLI). The Node target emits dist/server.mjs, started
// with `node dist/server.mjs`.
export default defineConfig({
  plugins: [flue()],
  server: {
    port: 42080,
    // Listen on all interfaces: the workspace container PUBLISHES this port
    // (compose.yml), and a docker port mapping targets the container's
    // external interface — a localhost-only bind is unreachable from the
    // host browser. (The frontend's config already does the same.)
    host: true,
  },
  ssr: {
    // @prisma/client resolves its query engine and schema relative to the
    // generated client in node_modules — it must never be bundled. Vite's SSR
    // default usually externalizes node_modules too, but Prisma is
    // load-bearing enough to pin explicitly.
    external: ["@prisma/client"],
  },
});
