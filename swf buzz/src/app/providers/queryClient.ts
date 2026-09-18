import { QueryClient } from "@tanstack/vue-query";

/**
 * All relay-backed server state (channels, messages, threads, DMs, members,
 * reactions, invites, agent lookups) lives here — Pinia stores stay client-only.
 * See docs/ARCHITECTURE.md §3 for the query-key conventions.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        gcTime: 5 * 60 * 1000,
        staleTime: 10 * 1000,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/**
 * Shared singleton, used by both `main.ts` (VueQueryPlugin) and application
 * services (`features/*\/`.*Service.ts) that update the cache from relay
 * subscription callbacks outside of Vue component setup — those can't call
 * `useQueryClient()`, so they import this directly instead.
 */
export const queryClient = createAppQueryClient();
