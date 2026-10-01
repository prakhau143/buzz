import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { profileService } from "@/services/ProfileService";
import { shortKey } from "@/features/identity/format";
import { profileFor } from "@/features/profile/profileStore";
import type { UserProfile } from "@/types/domain";

/**
 * A person's profile (display name, avatar, agent badge).
 *
 * The query only FETCHES (from the open community); what is rendered is the
 * canonical registry's newest event for that pubkey (profileStore.ts), so every
 * surface shows the same, newest name — including right after a save or a
 * live kind:0 update, with no per-surface cache to go stale.
 */
export function useProfile(pubkey: MaybeRefOrGetter<string | null | undefined>) {
  const query = useQuery({
    queryKey: computed(() => queryKeys.profile(toValue(pubkey) ?? "")),
    queryFn: () => profileService.fetchProfile(toValue(pubkey) as string),
    enabled: computed(() => !!toValue(pubkey)),
    staleTime: 5 * 60 * 1000,
  });
  const data = computed<UserProfile | undefined>(
    () => profileFor(toValue(pubkey)) ?? query.data.value ?? undefined,
  );
  return { ...query, data };
}

/**
 * How a person is labelled anywhere in the app: their display name when they
 * have published one, otherwise a short public key. One helper so the same
 * identity never appears as a name in one view and a hex string in another, and
 * so a profile update re-renders every view at once (shared query cache).
 */
export function useDisplayName(pubkey: MaybeRefOrGetter<string | null | undefined>) {
  const { data: profile } = useProfile(pubkey);
  const displayName = computed(() => {
    const key = toValue(pubkey);
    if (!key) return "";
    return profile.value?.displayName?.trim() || shortKey(key);
  });
  /** True while we are still falling back — lets callers style an unresolved name. */
  const isFallback = computed(() => !profile.value?.displayName?.trim());
  return { profile, displayName, isFallback };
}

/**
 * The same resolution as `useDisplayName`, for a whole LIST of pubkeys at once.
 *
 * A list view cannot call `useDisplayName` per row and still filter or count in
 * the parent — the names would only exist inside the rows, so searching would
 * fall back to matching hex, and "no results" could not be told apart from
 * "still loading". Resolving here keeps the label logic identical (same cache
 * entries, same fallback) while letting the parent own search and empty states.
 */
export function useProfileMap(pubkeys: MaybeRefOrGetter<string[]>) {
  const queryClient = useQueryClient();

  /** Deduplicated and sorted, so the same set of people is one cache entry however it was ordered. */
  const unique = computed(() => [...new Set(toValue(pubkeys).filter((p) => !!p))].sort());

  // ONE query for the whole list. This used to be `useQueries` — one query per
  // pubkey — which, on top of `fetchProfile`'s own two calls, made a 50-member
  // list cost ~100 subscriptions (docs/U0_UI_PROFILE_AUDIT.md §2).
  const query = useQuery({
    queryKey: computed(() => queryKeys.profileBatch(unique.value)),
    queryFn: async () => {
      const resolved = await profileService.fetchProfiles(unique.value);
      // Seed the per-pubkey entries so a later `useProfile(pubkey)` for anyone
      // in this batch is served from cache instead of opening its own
      // subscription — otherwise batching here would just move the N+1.
      for (const [pubkey, profile] of resolved) {
        queryClient.setQueryData(queryKeys.profile(pubkey), profile);
      }
      return resolved;
    },
    enabled: computed(() => unique.value.length > 0),
    staleTime: 5 * 60 * 1000,
  });

  /** pubkey -> profile: the canonical registry first (newest seen anywhere), then this batch. */
  const profiles = computed(() => {
    const fetched = query.data.value;
    const map = new Map<string, UserProfile>();
    for (const pubkey of unique.value) {
      const profile = profileFor(pubkey) ?? fetched?.get(pubkey);
      if (profile) map.set(pubkey, profile);
    }
    return map;
  });

  /** pubkey -> the label to render: published display name, else a short key. */
  const displayNames = computed(() => {
    const map = new Map<string, string>();
    for (const pubkey of toValue(pubkeys)) {
      map.set(pubkey, profiles.value.get(pubkey)?.displayName?.trim() || shortKey(pubkey));
    }
    return map;
  });

  return { profiles, displayNames };
}
