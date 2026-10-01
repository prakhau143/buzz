import { matchScore, MIN_QUERY } from "@/features/search/paletteModel";

/**
 * Mobile Search tabs and local ranking. Ranking is the palette's own
 * `matchScore` (one rule for desktop and mobile); only the per-section limit
 * differs, because a phone tab is a full list, not a five-row preview.
 * Messages never come from here — they are the relay's NIP-50 answer.
 */
export type SearchTab = "all" | "messages" | "people" | "channels";

export const SEARCH_TABS: readonly { value: SearchTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "messages", label: "Messages" },
  { value: "people", label: "People" },
  { value: "channels", label: "Channels" },
];

/** How many rows a section shows in "All" before "See all". */
export const ALL_TAB_LIMIT = 4;
/** Local matches are bounded even in their own tab. */
export const TAB_LIMIT = 50;

export const isSearchTab = (v: unknown): v is SearchTab => SEARCH_TABS.some((t) => t.value === v);

export const canSearch = (query: string) => query.trim().length >= MIN_QUERY;

export function rankLocal<T>(items: readonly T[], label: (t: T) => string, query: string, limit = TAB_LIMIT): T[] {
  return items
    .map((item) => ({ item, score: matchScore(label(item), query) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}
