import { defineStore } from "pinia";
import type { ThreadSummary } from "@/types/domain";

/**
 * Thread Index — the relay's own thread summaries, per channel/DM.
 *
 * Source: the relay-signed kind:39005 events the channel window returns with
 * `include_summaries: true` (OLD BUZZ `channel_window.rs`). One per top-level
 * message that has replies: `descendant_count`, `last_reply_at`, `participants`
 * (pubkeys). They are NOT stored events — a WebSocket REQ for kind 39005 returns
 * nothing (verified live), which is why summaries used to vanish after a reload:
 * the only other source was replies already sitting in the channel cache, and the
 * top-level channel window doesn't put replies there until a thread is opened.
 *
 * Filled whenever a history page loads (initial or older), so a message's thread
 * row is visible as soon as the message is. Live replies are added on top of
 * these by `mergeThreadSummaries`. Server data only; nothing here is guessed.
 */
export const useThreadIndexStore = defineStore("threadIndex", {
  state: () => ({
    /** channelId (or DM id) → rootId → summary. */
    byChannel: {} as Record<string, Record<string, ThreadSummary>>,
  }),
  actions: {
    absorb(channelId: string, summaries: readonly ThreadSummary[] | undefined): void {
      if (!summaries?.length) return;
      const current = { ...(this.byChannel[channelId] ?? {}) };
      for (const s of summaries) {
        const held = current[s.rootId];
        // A newer summary (later last reply) replaces an older one for the same root.
        if (!held || (s.lastReplyAt ?? 0) >= (held.lastReplyAt ?? 0)) current[s.rootId] = s;
      }
      this.byChannel[channelId] = current;
    },
    reset(): void {
      this.byChannel = {};
    },
  },
  getters: {
    forChannel:
      (state) =>
      (channelId: string | null | undefined): Map<string, ThreadSummary> =>
        new Map(Object.entries((channelId && state.byChannel[channelId]) || {})),
  },
});
