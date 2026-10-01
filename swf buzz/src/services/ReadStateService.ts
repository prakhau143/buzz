/**
 * NIP-RS read state — fetch, merge and publish (`kind:30078`).
 *
 * The frontier is relay-HOSTED, not relay-interpreted: content is NIP-44 sealed
 * to the user's own keypair, so only this identity can read it. What that buys
 * over the previous localStorage-only store is convergence — the same account
 * on a second device, or after a reinstall, starts from the real read position
 * instead of "everything is unread".
 *
 * Scope note: this implements the core interoperable subset of NIP-RS — one
 * primary coordinate, frontier entries only. The manual-unread override layer
 * (`ov_*`) and multi-slot splitting are deliberately not implemented; see
 * `docs/PHASE_4C_READ_STATE.md` for what that costs and why the merge rule
 * makes a published "mark unread" a no-op regardless.
 */
import { getActiveSigningService } from "@/features/signing/signingServiceRegistry";
import {
  buildReadStateBlob,
  buildReadStateTags,
  generateSlotId,
  isWellFormedReadStateEvent,
  mergeContexts,
  parseReadStateBlob,
  READ_STATE_KIND,
  READ_STATE_T_TAG,
} from "@/protocol/readState";
import { signAndPublish } from "./publish";
import { fetchEventsOnce } from "./relayQuery";

/**
 * Per-installation identifiers. Both are local-only and non-sensitive: the
 * slot id is public (it is the `d` tag), and `client_id` is visible only
 * inside the sealed blob. Namespaced by pubkey so switching identity on a
 * shared device never reuses the other account's coordinate.
 */
function slotIdKey(pubkey: string): string {
  return `swf-buzz:read-state:slot-id:${pubkey}`;
}

function clientIdKey(pubkey: string): string {
  return `swf-buzz:read-state:client-id:${pubkey}`;
}

function readOrCreate(storageKey: string, create: () => string): string {
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
  } catch {
    // Private mode / blocked storage: fall through and use an ephemeral value.
  }
  const created = create();
  try {
    localStorage.setItem(storageKey, created);
  } catch {
    // Non-fatal: an ephemeral coordinate still converges via merge, it just
    // leaves an orphaned blob behind rather than rewriting its own.
  }
  return created;
}

export function getSlotId(pubkey: string): string {
  return readOrCreate(slotIdKey(pubkey), generateSlotId);
}

export function getClientId(pubkey: string): string {
  return readOrCreate(clientIdKey(pubkey), () => `swf-buzz-${generateSlotId().slice(0, 16)}`);
}

/** Forget this identity's coordinate — used when an identity is removed. */
export function forgetReadStateIdentifiers(pubkey: string): void {
  try {
    localStorage.removeItem(slotIdKey(pubkey));
    localStorage.removeItem(clientIdKey(pubkey));
  } catch {
    // Nothing to do; the values are conveniences, not state of record.
  }
}

export interface FetchedReadState {
  contexts: Record<string, number>;
  /** True when at least one of our own coordinates decrypted successfully. */
  hydrated: boolean;
}

/**
 * Fetch every read-state coordinate this identity has published and merge them.
 *
 * All of the user's own coordinates are merged, not just our slot: a second
 * device publishes under its own slot id, and its frontier is exactly what we
 * are here to pick up.
 */
export async function fetchReadState(pubkey: string): Promise<FetchedReadState> {
  const events = await fetchEventsOnce([
    { kinds: [READ_STATE_KIND], authors: [pubkey], "#t": [READ_STATE_T_TAG] },
  ]);

  const signer = getActiveSigningService();
  let contexts: Record<string, number> = {};
  let hydrated = false;

  for (const event of events) {
    // Structural filter first — kind:30078 is shared with unrelated
    // application data (NIP-78), so a foreign event here is expected, not an
    // error, and must never reach decryption.
    if (!isWellFormedReadStateEvent(event.tags)) continue;
    // Defensive: the relay filter already constrains authors, but the blob is
    // only meaningful sealed to our own key.
    if (event.pubkey !== pubkey) continue;

    let plaintext: string;
    try {
      plaintext = await signer.nip44Decrypt(pubkey, event.content);
    } catch {
      // Not ours to read, or a foreign kind:30078. Routine — skip quietly.
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(plaintext);
    } catch {
      continue;
    }

    const blob = parseReadStateBlob(parsedJson);
    if (!blob) continue;

    contexts = mergeContexts(contexts, blob.contexts);
    hydrated = true;
  }

  return { contexts, hydrated };
}

/**
 * Publish the frontier to this installation's primary coordinate.
 *
 * Addressable (NIP-33) semantics mean this replaces our previous blob rather
 * than appending, so the coordinate count stays at one per installation.
 */
export async function publishReadState(
  pubkey: string,
  contexts: Record<string, number>,
): Promise<void> {
  const signer = getActiveSigningService();
  const blob = buildReadStateBlob(getClientId(pubkey), contexts);
  const ciphertext = await signer.nip44Encrypt(pubkey, JSON.stringify(blob));

  await signAndPublish({
    kind: READ_STATE_KIND,
    content: ciphertext,
    tags: buildReadStateTags(getSlotId(pubkey)),
  });
}
