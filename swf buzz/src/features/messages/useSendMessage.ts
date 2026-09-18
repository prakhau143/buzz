import { ref, type MaybeRefOrGetter, toValue } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import { messageService } from "./MessageService";
import { reconcileOptimisticMessage } from "./optimisticMessage";
import { logError, userMessageFor } from "@/services/errors";
import type { Message } from "@/types/domain";
import type { BuildMessageParams } from "@/protocol/messages";

export interface SendMessageInput {
  content: string;
  reply?: BuildMessageParams["reply"];
  mentionPubkeys?: string[];
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
      reactions: [],
      status: "sending",
      isSystemMessage: false,
      isAgentMessage: false,
    };

    const queryKey = queryKeys.channelMessages(id);
    queryClient.setQueryData<Message[]>(queryKey, (current) => [...(current ?? []), optimistic]);

    isSending.value = true;
    error.value = null;
    try {
      const sent = await messageService.send({
        channelId: id,
        content: input.content,
        reply: input.reply,
        mentionPubkeys: input.mentionPubkeys,
      });
      queryClient.setQueryData<Message[]>(queryKey, (current) =>
        reconcileOptimisticMessage(current, optimisticId, sent),
      );
    } catch (err) {
      logError("useSendMessage.send", err);
      error.value = userMessageFor(err);
      queryClient.setQueryData<Message[]>(queryKey, (current) =>
        (current ?? []).map((m) =>
          m.id === optimisticId ? { ...m, status: "failed" as const } : m,
        ),
      );
    } finally {
      isSending.value = false;
    }
  }

  return { send, isSending, error };
}
