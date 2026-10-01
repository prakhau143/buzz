import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import { inboxService } from "./InboxService";
import type { InboxView } from "@/protocol/inbox";

/**
 * One inbox category.
 *
 * Categories are separate queries because they are separate server queries —
 * `mentions` and `needs_action` join the mention table for the signed-in
 * pubkey, `activity` scans accessible channels. Merging them client-side would
 * mean refetching all three whenever one tab was opened.
 */
export function useInbox(view: MaybeRefOrGetter<InboxView>) {
  const session = useSessionStore();
  const pubkey = computed(() => session.pubkey);

  return useQuery({
    queryKey: computed(() => queryKeys.inbox(toValue(view))),
    queryFn: () => inboxService.fetchFeed(toValue(view), pubkey.value as string),
    enabled: computed(() => !!pubkey.value),
    // The feed is a read model the relay recomputes per request; a short stale
    // window keeps tab switching instant without showing yesterday's inbox.
    staleTime: 60 * 1000,
  });
}
