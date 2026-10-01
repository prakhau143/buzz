/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/**
 * Phase 3 live-relay E2E only (`tests/integration/*.e2e.spec.ts`) — needs an
 * actually-running local buzz-relay and makes real network calls, so it is
 * deliberately separate from `vite.config.ts`'s default test run (which must
 * work offline/in CI). Run with:
 *
 *   npx vitest run --config vitest.e2e.config.ts
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // "node", not jsdom: jsdom's WebSocket/undici dual-realm Event handling
    // breaks on real socket traffic. Needs a WebSocket global supplied via
    // NODE_OPTIONS --require (see the file header) since Node 20 has none.
    environment: "node",
    globals: true,
    include: ["tests/**/*.e2e.spec.ts"],
    // Filters one known nostr-tools re-throw that turns an expected AUTH
    // refusal into an unhandled rejection — see the file's header for why this
    // is not a swallow. Any other unhandled rejection still fails the run.
    setupFiles: ["tests/integration/setup.e2e.ts"],
    testTimeout: 30_000,
  },
});
