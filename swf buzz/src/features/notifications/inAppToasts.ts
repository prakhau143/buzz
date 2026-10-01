import { readonly, ref } from "vue";
import type { NotificationSlot } from "./notificationSettings";
import type { NotificationTarget } from "./notificationEngine";

/**
 * In-app notification toasts — the FOREGROUND surface of the one notification
 * pipeline (docs/WINDOWS_NOTIFICATIONS_IMPLEMENTATION.md §In-app toasts).
 *
 * `alertIfAllowed` decides the surface for each event: the SWF window focused
 * → a toast here; otherwise → the native Windows toast. Never both, so the
 * ledger in useNotificationService stays the only dedup and an event is shown
 * once, on one surface.
 */
export interface InAppToast {
  /** Stable key (the ledger key's event id) — a repeat never stacks twice. */
  id: string;
  slot: NotificationSlot;
  title: string;
  body: string;
  /** "#release · thread reply", "Direct message", … */
  context: string;
  /** For the avatar (public key only). */
  authorPubkey?: string;
  authorName: string;
  createdAt: number;
  target?: NotificationTarget;
  /**
   * The event's mention semantics (its `p` tags and `@everyone` tag), so the
   * in-app card can draw `body` with the shared tokens (`MessagePreview`). The
   * OS notification only ever gets the plain `body` text.
   */
  mentions?: readonly string[];
  mentionsEveryone?: boolean;
  /** Discriminates from `StatusToast`; absent on every notification toast. */
  variant?: "notification";
}

/**
 * A short confirmation of the user's OWN action ("Message pinned") — the same
 * stack, a compact one-line card, announced politely, no click target. Not a
 * notification: it never goes through the notification ledger or settings.
 */
export interface StatusToast {
  id: string;
  variant: "status";
  title: string;
  icon: "pin" | "pin-off" | "check" | "warning";
  tone: "neutral" | "error";
  createdAt: number;
}

export type ToastEntry = InAppToast | StatusToast;

export const isStatusToast = (t: Pick<ToastEntry, "variant">): boolean => t.variant === "status";

export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_DISMISS_MS = 6000;
export const STATUS_TOAST_DISMISS_MS = 2600;

const toasts = ref<ToastEntry[]>([]);
let opener: ((target: NotificationTarget) => void | Promise<void>) | null = null;

/** Newest first; at most MAX_VISIBLE_TOASTS — older ones are dropped, not queued. */
export const inAppToasts = readonly(toasts);

export function pushInAppToast(toast: InAppToast): void {
  if (toasts.value.some((t) => t.id === toast.id)) return;
  toasts.value = [toast, ...toasts.value].slice(0, MAX_VISIBLE_TOASTS);
}

let statusSerial = 0;
/** "📌 Message pinned" and friends. Replaces an earlier status toast with the same title. */
export function pushStatusToast(input: { title: string; icon?: StatusToast["icon"]; tone?: StatusToast["tone"] }): void {
  const toast: StatusToast = {
    id: `status:${++statusSerial}`,
    variant: "status",
    title: input.title,
    icon: input.icon ?? "check",
    tone: input.tone ?? "neutral",
    createdAt: Math.floor(Date.now() / 1000),
  };
  const rest = toasts.value.filter((t) => !(t.variant === "status" && t.title === input.title));
  toasts.value = [toast, ...rest].slice(0, MAX_VISIBLE_TOASTS);
}

export function dismissInAppToast(id: string): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function clearInAppToasts(): void {
  toasts.value = [];
}

/** Registered by the session's notification service (it owns routing). */
export function setInAppToastOpener(fn: typeof opener): void {
  opener = fn;
}

/** Click on a toast: route to its exact message / thread / DM, then dismiss it. */
export async function openInAppToast(toast: ToastEntry): Promise<void> {
  if (toast.variant === "status") return;
  dismissInAppToast(toast.id);
  if (toast.target && opener) await opener(toast.target);
}
