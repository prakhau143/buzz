import { defineStore } from "pinia";

/**
 * Client-only "last read" watermark per DM conversation, used to derive an
 * unread indicator. There is no protocol-level read-receipt/unread-count
 * mechanism (not in docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md) — this is
 * purely local UI state and resets each session, same as any other Pinia
 * store. See docs/DECISIONS.md if a durable/cross-device unread state is
 * ever required — that would need a new protocol event, not a client hack.
 */
export const useDmReadStateStore = defineStore("dmReadState", {
  state: () => ({
    lastReadAt: {} as Record<string, number>,
  }),
  actions: {
    markRead(conversationId: string, at: number = Math.floor(Date.now() / 1000)) {
      this.lastReadAt[conversationId] = at;
    },
  },
});
