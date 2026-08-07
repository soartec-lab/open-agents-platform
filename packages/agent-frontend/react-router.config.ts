import type { Config } from "@react-router/dev/config";

// SPA mode (ADR 0008): no runtime server rendering. `react-router build`
// prerenders the root shell into build/client/index.html; everything else is
// client-side. The dev server still runs through Vite (see vite.config.ts).
export default {
  ssr: false,
} satisfies Config;
