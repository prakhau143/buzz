/**
 * NIP-RS read state (`kind:30078`) — wire format, validation and merge.
 *
 * Source of truth: `../buzz/docs/nips/NIP-RS.md` (the spec OLD BUZZ implements)
 * and `crates/buzz-core/src/kind.rs:71-75`. Everything here is transcribed from
 * that spec rather than inferred from the desktop client, so the MUST/MUST NOT
 * rules below are the spec's, not ours.
 *
 * The relay never interprets this: content is NIP-44 sealed to the author's own
 * keypair and stored structurally as an addressable event
 * (`buzz-db/src/store/replaceable.rs`). The unread verdict is always the
 * client's — what the relay provides is *hosting*, so the frontier converges
 * across devices and survives a reinstall.
 */

export const READ_STATE_KIND = 30078;
export const READ_STATE_D_TAG_PREFIX = "read-state:";
export const READ_STATE_T_TAG = "read-state";

/** Blob schema version. Spec: clients MUST ignore blobs with unknown `v`. */
export const READ_STATE_VERSION = 1;

/** Spec: "Blobs containing more than 10,000 context entries MUST be rejected." */
export const MAX_CONTEXTS = 10_000;

/** Spec: context IDs exceeding 256 *bytes* are discarded (not 256 chars). */
export const MAX_CONTEXT_ID_BYTES = 256;

/** Spec: timestamps are uint32. */
const MAX_TIMESTAMP = 4_294_967_295;

/**
 * Spec: `<slot-id>` is exactly 32 lowercase hex characters. The shape is fixed
 * rather than opaque so a relay can recognise a read-state coordinate from the
 * `d` tag alone, without decrypting, and apply per-coordinate protections. A
 * client that picks another shape silently forfeits those protections — which
 * is why this is validated rather than merely generated correctly.
 */
const SLOT_ID_PATTERN = /^[0-9a-f]{32}$/;

const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Reserved prefixes for the manual-unread override layer. We do not implement
 * that layer (see `docs/PHASE_4C_READ_STATE.md`), but we MUST still escape raw
 * context IDs that collide with it, or a future override-aware client reading
 * our blob would mis-parse them as override counters.
 */
const OVERRIDE_PREFIX = "ov_";
const ESCAPE_PREFIX = "esc:";

/** Well-known context schemes (NIP-RS "Read Context Schemes"). */
export const THREAD_CONTEXT_PREFIX = "thread:";
export const MSG_CONTEXT_PREFIX = "msg:";

export interface ReadStateBlob {
  v: typeof READ_STATE_VERSION;
  client_id: string;
  contexts: Record<string, number>;
}

/** A channel's context ID is its UUID (NIP-RS.md:130 names Buzz's own shapes). */
export function channelContextKey(channelId: string): string {
  return channelId;
}

export function threadContextKey(rootEventId: string): string {
  return `${THREAD_CONTEXT_PREFIX}${rootEventId}`;
}

export function msgContextKey(eventId: string): string {
  return `${MSG_CONTEXT_PREFIX}${eventId}`;
}

export function isThreadContextKey(value: string): boolean {
  return (
    value.startsWith(THREAD_CONTEXT_PREFIX) &&
    EVENT_ID_PATTERN.test(value.slice(THREAD_CONTEXT_PREFIX.length))
  );
}

export function isMsgContextKey(value: string): boolean {
  return (
    value.startsWith(MSG_CONTEXT_PREFIX) &&
    EVENT_ID_PATTERN.test(value.slice(MSG_CONTEXT_PREFIX.length))
  );
}

/** Spec: `<slot-id>` is 32 lowercase hex, generated randomly, persisted locally. */
export function generateSlotId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function readStateDTag(slotId: string): string {
  return `${READ_STATE_D_TAG_PREFIX}${slotId}`;
}

export function isValidReadStateDTag(value: string | undefined): value is string {
  if (!value?.startsWith(READ_STATE_D_TAG_PREFIX)) return false;
  return SLOT_ID_PATTERN.test(value.slice(READ_STATE_D_TAG_PREFIX.length));
}

/**
 * Escape a raw context ID for the wire (spec "Reserved Namespace").
 * `escape` then `unescape` is the identity function.
 */
export function escapeContextId(rawContextId: string): string {
  if (rawContextId.startsWith(OVERRIDE_PREFIX) || rawContextId.startsWith(ESCAPE_PREFIX)) {
    return `${ESCAPE_PREFIX}${rawContextId}`;
  }
  return rawContextId;
}

/** Spec: strip exactly one leading `esc:` — never more than one per receive. */
export function unescapeContextId(wireKey: string): string {
  return wireKey.startsWith(ESCAPE_PREFIX) ? wireKey.slice(ESCAPE_PREFIX.length) : wireKey;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isValidTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_TIMESTAMP
  );
}

/**
 * Validate and normalise a decrypted blob.
 *
 * Returns `null` when the blob MUST be discarded outright. Individual bad
 * entries are dropped while the rest of the blob is still processed — the spec
 * draws that distinction deliberately, so one malformed context from another
 * client never costs the user their whole frontier.
 *
 * Override-counter keys (`ov_s:` / `ov_c:` / `ov_b:`) are dropped rather than
 * interpreted: we do not implement the override layer, and the spec forbids
 * applying the generic per-entry rule to them. Dropping the group is the
 * conservative reading — it keeps the corresponding frontier entry intact.
 */
export function parseReadStateBlob(raw: unknown): ReadStateBlob | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  if (!Number.isInteger(record.v)) return null;
  if (record.v !== READ_STATE_VERSION) return null;

  const clientId = record.client_id;
  if (typeof clientId !== "string" || clientId.length < 1 || clientId.length > 64) {
    return null;
  }

  const contexts = record.contexts;
  if (typeof contexts !== "object" || contexts === null || Array.isArray(contexts)) {
    return null;
  }

  const entries = Object.entries(contexts as Record<string, unknown>);
  if (entries.length > MAX_CONTEXTS) return null;

  const clean: Record<string, number> = {};
  for (const [wireKey, value] of entries) {
    if (
      wireKey.startsWith("ov_s:") ||
      wireKey.startsWith("ov_c:") ||
      wireKey.startsWith("ov_b:")
    ) {
      continue;
    }
    if (byteLength(wireKey) > MAX_CONTEXT_ID_BYTES) continue;
    if (!isValidTimestamp(value)) continue;
    clean[unescapeContextId(wireKey)] = value;
  }

  return { v: READ_STATE_VERSION, client_id: clientId, contexts: clean };
}

/**
 * Spec merge rule: per context, the newest marker wins. Grow-only — which is
 * exactly why a manual "mark unread" (a *rewind*) cannot be expressed in the
 * frontier alone and needs the override layer we have not implemented.
 */
export function mergeContexts(
  into: Record<string, number>,
  incoming: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...into };
  for (const [contextId, timestamp] of Object.entries(incoming)) {
    const current = merged[contextId] ?? 0;
    if (timestamp > current) merged[contextId] = timestamp;
  }
  return merged;
}

/** Build the plaintext blob for publishing. Applies reserved-prefix escaping. */
export function buildReadStateBlob(
  clientId: string,
  contexts: Record<string, number>,
): ReadStateBlob {
  const wire: Record<string, number> = {};
  for (const [rawContextId, timestamp] of Object.entries(contexts)) {
    if (!isValidTimestamp(timestamp)) continue;
    const key = escapeContextId(rawContextId);
    if (byteLength(key) > MAX_CONTEXT_ID_BYTES) continue;
    wire[key] = timestamp;
  }
  return { v: READ_STATE_VERSION, client_id: clientId, contexts: wire };
}

/** Tags for a read-state event. Spec: exactly one `d`, exactly one `t`. */
export function buildReadStateTags(slotId: string): string[][] {
  return [
    ["d", readStateDTag(slotId)],
    ["t", READ_STATE_T_TAG],
  ];
}

/**
 * Structural check applied to every received event before decryption is even
 * attempted. The spec requires ignoring events with zero/multiple `d` tags,
 * a non-`read-state:` `d` value, a malformed slot id, or a `t` tag count other
 * than exactly one — and it warns that `kind:30078` is shared with unrelated
 * application data, so this filter is a correctness requirement, not an
 * optimisation.
 */
export function isWellFormedReadStateEvent(tags: string[][]): boolean {
  const dTags = tags.filter((tag) => tag[0] === "d");
  if (dTags.length !== 1) return false;
  if (!isValidReadStateDTag(dTags[0][1])) return false;

  const tTags = tags.filter((tag) => tag[0] === "t" && tag[1] === READ_STATE_T_TAG);
  return tTags.length === 1;
}
