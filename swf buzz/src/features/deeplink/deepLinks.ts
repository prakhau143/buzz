import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Router } from "vue-router";
import { logError } from "@/services/errors";
import { setPendingLink, type PendingLink } from "./pendingLink";

/**
 * `swfbuzz://` deep links, received from the Rust side
 * (`src-tauri/src/deeplink.rs`).
 *
 * Rust parses and validates the URL and queues the result. Two ways a link
 * reaches the UI, both covered here:
 *  - cold start: the app was launched *by* the link, before this code ran —
 *    the link is already waiting in the queue, so we drain it at startup;
 *  - warm start: the app is already running — Rust emits `swf-deep-link` and we
 *    drain again.
 * Draining is idempotent (the queue empties), so calling it twice is harmless.
 */
const EVENT = "swf-deep-link";

type RustLink = PendingLink;

/** Move every queued link into the app. Returns how many were handled. */
export async function drainDeepLinks(router: Router): Promise<number> {
  let links: RustLink[];
  try {
    links = await invoke<RustLink[]>("take_pending_deep_links");
  } catch (err) {
    logError("deepLinks.drain", err);
    return 0;
  }
  // Several queued at once: the newest is the one the user just opened.
  const latest = links[links.length - 1];
  if (latest) acceptLink(latest, router);
  return links.length;
}

export function acceptLink(link: PendingLink, router: Router): void {
  setPendingLink(link);
  // The join screen reads `pendingLink`; if it is already open it reacts to the change.
  if (router.currentRoute.value.name !== "join") {
    void router.push({ name: "join" });
  }
}

/** Start listening (Tauri only). Returns a function that stops listening. */
export async function startDeepLinks(router: Router): Promise<() => void> {
  if (!isTauri()) return () => {};
  const unlisten = await listen(EVENT, () => void drainDeepLinks(router));
  await drainDeepLinks(router); // cold start
  return unlisten;
}
