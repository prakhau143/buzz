import { defineStore } from "pinia";
import { isStatusActive, type UserStatus } from "@/protocol/userStatus";

/**
 * Custom statuses (NIP-38), keyed by pubkey — the one place every profile,
 * card and menu reads "🏠 Working remotely" from. Written only by
 * `features/presence/presenceSync.ts` (fetch + live) and by the signed-in
 * person saving their own status. Expired statuses are hidden on read
 * (OLD BUZZ enforces expiry in the client too); `now` ticks so they vanish on time.
 */
export const useUserStatusStore = defineStore("userStatus", {
  state: () => ({
    byPubkey: {} as Record<string, UserStatus | null>,
    now: Math.floor(Date.now() / 1000),
  }),
  getters: {
    statusOf:
      (state) =>
      (pubkey: string | null | undefined): UserStatus | null => {
        const status = pubkey ? state.byPubkey[pubkey] : null;
        return isStatusActive(status, state.now) ? status! : null;
      },
  },
  actions: {
    /** Newest wins; `null` records an explicit clear. */
    apply(pubkey: string, status: UserStatus | null, updatedAt: number): void {
      const current = this.byPubkey[pubkey];
      if (current && current.updatedAt > updatedAt) return;
      this.byPubkey[pubkey] = status ?? { emoji: "", text: "", expiresAt: 0, updatedAt };
    },
    tick(): void {
      this.now = Math.floor(Date.now() / 1000);
    },
    reset(): void {
      this.byPubkey = {};
    },
  },
});
