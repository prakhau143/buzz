import { computed, onUnmounted, ref, shallowRef, watch, type ComputedRef, type Ref } from "vue";
import type { PinEvent } from "@/protocol/pins";
import type { MemberRole } from "@/protocol/membership";
import type { Message } from "@/types/domain";
import { logError, userMessageFor } from "@/services/errors";
import type { RelaySubscriptionHandle } from "@/services/RelayConnectionService";
import { pinService } from "./PinService";
import {
  canPinNow,
  canUnpin,
  resolveActivePin,
  type ActivePin,
  type ConversationKind,
} from "./pinModel";

/**
 * The pinned message of ONE conversation, for a conversation screen (desktop
 * ChannelsView / DmView, mobile channel / DM pages). Owns the pin event stream
 * (fetch + live subscription, deduplicated by id), resolves the active pin with
 * `pinModel.resolveActivePin`, finds the pinned message (loaded timeline first,
 * otherwise ONE fetch by id), and pins / unpins through `PinService`.
 *
 * Permission answers (`canPin`, `canUnpinActive`) come from the same model
 * every reader uses to accept or reject pin events — the menu can never offer
 * something the other clients would refuse.
 */

export type PinnedMessageStatus = "loading" | "ready" | "unavailable" | "error";

export interface PinnedView {
  pin: ActivePin;
  /** The pinned message as currently rendered (edits applied), or null. */
  message: Message | null;
  status: PinnedMessageStatus;
  /** Thread root to reveal it in, when the pinned message is a reply. */
  threadRootId: string | null;
}

export interface UseConversationPinOptions {
  conversationId: () => string | null;
  kind: () => ConversationKind;
  myPubkey: () => string | null;
  /** Channel role of anyone (from the channel roster). Ignored for DMs. */
  roleOf: (pubkey: string) => MemberRole | null;
  /** The roster has loaded — until then no pin can be judged, so none is shown. */
  rolesReady: () => boolean;
  /** The conversation's rendered messages (edits applied, deletions removed), replies included. */
  messages: () => readonly Message[] | undefined;
  /** Ids deleted in this conversation (delete overlays), when known. */
  isDeleted?: (messageId: string) => boolean;
}

export interface ConversationPin {
  active: ComputedRef<ActivePin | null>;
  view: ComputedRef<PinnedView | null>;
  isLoading: Ref<boolean>;
  busy: Ref<boolean>;
  error: Ref<string | null>;
  isPinned: (messageId: string) => boolean;
  canPin: (message: Message) => boolean;
  canUnpinActive: ComputedRef<boolean>;
  /** Pinning this message would replace a different active pin (ask first). */
  replaces: (message: Message) => boolean;
  pin: (message: Message) => Promise<boolean>;
  unpin: () => Promise<boolean>;
  reload: () => Promise<void>;
}

export function useConversationPin(opts: UseConversationPinOptions): ConversationPin {
  const events = shallowRef(new Map<string, PinEvent>());
  const isLoading = ref(false);
  const busy = ref(false);
  const error = ref<string | null>(null);
  /** Pinned messages fetched by id: Message, null (relay has none), or "error". */
  const fetched = shallowRef(new Map<string, Message | null | "error">());
  const fetching = new Set<string>();

  let handle: RelaySubscriptionHandle | null = null;
  let generation = 0;

  function absorb(list: Iterable<PinEvent>): void {
    let changed = false;
    const next = new Map(events.value);
    for (const event of list) {
      if (next.has(event.id)) continue; // duplicate delivery (reconnect, two subscriptions)
      next.set(event.id, event);
      changed = true;
    }
    if (changed) events.value = next;
  }

  async function load(conversationId: string): Promise<void> {
    const mine = ++generation;
    handle?.close();
    handle = null;
    events.value = new Map();
    fetched.value = new Map();
    fetching.clear();
    error.value = null;
    isLoading.value = true;
    // Subscribe first, from slightly before "now", so nothing published while
    // the history fetch is in flight is missed; overlap is deduplicated.
    handle = pinService.subscribe(conversationId, Math.floor(Date.now() / 1000) - 5, (event) => {
      if (mine === generation) absorb([event]);
    });
    try {
      const history = await pinService.fetchPinEvents(conversationId);
      if (mine === generation) absorb(history);
    } catch (err) {
      if (mine === generation) {
        logError("useConversationPin.load", err);
        error.value = userMessageFor(err);
      }
    } finally {
      if (mine === generation) isLoading.value = false;
    }
  }

  watch(
    opts.conversationId,
    (id) => {
      if (id) void load(id);
      else {
        generation += 1;
        handle?.close();
        handle = null;
        events.value = new Map();
      }
    },
    { immediate: true },
  );
  onUnmounted(() => {
    generation += 1;
    handle?.close();
  });

  const loadedById = computed(() => {
    const map = new Map<string, Message>();
    for (const m of opts.messages() ?? []) map.set(m.id, m);
    return map;
  });

  function authorOf(messageId: string): string | undefined {
    const loaded = loadedById.value.get(messageId);
    if (loaded) return loaded.authorPubkey.toLowerCase();
    const got = fetched.value.get(messageId);
    return got && got !== "error" ? got.authorPubkey.toLowerCase() : undefined;
  }

  const active = computed<ActivePin | null>(() => {
    if (!opts.conversationId() || !opts.rolesReady()) return null;
    return resolveActivePin(events.value.values(), {
      kind: opts.kind(),
      roleOf: (pk) => opts.roleOf(pk),
      authorOf,
    });
  });

  async function fetchPinned(conversationId: string, messageId: string): Promise<void> {
    if (fetching.has(messageId)) return;
    fetching.add(messageId);
    const mine = generation;
    let result: Message | null | "error";
    try {
      result = await pinService.fetchMessage(conversationId, messageId);
    } catch (err) {
      logError("useConversationPin.fetchPinned", err);
      result = "error";
    } finally {
      fetching.delete(messageId);
    }
    if (mine !== generation) return;
    const next = new Map(fetched.value);
    next.set(messageId, result);
    fetched.value = next;
  }

  // The pinned message outside the loaded window: ask the relay for it, once.
  watch(
    () => active.value?.messageId ?? null,
    (messageId) => {
      const conversationId = opts.conversationId();
      if (!messageId || !conversationId) return;
      if (loadedById.value.has(messageId) || fetched.value.has(messageId)) return;
      if (opts.isDeleted?.(messageId)) return;
      void fetchPinned(conversationId, messageId);
    },
    { immediate: true },
  );

  const view = computed<PinnedView | null>(() => {
    const pin = active.value;
    if (!pin) return null;
    const threadRootOf = (m: Message | null) =>
      m?.thread.rootId && m.thread.rootId !== m.id ? m.thread.rootId : null;
    if (opts.isDeleted?.(pin.messageId)) return { pin, message: null, status: "unavailable", threadRootId: null };
    const loaded = loadedById.value.get(pin.messageId);
    if (loaded) return { pin, message: loaded, status: "ready", threadRootId: threadRootOf(loaded) };
    const got = fetched.value.get(pin.messageId);
    if (got === undefined) return { pin, message: null, status: "loading", threadRootId: null };
    if (got === "error") return { pin, message: null, status: "error", threadRootId: null };
    if (got === null) return { pin, message: null, status: "unavailable", threadRootId: null };
    return { pin, message: got, status: "ready", threadRootId: threadRootOf(got) };
  });

  const me = () => opts.myPubkey()?.toLowerCase() ?? null;
  const myRole = () => {
    const pk = me();
    return pk && opts.kind() === "channel" ? opts.roleOf(pk) : null;
  };

  function canPin(message: Message): boolean {
    const pk = me();
    if (!pk || !opts.rolesReady() || message.status !== "sent" || message.isSystemMessage) return false;
    if (active.value?.messageId === message.id) return false;
    return canPinNow(opts.kind(), pk, myRole(), message.authorPubkey, active.value);
  }

  const canUnpinActive = computed(() => {
    const pk = me();
    const pin = active.value;
    return !!pk && !!pin && canUnpin(opts.kind(), pk, myRole(), pin);
  });

  async function publish(params: { messageId: string; action: "pin" | "unpin"; messageAuthor?: string }): Promise<boolean> {
    const conversationId = opts.conversationId();
    if (!conversationId || busy.value) return false;
    busy.value = true;
    error.value = null;
    try {
      const event = await pinService.publish({ conversationId, ...params });
      // The relay accepted it: fold it in now rather than waiting for the echo.
      if (conversationId === opts.conversationId()) absorb([event]);
      return true;
    } catch (err) {
      logError(`useConversationPin.${params.action}`, err);
      error.value = userMessageFor(err);
      return false;
    } finally {
      busy.value = false;
    }
  }

  return {
    active,
    view,
    isLoading,
    busy,
    error,
    isPinned: (messageId) => active.value?.messageId === messageId,
    canPin,
    canUnpinActive,
    replaces: (message) => !!active.value && active.value.messageId !== message.id,
    pin: (message) =>
      canPin(message)
        ? publish({ messageId: message.id, action: "pin", messageAuthor: message.authorPubkey })
        : Promise.resolve(false),
    unpin: () => {
      const pin = active.value;
      return pin && canUnpinActive.value ? publish({ messageId: pin.messageId, action: "unpin" }) : Promise.resolve(false);
    },
    reload: async () => {
      const id = opts.conversationId();
      if (id) await load(id);
    },
  };
}
