/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.spec.ts", "src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // `host: false` resolves Node's "localhost" bind target however the OS
    // orders it — on this Windows machine that came out IPv6-only ([::1]),
    // which is unreachable from a browser resolving localhost to 127.0.0.1
    // first (confirmed: curl to 127.0.0.1:1420 refused, [::1]:1420 worked).
    // Bind IPv4 loopback explicitly so plain browser `npm run dev` is
    // actually reachable; TAURI_DEV_HOST (mobile/remote Tauri dev) still
    // takes priority when set, unchanged from before.
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and the sibling Rust
      // backend crate's build output — `backend/target/**` churns
      // constantly during `cargo build`/`cargo test` and its .exe/.pdb
      // files get replaced while locked, which throws an EBUSY error out
      // of Vite's fs watcher and kills the whole `tauri dev` process.
      ignored: ["**/src-tauri/**", "**/backend/**"],
    },
  },
}));
