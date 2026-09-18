import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { threadService } from "./ThreadService";
import type { Message } from "@/types/domain";

/**
 * Reply counts for every top-level (non-reply) message currently visible,
 * as one batched relay query. Refetches whenever the visible message set
 * changes — no live subscription (yet): a thread's count updates the next
 * time this list changes or the query's own staleTime lapses, which is an
 * acceptable trade-off for a first pass rather than adding a second live
 * WebSocket subscription per channel just for reply counts.
 */
export function useThreadSummaries(messages: MaybeRefOrGetter<Message[]>) {
  const rootIds = computed(() =>
    toValue(messages)
      .filter((m) => !m.thread.rootId)
      .map((m) => m.id),
  );

  const query = useQuery({
    queryKey: computed(() => queryKeys.threadSummaries(rootIds.value)),
    queryFn: () => threadService.fetchSummaries(rootIds.value),
    enabled: computed(() => rootIds.value.length > 0),
    staleTime: 15_000,
  });

  return computed(() => query.data.value ?? new Map());
}
