import { defineStore } from "pinia";
import { useSessionStore } from "./session";
import { fetchReadState, publishReadState } from "@/services/ReadStateService";
import { mergeContexts } from "@/protocol/readState";

/**
 * Phase 3.7 — unread/mention tracking, client-local for now.
 *
 * CORRECTION (2026-09-23, docs/PHASE_4_OLD_BUZZ_PROTOCOL_AUDIT.md §0.2): an
 * earlier version of this comment claimed OLD BUZZ "has NO unread/read-marker
 * protocol at all (confirmed, not assumed)". That was wrong — a search miss
 * reported as a verified negative. OLD BUZZ has `KIND_READ_STATE = 30078`
 * (`crates/buzz-core/src/kind.rs:75`), a 796-line spec at `docs/nips/NIP-RS.md`,
 * and full client implementations in both desktop (9 files) and mobile (7).
 *
 * What IS true: the relay never *interprets* read state. The event content is
 * NIP-44-encrypted to the author's own key, and the relay handles it purely
 * structurally (`crates/buzz-db/src/store/replaceable.rs:143-193`) — so there
 * is no relay-computed read receipt, and the unread verdict is always the
 * client's. The difference that matters: OLD BUZZ's frontier is relay-HOSTED
 * and therefore converges across devices and survives a reinstall, whereas the
 * store below is localStorage-only and starts empty on every new device.
 *
 * Replacing this with NIP-RS is Phase 4C (docs/PHASE_4_IMPLEMENTATION_PLAN.md).
 * Until then this remains non-authoritative, best-effort state — never
 * persisted as, or derived from, a fake Nostr event.
 *
 * Persists only a channel id -> last-seen-message-timestamp map, namespaced
 * by the active identity's pubkey (never the identity itself, never key
 * material) to localStorage — a purely local convenience, not sensitive.
 */
function storageKey(pubkey: string | null): string {
  return `swf-buzz:read-state:${pubkey ?? "anonymous"}`;
}

/**
 * The frontier we have published, kept separately from `lastSeenAt`.
 *
 * `publishReadState` is a transport with NIP-33 replace semantics: it writes
 * whatever it is handed to our coordinate, downward included. So the grow-only
 * guarantee has to be upheld *before* the call, and `lastSeenAt` cannot serve
 * as the source for it — `markUnreadFrom` deliberately rewinds that map, and
 * publishing it wholesale shipped the rewind to the relay on the next advance
 * in any other channel. Persisted so a reload does not drop contexts out of
 * our coordinate on the following publish.
 */
function publishedKey(pubkey: string | null): string {
  return `swf-buzz:read-state:published:${pubkey ?? "anonymous"}`;
}

function loadFromStorage(
  pubkey: string | null,
  key: (p: string | null) => string = storageKey,
): Record<string, number> {
  try {
    const raw = localStorage.getItem(key(pubkey));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, number>;
    return {};
  } catch {
    return {};
  }
}

function saveToStorage(
  pubkey: string | null,
  data: Record<string, number>,
  key: (p: string | null) => string = storageKey,
): void {
  try {
    localStorage.setItem(key(pubkey), JSON.stringify(data));
  } catch {
    // Best-effort only — read state is a local convenience, never load-bearing.
  }
}

export const useReadStateStore = defineStore("readState", {
  state: () => ({
    /** channelId -> the `created_at` of the newest message I've seen in it. */
    lastSeenAt: {} as Record<string, number>,
    /**
     * What we publish. Grow-only by construction: advances and relay hydration
     * raise it, and a local mark-unread never lowers it.
     */
    publishedFrontier: {} as Record<string, number>,
    /** channelId -> count of renderable messages that arrived after lastSeenAt. */
    unreadCounts: {} as Record<string, number>,
    /** channelId -> whether any unread message mentions my pubkey (p-tag). */
    hasMention: {} as Record<string, boolean>,
    /**
     * channelId -> ids of the messages already counted in `unreadCounts`. The
     * startup catch-up and the live subscription can both see one event (an
     * arrival between the catch-up fetch and the subscription opening); counting
     * by id keeps it at one.
     */
    countedIds: {} as Record<string, Record<string, true>>,
    loadedForPubkey: null as string | null,
    /** True once the relay-hosted NIP-RS frontier has been merged in. */
    hydratedFromRelay: false,
    /**
     * The hydration gate (OLD BUZZ `isReady`): true once the relay frontier has
     * been merged — or has failed to arrive, in which case the local mirror is
     * authoritative. Nothing may render as unread before this: pre-hydration
     * counts are measured against a frontier that may be about to move forward.
     */
    isReady: false,
    /** Set when a publish fails, so the next change retries rather than skipping. */
    publishPending: false,
  }),
  actions: {
    ensureLoaded() {
      const pubkey = useSessionStore().pubkey;
      if (this.loadedForPubkey === pubkey) return;
      this.lastSeenAt = loadFromStorage(pubkey);
      // Fall back to `lastSeenAt` when no published frontier has been recorded
      // yet (first run after this was introduced): it is the best available
      // estimate of what our coordinate already holds, and starting from {}
      // would drop those contexts on the next publish.
      const storedPublished = loadFromStorage(pubkey, publishedKey);
      this.publishedFrontier = Object.keys(storedPublished).length
        ? storedPublished
        : { ...this.lastSeenAt };
      this.unreadCounts = {};
      this.hasMention = {};
      this.countedIds = {};
      this.loadedForPubkey = pubkey;
      this.hydratedFromRelay = false;
      this.isReady = false;
      this.publishPending = false;
    },

    /**
     * Merge the relay-hosted NIP-RS frontier into the local one.
     *
     * Local state is shown immediately from localStorage and this runs after,
     * so a slow or unreachable relay costs nothing visible. The merge is
     * grow-only (max per context), so hydrating can only ever mark things
     * read — it never resurrects an already-read channel as unread.
     *
     * Any channel whose frontier advanced past its last-seen mark has its
     * local unread count cleared: that channel was read on another device.
     */
    async hydrateFromRelay() {
      this.ensureLoaded();
      const pubkey = useSessionStore().pubkey;
      if (!pubkey) return;

      let fetched;
      try {
        fetched = await fetchReadState(pubkey);
      } catch {
        // Offline or relay refused — local state remains authoritative, and is
        // good enough to gate on (OLD BUZZ sets `isReady` in `.finally`).
        if (useSessionStore().pubkey === pubkey) this.isReady = true;
        return;
      }
      // The identity may have changed while the fetch was in flight.
      if (useSessionStore().pubkey !== pubkey) return;

      const merged = mergeContexts(this.lastSeenAt, fetched.contexts);
      for (const [channelId, seenAt] of Object.entries(merged)) {
        if ((this.lastSeenAt[channelId] ?? 0) < seenAt) {
          this.unreadCounts[channelId] = 0;
          this.hasMention[channelId] = false;
        }
      }
      this.lastSeenAt = merged;
      // The relay's frontier is, by definition, already published — folding it
      // in keeps our coordinate from dropping contexts another device owns.
      this.publishedFrontier = mergeContexts(this.publishedFrontier, fetched.contexts);
      this.hydratedFromRelay = fetched.hydrated;
      this.isReady = true;
      saveToStorage(pubkey, this.lastSeenAt);
      saveToStorage(pubkey, this.publishedFrontier, publishedKey);
    },

    /**
     * Publish the frontier. Failure is non-fatal and deliberately quiet: read
     * state is a convenience, and a toast every time the relay blips would be
     * worse than the missed sync. `publishPending` makes the next change retry.
     */
    async publishFrontier() {
      const pubkey = useSessionStore().pubkey;
      if (!pubkey) return;
      try {
        // `publishedFrontier`, never `lastSeenAt`: the latter can hold a local
        // mark-unread rewind, and the relay coordinate must only ever grow.
        await publishReadState(pubkey, this.publishedFrontier);
        this.publishPending = false;
      } catch {
        this.publishPending = true;
      }
    },
    /**
     * Count one message from someone else in a channel or DM that isn't open —
     * from the live subscription or the startup catch-up. With an `eventId`,
     * the same message is only ever counted once; with a `createdAt`, anything
     * at or before the frontier is already read and is ignored.
     */
    recordUnseenMessage(channelId: string, mentionsMe: boolean, eventId?: string, createdAt?: number) {
      this.ensureLoaded();
      if (createdAt !== undefined && createdAt <= (this.lastSeenAt[channelId] ?? 0)) return;
      if (eventId) {
        const seen = (this.countedIds[channelId] ??= {});
        if (seen[eventId]) return;
        seen[eventId] = true;
      }
      this.unreadCounts[channelId] = (this.unreadCounts[channelId] ?? 0) + 1;
      if (mentionsMe) this.hasMention[channelId] = true;
    },
    /** Unread count as the UI may show it: nothing before the hydration gate. */
    visibleUnread(channelId: string): number {
      return this.isReady ? (this.unreadCounts[channelId] ?? 0) : 0;
    },
    /** Call when the user opens/is viewing a channel and its newest visible message timestamp is known. */
    markChannelSeen(channelId: string, newestVisibleCreatedAt: number) {
      this.ensureLoaded();
      const current = this.lastSeenAt[channelId] ?? 0;
      const advanced = newestVisibleCreatedAt > current;
      if (advanced) {
        this.lastSeenAt[channelId] = newestVisibleCreatedAt;
        saveToStorage(useSessionStore().pubkey, this.lastSeenAt);
      }
      // Raise the published frontier independently of `advanced`: after a
      // mark-unread, `current` is the rewound value, so an advance relative to
      // it can still be below what we already published.
      if ((this.publishedFrontier[channelId] ?? 0) < newestVisibleCreatedAt) {
        this.publishedFrontier[channelId] = newestVisibleCreatedAt;
        saveToStorage(useSessionStore().pubkey, this.publishedFrontier, publishedKey);
      }
      this.unreadCounts[channelId] = 0;
      this.hasMention[channelId] = false;
      this.countedIds[channelId] = {};

      // Only publish when the frontier actually moved (or a previous publish
      // failed). Re-opening an already-read channel is the common case and
      // must not cost a relay round trip.
      if (advanced || this.publishPending) void this.publishFrontier();
    },
    lastSeenFor(channelId: string): number {
      this.ensureLoaded();
      return this.lastSeenAt[channelId] ?? 0;
    },
    /**
     * "Mark unread" from a specific message (message-menu action). Rewinds
     * the watermark to just before that message and sets the count to every
     * currently-loaded message from it onward. Safe to call while the
     * channel stays open: `ChannelsView`'s `markChannelSeen` watcher only
     * re-fires when `messages.value` changes identity (a new/older page
     * landing), not on demand, so this sticks until real new activity
     * arrives or the channel is left and reopened — same as a real
     * "mark unread" elsewhere.
     *
     * DELIBERATELY LOCAL-ONLY. A rewind cannot be expressed in the NIP-RS
     * frontier: the merge rule is grow-only (max per context), so publishing
     * a lower value is a no-op on every peer, and our own next hydrate would
     * restore the higher mark and undo the rewind. NIP-RS adds the `ov_*`
     * override layer for exactly this, which we have not implemented — so
     * mark-unread stays on this device by design rather than appearing to
     * sync and silently not doing so. See `docs/PHASE_4C_READ_STATE.md`.
     */
    markUnreadFrom(channelId: string, fromCreatedAt: number, unreadCount: number) {
      this.ensureLoaded();
      this.lastSeenAt[channelId] = fromCreatedAt - 1;
      saveToStorage(useSessionStore().pubkey, this.lastSeenAt);
      this.unreadCounts[channelId] = unreadCount;
    },
  },
});
