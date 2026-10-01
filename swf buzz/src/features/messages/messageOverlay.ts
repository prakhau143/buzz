/**
 * Edit/delete overlays over a channel timeline.
 *
 * The base messages (kind:9/40002) are never mutated. Edits (kind:40003) and
 * deletions (kind:5 / kind:9005) are kept as separate overlay records and
 * folded in at render time, which is what makes out-of-order delivery safe:
 * relays replay history in whatever order they like, and a reconnect backfill
 * routinely delivers an older edit after a newer one. Recomputing from the
 * retained set means the newest edit always wins regardless of arrival order.
 *
 * Authorization is the relay's job, not ours — it refuses an unauthorized
 * kind:40003 outright (`ingest.rs` `validate_edit_ownership`) and an
 * unauthorized kind:5/9005 likewise (`side_effects.rs:569-655`). What we still
 * enforce here is the one thing a relay cannot express per-event: a kind:5 is a
 * *self*-retraction, so an arriving kind:5 whose author is not the target's
 * author is ignored rather than trusted. That case should never reach us, and
 * treating it as authoritative would be a client-side deletion forgery.
 */
import type { Message } from "@/types/domain";

export interface EditOverlay {
  targetId: string;
  authorPubkey: string;
  content: string;
  createdAt: number;
  /** The edit event itself carried the semantic `@everyone` tag. */
  mentionsEveryone?: boolean;
}

export interface DeleteOverlay {
  targetId: string;
  authorPubkey: string;
  /** kind:5 is author-only; kind:9005 may legitimately come from an admin. */
  isAdminDelete: boolean;
}

export interface MessageOverlays {
  /** Newest authorized edit per target id. */
  edits: Map<string, EditOverlay>;
  deletes: Map<string, DeleteOverlay>;
}

export function emptyOverlays(): MessageOverlays {
  return { edits: new Map(), deletes: new Map() };
}

/**
 * Records an edit, keeping only the newest per target.
 *
 * Ties on `createdAt` are broken by event id so that two edits written in the
 * same second converge on the same winner for every client, rather than
 * depending on which arrived first.
 */
export function applyEdit(
  overlays: MessageOverlays,
  edit: EditOverlay & { eventId: string },
): MessageOverlays {
  const existing = overlays.edits.get(edit.targetId) as
    | (EditOverlay & { eventId?: string })
    | undefined;
  if (
    !existing ||
    edit.createdAt > existing.createdAt ||
    (edit.createdAt === existing.createdAt && edit.eventId > (existing.eventId ?? ""))
  ) {
    overlays.edits.set(edit.targetId, edit);
  }
  return overlays;
}

export function applyDelete(overlays: MessageOverlays, del: DeleteOverlay): MessageOverlays {
  // A delete is terminal: once any authorized delete is seen, keep it. An
  // admin delete never loses to a later self delete or vice versa.
  if (!overlays.deletes.has(del.targetId)) {
    overlays.deletes.set(del.targetId, del);
  }
  return overlays;
}

/**
 * Folds overlays into a timeline: deleted rows are dropped, edited rows carry
 * the new content and an `editedAt` marker.
 *
 * A pending (optimistic, not yet acknowledged) message is never overlaid — its
 * id is a local placeholder that no relay event can legitimately target.
 */
export function renderTimeline(messages: Message[], overlays: MessageOverlays): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    const del = overlays.deletes.get(message.id);
    if (del && isDeleteAuthorized(del, message)) continue;

    const edit = overlays.edits.get(message.id);
    if (edit && isEditAuthorized(edit, message)) {
      // `@everyone` survives an edit: the original event's tag stays the
      // authority (it is what notified people), and an edit may carry it too.
      // The chip still only renders where the edited text says `@everyone`.
      const mentionsEveryone = !!message.mentionsEveryone || !!edit.mentionsEveryone;
      out.push({ ...message, content: edit.content, editedAt: edit.createdAt, ...(mentionsEveryone ? { mentionsEveryone } : {}) });
      continue;
    }
    out.push(message);
  }
  return out;
}

/**
 * A kind:5 retraction is only honoured from the message's own author. An admin
 * delete (kind:9005) is honoured as-is: the relay has already established that
 * the sender holds `DeleteMessage` for that channel, and we cannot re-derive
 * channel role from the event alone.
 */
function isDeleteAuthorized(del: DeleteOverlay, message: Message): boolean {
  return del.isAdminDelete || del.authorPubkey === message.authorPubkey;
}

/** Same reasoning for edits: the relay enforces it, we refuse a forged author. */
function isEditAuthorized(edit: EditOverlay, message: Message): boolean {
  return edit.authorPubkey === message.authorPubkey;
}
