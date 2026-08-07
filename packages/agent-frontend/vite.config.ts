import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Package root (this config file's directory).
const pkgRoot = fileURLToPath(new URL(".", import.meta.url));

// Channel frontend dev server on 41173 (React Router framework mode, SPA —
// see react-router.config.ts).
export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    // Mirrors the `~/*` tsconfig path so shadcn-generated imports resolve.
    alias: { "~": resolve(pkgRoot, "app") },
  },
  server: {
    port: 41173,
    host: true,
    // The devcontainer's inotify events are unreliable (edits were observed to
    // NOT invalidate Vite's transform cache, serving stale modules until a
    // manual restart). Polling trades a little CPU for dependable hot reload.
    watch: { usePolling: true, interval: 300 },
  },
});
