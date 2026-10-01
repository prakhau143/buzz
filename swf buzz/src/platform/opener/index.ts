/**
 * Open a web link outside SWF Buzz — the ONE place that knows how.
 * docs/PHASE_H_MESSAGE_ACTIONS_RICH_LINKS.md §External opener.
 *
 *  - Desktop (Tauri): the opener plugin already registered on the Rust side
 *    (`tauri-plugin-opener`, granted by `opener:default`) hands the URL to the
 *    OS, which opens the user's DEFAULT browser — no browser is hard-coded.
 *    Called through `invoke` so no extra JS package is needed; this is the
 *    exact command `@tauri-apps/plugin-opener`'s `openUrl` sends.
 *  - Web: a new tab with `noopener,noreferrer`, so the page gets no handle
 *    back into SWF and no referrer.
 *
 * Every URL is re-validated here (http/https only) whatever the caller did, and
 * a repeat of the same URL within `DEDUP_MS` is dropped: a double-click is two
 * clicks, and must launch the browser once.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { normalizeExternalUrl } from "@/features/links/urlModel";
import { logError } from "@/services/errors";

export const DEDUP_MS = 600;

let last: { href: string; at: number } | null = null;

export type OpenResult = "opened" | "duplicate" | "rejected" | "failed";

export async function openExternalUrl(raw: string, now: number = Date.now()): Promise<OpenResult> {
  const href = normalizeExternalUrl(raw);
  if (!href) return "rejected";
  if (last && last.href === href && now - last.at < DEDUP_MS) return "duplicate";
  last = { href, at: now };
  try {
    if (isTauri()) {
      await invoke("plugin:opener|open_url", { url: href });
    } else {
      window.open(href, "_blank", "noopener,noreferrer");
    }
    return "opened";
  } catch (err) {
    // The URL is not logged: links can carry tokens in their query string.
    logError("openExternalUrl", err);
    return "failed";
  }
}

/** Tests only. */
export function resetOpenerDedup(): void {
  last = null;
}
