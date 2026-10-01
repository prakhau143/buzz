import { ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";

/**
 * The running app's version: Tauri's `getVersion()` (from tauri.conf.json) in
 * the desktop app, the build-time package.json version in a browser build.
 */
declare const __APP_VERSION__: string | undefined;

const buildVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
export const appVersion = ref<string>(buildVersion);

let loaded = false;
export async function loadAppVersion(): Promise<string> {
  if (!loaded) {
    loaded = true;
    if (isTauri()) {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        appVersion.value = await getVersion();
      } catch {
        // Keep the build version.
      }
    }
  }
  return appVersion.value;
}
