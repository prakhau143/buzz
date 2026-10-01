import { defineStore } from "pinia";
import type { PresenceStatus } from "@/protocol/presence";

export interface PresenceEntry {
  status: PresenceStatus;
  /** Unix seconds of the event this came from. */
  updatedAt: number;
  source: "snapshot" | "live";
}

/**
 * THE presence source of truth — one map, keyed by pubkey (never by display
 * name). Every dot in the app (sidebar DMs, message avatars, profile, member
 * lists) reads `statusOf(pubkey)`, so two places can never disagree about the
 * same person. Written only by `features/presence/presenceSync.ts`.
 */
export const usePresenceStore = defineStore("presence", {
  state: () => ({
    byPubkey: {} as Record<string, PresenceEntry>,
  }),
  getters: {
    /** `null` until the relay has answered for this pubkey — render no dot rather than a guess. */
    statusOf:
      (state) =>
      (pubkey: string | null | undefined): PresenceStatus | null =>
        (pubkey && state.byPubkey[pubkey]?.status) || null,
  },
  actions: {
    apply(pubkey: string, entry: PresenceEntry): void {
      const current = this.byPubkey[pubkey];
      // A live event older than the last live one (reordered delivery) must not win.
      // Snapshot times are "now" on the relay/our clock, so they are not compared.
      if (current?.source === "live" && entry.source === "live" && entry.updatedAt < current.updatedAt) {
        return;
      }
      if (current?.status === entry.status && current.source === entry.source) {
        current.updatedAt = entry.updatedAt;
        return;
      }
      this.byPubkey[pubkey] = entry;
    },
    reset(): void {
      this.byPubkey = {};
    },
  },
});
