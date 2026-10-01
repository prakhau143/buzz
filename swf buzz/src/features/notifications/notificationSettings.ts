import { ref, watch } from "vue";

/**
 * Notification preferences — per IDENTITY, on this DEVICE (OLD BUZZ:
 * `buzz-notification-settings.v2:<pubkey>`, docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md
 * §5). Not per community: OLD BUZZ has no per-community switch and SWF does
 * not invent one. OLD BUZZ's agent job slots are not carried over.
 */
export type NotificationSlot = "dm" | "mention" | "thread_reply" | "needs_action";

export const NOTIFICATION_SLOTS: { id: NotificationSlot; label: string; description: string }[] = [
  { id: "dm", label: "Direct messages", description: "A new message in a direct conversation." },
  { id: "mention", label: "Mentions", description: "Someone @mentions you in a channel." },
  { id: "thread_reply", label: "Thread replies", description: "A reply to you in a thread." },
  { id: "needs_action", label: "Needs action", description: "Requests and reminders in your Inbox." },
];

export interface NotificationSettings {
  desktopEnabled: boolean;
  notifyWhileViewing: boolean;
  soundEnabled: boolean;
  homeBadge: boolean;
  /** Windows taskbar red-dot overlay while something needs me. */
  taskbarIndicator: boolean;
  slots: Record<NotificationSlot, boolean>;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  desktopEnabled: true,
  notifyWhileViewing: false,
  soundEnabled: true,
  homeBadge: true,
  taskbarIndicator: true,
  slots: { dm: true, mention: true, thread_reply: true, needs_action: true },
};

export const notificationStorageKey = (pubkey: string) => `swf-buzz:notifications.v1:${pubkey.toLowerCase()}`;

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

export function sanitizeNotificationSettings(raw: unknown): NotificationSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const slots = (v.slots && typeof v.slots === "object" ? v.slots : {}) as Record<string, unknown>;
  const d = DEFAULT_NOTIFICATION_SETTINGS;
  return {
    desktopEnabled: bool(v.desktopEnabled, d.desktopEnabled),
    notifyWhileViewing: bool(v.notifyWhileViewing, d.notifyWhileViewing),
    soundEnabled: bool(v.soundEnabled, d.soundEnabled),
    homeBadge: bool(v.homeBadge, d.homeBadge),
    taskbarIndicator: bool(v.taskbarIndicator, d.taskbarIndicator),
    slots: {
      dm: bool(slots.dm, d.slots.dm),
      mention: bool(slots.mention, d.slots.mention),
      thread_reply: bool(slots.thread_reply, d.slots.thread_reply),
      needs_action: bool(slots.needs_action, d.slots.needs_action),
    },
  };
}

const settings = ref<NotificationSettings>({ ...DEFAULT_NOTIFICATION_SETTINGS, slots: { ...DEFAULT_NOTIFICATION_SETTINGS.slots } });
const loadedFor = ref<string | null>(null);

export function loadNotificationSettings(pubkey: string | null): NotificationSettings {
  loadedFor.value = pubkey;
  let next = sanitizeNotificationSettings(null);
  if (pubkey) {
    try {
      const raw = localStorage.getItem(notificationStorageKey(pubkey));
      if (raw) next = sanitizeNotificationSettings(JSON.parse(raw));
    } catch {
      // unreadable: defaults
    }
  }
  settings.value = next;
  return next;
}

/** Returns whether it was persisted. */
export function updateNotificationSettings(patch: Partial<Omit<NotificationSettings, "slots">> & { slots?: Partial<NotificationSettings["slots"]> }): boolean {
  settings.value = sanitizeNotificationSettings({
    ...settings.value,
    ...patch,
    slots: { ...settings.value.slots, ...(patch.slots ?? {}) },
  });
  if (!loadedFor.value) return false;
  try {
    localStorage.setItem(notificationStorageKey(loadedFor.value), JSON.stringify(settings.value));
    return true;
  } catch {
    return false;
  }
}

export function useNotificationSettings(pubkeyGetter: () => string | null) {
  watch(pubkeyGetter, (pk) => {
    if (pk !== loadedFor.value) loadNotificationSettings(pk);
  }, { immediate: true });
  return { settings, update: updateNotificationSettings };
}

export function currentNotificationSettings(): NotificationSettings {
  return settings.value;
}
