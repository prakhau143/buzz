/**
 * Minimal wire-format types shared across protocol/*.ts. Intentionally
 * structural (not imported from nostr-tools) so parsers/builders stay usable
 * regardless of which client library ends up wrapping the socket.
 */

export interface RawNostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Structurally identical to nostr-tools' `Filter` — re-declared so protocol/*.ts parsers/builders
 *  don't need to import from the client library directly. */
export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  search?: string;
  [tagFilter: `#${string}`]: string[] | undefined;
}

/** Reads the first value of a single-letter tag (e.g. "h", "d"), or undefined. */
export function firstTagValue(
  event: Pick<RawNostrEvent, "tags">,
  tagName: string,
): string | undefined {
  return event.tags.find((tag) => tag[0] === tagName)?.[1];
}

/** Reads every value of a repeated tag (e.g. all "p" tags), in order. */
export function allTagValues(event: Pick<RawNostrEvent, "tags">, tagName: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === tagName)
    .map((tag) => tag[1])
    .filter((v): v is string => v !== undefined);
}
