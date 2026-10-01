/**
 * Custom user status — NIP-38 kind:30315, byte-compatible with OLD BUZZ
 * (`desktop/src/shared/api/relayClientSession.ts:379-393`, `SetStatusDialog.tsx`).
 *
 * Separate from presence (kind:20001): presence is live availability
 * (online/away/offline); a status is what the person says ("🏠 Working
 * remotely") with an expiry. Both can be shown at once.
 *
 *   kind 30315, content = text, tags = [["d","general"], ["emoji", e]?, ["expiration", unix]?]
 *   clear  = kind 30315, content "", tags [["d","general"]]
 */
import type { UnsignedEvent } from "@/features/signing/types";
import type { NostrFilter, RawNostrEvent } from "./types";

export const KIND_USER_STATUS = 30315;
const STATUS_D = "general";
/** OLD BUZZ's emoji for a text-only status. */
export const DEFAULT_STATUS_EMOJI = "💬";

export interface UserStatus {
  emoji: string;
  text: string;
  /** Unix seconds; OLD BUZZ always sets one. */
  expiresAt: number | null;
  updatedAt: number;
}

/** OLD BUZZ `SetStatusDialog.tsx:29-35`, same order and glyphs. */
export const QUICK_STATUSES: readonly { emoji: string; text: string }[] = [
  { emoji: "🗣️", text: "In a meeting" },
  { emoji: "🚌", text: "Commuting" },
  { emoji: "🤒", text: "Out sick" },
  { emoji: "🏖️", text: "Vacationing" },
  { emoji: "🏠", text: "Working remotely" },
];

export type StatusDuration = "1h" | "8h" | "today" | "week" | "custom";

export const STATUS_DURATIONS: readonly { value: StatusDuration; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "8h", label: "8 hours" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "custom", label: "Custom" },
];

/** Expiry for a duration, in local time — OLD BUZZ's rules. `custom` uses `customAt`. */
export function statusExpiry(duration: StatusDuration, now = new Date(), customAt?: Date): number {
  const d = new Date(now);
  switch (duration) {
    case "1h":
      return Math.floor(now.getTime() / 1000) + 3600;
    case "8h":
      return Math.floor(now.getTime() / 1000) + 8 * 3600;
    case "today":
      d.setHours(24, 0, 0, 0); // next local midnight
      return Math.floor(d.getTime() / 1000);
    case "week": {
      const days = (8 - d.getDay()) % 7 || 7; // next Monday 00:00
      d.setDate(d.getDate() + days);
      d.setHours(0, 0, 0, 0);
      return Math.floor(d.getTime() / 1000);
    }
    case "custom":
      return Math.floor((customAt ?? new Date(now.getTime() + 24 * 3600_000)).getTime() / 1000);
  }
}

export function buildSetStatusEvent(params: { emoji: string; text: string; expiresAt: number | null }): UnsignedEvent {
  const tags: string[][] = [["d", STATUS_D]];
  const emoji = params.emoji.trim() || (params.text.trim() ? DEFAULT_STATUS_EMOJI : "");
  if (emoji) tags.push(["emoji", emoji]);
  if (params.expiresAt) tags.push(["expiration", String(params.expiresAt)]);
  return { kind: KIND_USER_STATUS, content: params.text.trim(), tags };
}

export function buildClearStatusEvent(): UnsignedEvent {
  return { kind: KIND_USER_STATUS, content: "", tags: [["d", STATUS_D]] };
}

export function buildStatusFetchFilter(pubkeys: string[]): NostrFilter {
  return { kinds: [KIND_USER_STATUS], authors: pubkeys, "#d": [STATUS_D], limit: pubkeys.length };
}

export function buildStatusLiveFilter(): NostrFilter {
  return { kinds: [KIND_USER_STATUS], "#d": [STATUS_D], limit: 0 };
}

/** A status, or `null` when the event clears it. Expiry is checked by the reader. */
export function parseStatusEvent(event: RawNostrEvent): UserStatus | null {
  if (event.kind !== KIND_USER_STATUS) return null;
  if (event.tags.find((t) => t[0] === "d")?.[1] !== STATUS_D) return null;
  const text = event.content.trim();
  const emoji = event.tags.find((t) => t[0] === "emoji")?.[1]?.trim() ?? "";
  if (!text && !emoji) return null;
  const exp = Number(event.tags.find((t) => t[0] === "expiration")?.[1]);
  return { emoji, text, expiresAt: Number.isFinite(exp) && exp > 0 ? exp : null, updatedAt: event.created_at };
}

export function isStatusActive(status: UserStatus | null | undefined, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return !!status && (status.expiresAt === null || status.expiresAt > nowSec);
}
