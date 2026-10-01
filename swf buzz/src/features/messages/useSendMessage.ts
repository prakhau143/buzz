import { ref, type MaybeRefOrGetter, toValue } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import { messageService } from "./MessageService";
import { reconcileOptimisticMessage } from "./optimisticMessage";
import { compareMessages } from "./messageCursor";
import { logError, userMessageFor } from "@/services/errors";
import type { Message } from "@/types/domain";
import type { ThreadData } from "@/features/threads/ThreadService";
import type { BuildMessageParams } from "@/protocol/messages";
import type { Attachment } from "@/protocol/imeta";

export interface SendMessageInput {
  content: string;
  reply?: BuildMessageParams["reply"];
  mentionPubkeys?: string[];
  /** Already-uploaded attachments. Upload happens before send, never during it. */
  attachments?: Attachment[];
  /** Semantic `@everyone` — set by the composer, only in community channels. */
  mentionsEveryone?: boolean;
}

/** Send flow with optimistic UI: the message appears immediately as "sending", then "sent" or "failed". */
export function useSendMessage(channelId: MaybeRefOrGetter<string>) {
  const queryClient = useQueryClient();
  const session = useSessionStore();
  const isSending = ref(false);
  const error = ref<string | null>(null);

  async function send(input: SendMessageInput): Promise<void> {
    const id = toValue(channelId);
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: optimisticId,
      channelId: id,
      authorPubkey: session.pubkey ?? "",
      content: input.content,
      createdAt: Math.floor(Date.now() / 1000),
      thread: input.reply
        ? { rootId: input.reply.rootEventId, parentId: input.reply.parentEventId }
        : {},
      mentions: input.mentionPubkeys ?? [],
      ...(input.mentionsEveryone ? { mentionsEveryone: true } : {}),
      reactions: [],
      status: "sending",
      isSystemMessage: false,
      isAgentMessage: false,
      attachments: input.attachments ?? [],
    };

    const queryKey = queryKeys.channelMessages(id);
    queryClient.setQueryData<Message[]>(queryKey, (current) => [...(current ?? []), optimistic]);
    // A reply belongs to its thread as well as to the channel. Without this the
    // thread panel showed nothing until it was closed and reopened: the panel
    // reads `queryKeys.thread(rootId)`, and only the relay's echo (a separate
    // live subscription that may not deliver one's own event) ever wrote there.
    const rootId = input.reply?.rootEventId ?? null;
    if (rootId) writeReplyToThread(rootId, optimistic);

    isSending.value = true;
    error.value = null;
    try {
      const sent = await messageService.send({
        channelId: id,
        content: input.content,
        reply: input.reply,
        mentionPubkeys: input.mentionPubkeys,
        attachments: input.attachments,
        mentionsEveryone: input.mentionsEveryone,
      });
      queryClient.setQueryData<Message[]>(queryKey, (current) =>
        reconcileOptimisticMessage(current, optimisticId, sent),
      );
      if (rootId) reconcileReplyInThread(rootId, optimisticId, sent);
    } catch (err) {
      logError("useSendMessage.send", err);
      error.value = userMessageFor(err);
      queryClient.setQueryData<Message[]>(queryKey, (current) =>
        (current ?? []).map((m) =>
          m.id === optimisticId ? { ...m, status: "failed" as const } : m,
        ),
      );
      if (rootId) markReplyFailedInThread(rootId, optimisticId);
    } finally {
      isSending.value = false;
    }
  }

  /** Append a reply to its thread cache, if that thread has been loaded. Deduplicated by id. */
  function writeReplyToThread(rootId: string, reply: Message): void {
    queryClient.setQueryData<ThreadData>(queryKeys.thread(rootId), (current) => {
      if (!current) return current; // not loaded: the panel's own fetch will include it
      if (current.replies.some((m) => m.id === reply.id)) return current;
      return {
        ...current,
        replies: [...current.replies, reply].sort(compareMessages),
      };
    });
  }

  /**
   * Replace the optimistic reply with the relay-confirmed one. If the live
   * subscription already delivered the real event, drop the optimistic copy
   * instead of leaving a duplicate.
   */
  function reconcileReplyInThread(rootId: string, optimisticId: string, sent: Message): void {
    queryClient.setQueryData<ThreadData>(queryKeys.thread(rootId), (current) => {
      if (!current) return current;
      const withoutOptimistic = current.replies.filter((m) => m.id !== optimisticId);
      const replies = withoutOptimistic.some((m) => m.id === sent.id)
        ? withoutOptimistic
        : [...withoutOptimistic, sent];
      return { ...current, replies: replies.sort(compareMessages) };
    });
  }

  function markReplyFailedInThread(rootId: string, optimisticId: string): void {
    queryClient.setQueryData<ThreadData>(queryKeys.thread(rootId), (current) => {
      if (!current) return current;
      return {
        ...current,
        replies: current.replies.map((m) =>
          m.id === optimisticId ? { ...m, status: "failed" as const } : m,
        ),
      };
    });
  }

  return { send, isSending, error };
}
