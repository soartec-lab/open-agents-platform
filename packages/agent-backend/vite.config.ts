import { flue } from "@flue/vite";
import { defineConfig } from "vite";

// Flue v2 is a Vite plugin: `vite dev` / `vite build` own the application
// (there is no `flue` CLI). The Node target emits dist/server.mjs, started
// with `node dist/server.mjs`.
export default defineConfig({
  plugins: [flue()],
  server: {
    port: 41080,
  },
  ssr: {
    // @prisma/client resolves its query engine and schema relative to the
    // generated client in node_modules — it must never be bundled. Vite's SSR
    // default usually externalizes node_modules too, but Prisma is
    // load-bearing enough to pin explicitly.
    external: ["@prisma/client"],
  },
});
