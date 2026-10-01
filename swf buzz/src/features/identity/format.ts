import { nip19 } from "nostr-tools";

/** `0f61e5e4…b2320029` — enough to recognise a public key, not the whole thing. */
export function shortKey(pubkeyHex: string | null | undefined): string {
  return pubkeyHex ? `${pubkeyHex.slice(0, 8)}…${pubkeyHex.slice(-8)}` : "";
}

/**
 * "Just now" / "3m ago" / "5h ago" / "2d ago" / "12 Mar" — the one relative-time
 * wording used by message timestamps and thread summary rows alike.
 *
 * `now` is passed in (rather than read from the clock here) so callers can drive
 * it from a shared ticking value and keep the text current without each row
 * owning a timer.
 */
export function relativeTime(unixSeconds: number, now: number = Date.now()): string {
  const diffMin = Math.floor((now - unixSeconds * 1000) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** `npub1abcd…wxyz` for a hex public key, or `` if it isn't one. */
export function shortNpub(pubkeyHex: string | null | undefined): string {
  if (!pubkeyHex || !/^[0-9a-f]{64}$/.test(pubkeyHex)) return "";
  try {
    const npub = nip19.npubEncode(pubkeyHex);
    return `${npub.slice(0, 10)}…${npub.slice(-6)}`;
  } catch {
    return "";
  }
}
