import { isTauri, invoke, Channel } from "@tauri-apps/api/core";

/**
 * Settings → Updates, backed by src-tauri/src/updater.rs. SWF's own feed and
 * signing key are compiled into the desktop build; when they are absent the
 * build says so (`configured: false`) and nothing is checked.
 */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export type DownloadEvent =
  | { event: "started"; data: { contentLength: number | null } }
  | { event: "progress"; data: { chunkLength: number } }
  | { event: "finished" };

const LAST_CHECKED_KEY = "swf-buzz:updates.last-checked";

export async function updatesConfigured(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("updater_configured");
  } catch {
    return false;
  }
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const result = await invoke<UpdateInfo | null>("updater_check");
  try {
    localStorage.setItem(LAST_CHECKED_KEY, String(Date.now()));
  } catch {
    // not critical
  }
  return result;
}

/** Download, verify (the plugin checks the signature), install, restart. */
export async function installUpdate(onProgress: (downloaded: number, total: number | null) => void): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = (message) => {
    if (message.event === "started") total = message.data.contentLength;
    else if (message.event === "progress") downloaded += message.data.chunkLength;
    onProgress(downloaded, total);
  };
  await invoke("updater_install", { onEvent: channel });
}

export function lastChecked(): Date | null {
  try {
    const raw = localStorage.getItem(LAST_CHECKED_KEY);
    return raw ? new Date(Number(raw)) : null;
  } catch {
    return null;
  }
}
