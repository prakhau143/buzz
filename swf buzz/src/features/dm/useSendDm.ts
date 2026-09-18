import { ref, type MaybeRefOrGetter, toValue } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import { dmService } from "./DmService";
import { reconcileOptimisticMessage } from "@/features/messages/optimisticMessage";
import { logError, userMessageFor } from "@/services/errors";
import type { Message } from "@/types/domain";

/** Same optimistic send/retry pattern as features/messages/useSendMessage, but through DmService. */
export function useSendDm(conversationId: MaybeRefOrGetter<string>) {
  const queryClient = useQueryClient();
  const session = useSessionStore();
  const isSending = ref(false);
  const error = ref<string | null>(null);

  async function send(content: string, mentionPubkeys: string[] = []): Promise<void> {
    const id = toValue(conversationId);
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: optimisticId,
      channelId: id,
      authorPubkey: session.pubkey ?? "",
      content,
      createdAt: Math.floor(Date.now() / 1000),
      thread: {},
      mentions: mentionPubkeys,
      reactions: [],
      status: "sending",
      isSystemMessage: false,
      isAgentMessage: false,
    };

    const queryKey = queryKeys.dm(id);
    queryClient.setQueryData<Message[]>(queryKey, (current) => [...(current ?? []), optimistic]);

    isSending.value = true;
    error.value = null;
    try {
      const sent = await dmService.sendMessage(id, content, mentionPubkeys);
      queryClient.setQueryData<Message[]>(queryKey, (current) =>
        reconcileOptimisticMessage(current, optimisticId, sent),
      );
    } catch (err) {
      logError("useSendDm.send", err);
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
