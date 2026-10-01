/**
 * URLs in message text — pure functions, no Vue, no I/O.
 * docs/PHASE_H_MESSAGE_ACTIONS_RICH_LINKS.md §URL parser.
 *
 * Detection is deliberately conservative: a link is drawn only for an explicit
 * `http://` / `https://` URL or a bare `www.` host, starting at a word boundary.
 * Everything else — `javascript:`, `data:`, `file:`, `vbscript:`, email
 * addresses, `nostr:` refs — stays plain text. A URL is never turned into HTML:
 * callers render `href` through a real `<a>` element with an attribute binding.
 */

export interface LinkMatch {
  /** Offsets into the original text. */
  start: number;
  end: number;
  /** Exactly as written in the message. */
  text: string;
  /** The normalised, safe-to-open absolute URL. */
  href: string;
}

/** The only schemes SWF opens. The product has no mailto:/tel: links today. */
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Candidates: `http(s)://…` or `www.…`, preceded by start-of-text or a
 * character that cannot be part of a word / address (so `foo@www.x.com` and
 * `xhttps://` never match). Ends at whitespace or a character URLs never
 * contain unencoded (`<`, `>`, `"`, backtick).
 */
const CANDIDATE = /(^|[\s([{<"'*_~|])((?:https?:\/\/|www\.)[^\s<>"`]+)/gi;

/** Trailing characters that belong to the sentence, not the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?'"*_~]+$/;

const MAX_URL_LENGTH = 2048;

/** Drop sentence punctuation and unbalanced closing brackets from a URL's end. */
export function trimUrlCandidate(candidate: string): string {
  let url = candidate;
  for (;;) {
    const before = url;
    url = url.replace(TRAILING_PUNCTUATION, "");
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
      while (url.endsWith(close) && count(url, close) > count(url, open)) url = url.slice(0, -1);
    }
    if (url === before) return url;
  }
}

function count(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n += 1;
  return n;
}

/**
 * The URL to open for `raw`, or null when it must not be opened: an unsafe or
 * unknown scheme, credentials in the authority (`https://user:pw@host` is a
 * classic phishing disguise), no real host, or absurd length.
 */
export function normalizeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  // Control characters / whitespace inside a URL are a smuggling vector.
  if ([...trimmed].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) || /\s/.test(trimmed)) return null;
  const withScheme = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
  if (url.username || url.password) return null;
  const host = url.hostname;
  if (!host || (!host.includes(".") && host !== "localhost" && !host.startsWith("["))) return null;
  return url.href;
}

/** Every safe link in `text`, in order. Offsets index the original text. */
export function findLinks(text: string): LinkMatch[] {
  if (!text || !/(?:https?:\/\/|www\.)/i.test(text)) return [];
  const found: LinkMatch[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const start = (match.index ?? 0) + match[1].length;
    const candidate = trimUrlCandidate(match[2]);
    if (!candidate || /^(?:https?:\/\/|www\.)$/i.test(candidate)) continue;
    const href = normalizeExternalUrl(candidate);
    if (!href) continue;
    found.push({ start, end: start + candidate.length, text: candidate, href });
  }
  return found;
}

export interface LinkDisplay {
  /** Hostname without `www.`. */
  host: string;
  /** Path + query + fragment, `/` stripped, possibly truncated. */
  rest: string;
  /** Whether `rest` was shortened (the full URL then lives in the tooltip). */
  truncated: boolean;
}

/** A compact, readable form: `x.com` + `buzzdotxyz/status/2105…`. Never used as the href. */
export function linkDisplay(href: string, maxRest = 36): LinkDisplay {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./i, "");
    let rest = `${url.pathname}${url.search}${url.hash}`.replace(/^\/+/, "").replace(/\/+$/, "");
    try {
      rest = decodeURI(rest);
    } catch {
      // keep the encoded form
    }
    const chars = [...rest];
    const truncated = chars.length > maxRest;
    return { host, rest: truncated ? `${chars.slice(0, maxRest - 1).join("")}…` : rest, truncated };
  } catch {
    return { host: href, rest: "", truncated: false };
  }
}
