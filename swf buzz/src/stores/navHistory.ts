import { defineStore } from "pinia";

/**
 * App-level navigation history for the header's Back / Forward — meaningful
 * destinations only (a channel, a DM, a thread), never the router's raw
 * history: login, NIP-42/auth steps, connection loading, membership failures,
 * modals, typing, presence and read-state updates are not places you went.
 *
 * Every entry names its community (relay URL). An entry from another community
 * is never navigated to — `back()` / `forward()` skip it — so history can't
 * render community A's channel against community B's session.
 */
export type NavEntry =
  | { type: "channel"; community: string; channelId: string }
  | { type: "dm"; community: string; conversationId: string }
  | { type: "thread"; community: string; parent: "channel" | "dm"; parentId: string; rootEventId: string };

const MAX_ENTRIES = 100;

export function sameEntry(a: NavEntry | undefined, b: NavEntry): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

export const useNavHistoryStore = defineStore("navHistory", {
  state: () => ({
    entries: [] as NavEntry[],
    /** Index of the current entry; -1 when empty. */
    index: -1,
  }),
  actions: {
    /** Record a visit. Visiting after going back drops the forward branch (browser semantics). */
    record(entry: NavEntry): void {
      if (sameEntry(this.entries[this.index], entry)) return;
      this.entries = [...this.entries.slice(0, this.index + 1), entry].slice(-MAX_ENTRIES);
      this.index = this.entries.length - 1;
    },
    /** The nearest earlier (step -1) or later (step +1) entry in `community`, or null. */
    peek(step: -1 | 1, community: string | null): { entry: NavEntry; index: number } | null {
      for (let i = this.index + step; i >= 0 && i < this.entries.length; i += step) {
        if (this.entries[i].community === community) return { entry: this.entries[i], index: i };
      }
      return null;
    },
    moveTo(index: number): void {
      this.index = index;
    },
    reset(): void {
      this.entries = [];
      this.index = -1;
    },
  },
});
