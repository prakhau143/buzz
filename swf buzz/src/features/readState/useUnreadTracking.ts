import { onUnmounted, watch, type MaybeRefOrGetter, toValue } from "vue";
import {
  relayConnectionService,
  type RelaySubscriptionHandle,
} from "@/services/RelayConnectionService";
import { communitySessionGeneration } from "@/features/communities/communitySession";
import { isRenderableMessageKind, parseMessageEvent } from "@/protocol/messages";
import { RENDERABLE_MESSAGE_KINDS } from "@/protocol/kinds";
import { useReadStateStore } from "@/stores/readState";
import { useSessionStore } from "@/stores/session";
import { countsAsUnread } from "./unreadPolicy";
import { messageMentionsMe } from "@/features/mentions/everyone";
import type { Message } from "@/types/domain";

/**
 * Phase 3.7 — drives `readStateStore.unreadCounts`/`hasMention` from a single
 * channel-agnostic live subscription (mirrors the pattern in
 * `ChannelService.subscribeToChannelUpdates`/`MessageService.subscribeToChannel`,
 * just without a `#h` filter so it spans every channel this identity can see).
 * Mount once (in `AppSidebar.vue`, which is always present while a community
 * is open) — do not mount per-channel-list-item.
 *
 * A message in the *currently open* channel never counts as unread — that
 * channel's `useChannelMessages` live subscription already renders it, and
 * `markChannelSeen` is called by the caller as messages become visible there.
 *
 * Re-opened for every community session: the sidebar stays mounted across a
 * community switch, and the switch's `disconnect()` closes this subscription.
 */
/** Called for every incoming message that is not your own (the desktop-alert hook). */
export type IncomingMessageHandler = (message: Message, context: { viewing: boolean; mentionsMe: boolean }) => void;

export function useUnreadTracking(
  activeChannelId: MaybeRefOrGetter<string | null>,
  onIncoming?: IncomingMessageHandler,
): void {
  const readState = useReadStateStore();
  const session = useSessionStore();

  let handle: RelaySubscriptionHandle | null = null;
  const open = () =>
    relayConnectionService.subscribe(
      "unread-tracking",
      [{ kinds: [...RENDERABLE_MESSAGE_KINDS], since: Math.floor(Date.now() / 1000) }],
      {
        onEvent: (event) => {
          if (!isRenderableMessageKind(event.kind)) return;
          const message = parseMessageEvent(event);
          if (!message.channelId) return;
          const viewing = message.channelId === toValue(activeChannelId);
          if (onIncoming && session.pubkey && message.authorPubkey !== session.pubkey) {
            onIncoming(message, { viewing, mentionsMe: messageMentionsMe(message, session.pubkey) });
          }
          if (viewing) return;
          // Same rule as the startup catch-up (own messages never; thread replies
          // only when they mention me) — see ./unreadPolicy.ts.
          if (!countsAsUnread(message, session.pubkey)) return;
          const mentionsMe = messageMentionsMe(message, session.pubkey);
          readState.recordUnseenMessage(message.channelId, mentionsMe, event.id, event.created_at);
        },
      },
    );

  watch(
    communitySessionGeneration,
    () => {
      handle?.close();
      handle = open();
    },
    { immediate: true },
  );
  onUnmounted(() => handle?.close());
}
