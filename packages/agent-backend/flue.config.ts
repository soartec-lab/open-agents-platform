import { defineConfig } from "@flue/runtime/config";

// Host-independent project config for Flue v2 (the Vite plugin reads it).
// Target is declared here so the plugin need not infer it; build/dev
// themselves are plain `vite build` / `vite dev` (see vite.config.ts).
export default defineConfig({
  target: "node",
});
