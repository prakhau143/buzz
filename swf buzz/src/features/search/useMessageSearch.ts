import { computed, ref, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { searchService } from "./SearchService";
import { isSearchableQuery } from "@/protocol/search";

/** How long the user must stop typing before a REQ goes out. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Debounced message search.
 *
 * The debounce is not cosmetic: every distinct query string is its own Vue
 * Query cache entry AND its own relay REQ, so keying off the raw input would
 * issue one search per keystroke and cache a useless entry for every prefix.
 */
export function useMessageSearch(
  query: MaybeRefOrGetter<string>,
  options: { channelId?: MaybeRefOrGetter<string | undefined> } = {},
) {
  const debounced = ref(toValue(query).trim());
  let timer: ReturnType<typeof setTimeout> | undefined;

  watch(
    () => toValue(query),
    (next) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        debounced.value = next.trim();
      }, SEARCH_DEBOUNCE_MS);
    },
  );

  const channelId = computed(() => toValue(options.channelId));
  const enabled = computed(() => isSearchableQuery(debounced.value));

  const search = useQuery({
    queryKey: computed(() => queryKeys.messageSearch(debounced.value, channelId.value)),
    queryFn: () => searchService.searchMessages(debounced.value, { channelId: channelId.value }),
    enabled,
    // A result set is a point-in-time answer, not live state. Keeping it briefly
    // makes re-opening the same search instant without pretending it is fresh.
    staleTime: 30 * 1000,
  });

  return {
    ...search,
    /** The query actually sent — lets the UI show "no results for X" accurately while typing continues. */
    submittedQuery: computed(() => debounced.value),
    isSearching: enabled,
  };
}
