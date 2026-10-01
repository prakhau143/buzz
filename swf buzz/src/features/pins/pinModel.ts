/**
 * Pinned messages — the rules, as pure functions (no Vue, no I/O).
 * docs/PHASE_G_PINNED_MESSAGES_EVERYONE.md §Authorization and §Lifecycle.
 *
 * ONE active pin per conversation (channel or DM). Every pin and unpin is a
 * kind:40004 event in the conversation (protocol/pins.ts); the active pin is
 * the result of folding those events in a deterministic order, admitting only
 * the ones their actor was allowed to make. Every SWF client folds the same
 * events the same way, so they all show the same pin — whatever order the
 * relay replayed them in, however many times, across reconnects.
 *
 * WHO MAY DO WHAT (community channels; `role` is the actor's NIP-29 channel role):
 *
 *   | actor  | pin own msg | pin others' msg | unpin                        |
 *   |--------|-------------|-----------------|------------------------------|
 *   | member | yes         | no              | only a pin they made         |
 *   | admin  | yes         | yes             | any                          |
 *   | owner  | yes         | yes             | any                          |
 *
 * Replacing the active pin removes it, so a pin made while another is active
 * additionally needs the right to unpin that one: a member cannot knock
 * somebody else's pin off by pinning their own message.
 *
 * DMs have no roles: both participants own the conversation equally, so either
 * may pin any message in it and unpin any pin. The relay itself restricts who
 * can publish into (and read) a DM to its participants.
 *
 * ENFORCEMENT. The Buzz relay accepts kind:40004 from any member able to write
 * to the conversation but checks no role (ingest.rs:477 — `MessagesWrite`
 * scope + membership only), and SWF must not modify that relay. So the
 * role check lives here, on the read side of EVERY client: an unauthorized pin
 * event — e.g. from a modified client bypassing the UI — is stored by the relay
 * but ignored by every reader, and can therefore never become the pin anyone
 * sees. Non-members cannot publish or read at all (relay-enforced).
 */
import type { PinEvent } from "@/protocol/pins";
import type { MemberRole } from "@/protocol/membership";

export type ConversationKind = "channel" | "dm";

export interface ActivePin {
  /** The kind:40004 event that made this pin. */
  eventId: string;
  messageId: string;
  pinnedBy: string;
  pinnedAt: number;
  /** Author of the pinned message — verified when the message is known, else the pin's claim. */
  messageAuthor: string | null;
}

export interface PinContext {
  kind: ConversationKind;
  /** The actor's channel role, or null when not a member (ignored for DMs). */
  roleOf: (pubkey: string) => MemberRole | null;
  /**
   * Author of a message: the real author when the message is loaded/fetched,
   * `undefined` when unknown (not loaded, deleted or unavailable).
   */
  authorOf: (messageId: string) => string | undefined;
}

const isElevated = (role: MemberRole | null) => role === "owner" || role === "admin";

/** May `actor` pin a message written by `messageAuthor`? (ignores replacement — see `canPinNow`) */
export function canPinMessage(
  kind: ConversationKind,
  actor: string,
  actorRole: MemberRole | null,
  messageAuthor: string | null | undefined,
): boolean {
  if (kind === "dm") return true;
  if (actorRole === null) return false;
  if (isElevated(actorRole)) return true;
  return !!messageAuthor && messageAuthor.toLowerCase() === actor.toLowerCase();
}

/** May `actor` remove `pin`? */
export function canUnpin(kind: ConversationKind, actor: string, actorRole: MemberRole | null, pin: ActivePin): boolean {
  if (kind === "dm") return true;
  if (actorRole === null) return false;
  if (isElevated(actorRole)) return true;
  return pin.pinnedBy === actor.toLowerCase();
}

/** May `actor` pin this message right now, given the currently active pin (replacement rule)? */
export function canPinNow(
  kind: ConversationKind,
  actor: string,
  actorRole: MemberRole | null,
  messageAuthor: string | null | undefined,
  active: ActivePin | null,
): boolean {
  if (!canPinMessage(kind, actor, actorRole, messageAuthor)) return false;
  return !active || canUnpin(kind, actor, actorRole, active);
}

/** Deterministic order: created_at, then event id — same answer for every client. */
export function comparePinEvents(a: PinEvent, b: PinEvent): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Fold a conversation's pin events into its active pin (or null).
 *
 * Duplicates (same id) count once. Each event is judged against the state
 * BEFORE it, so authorization follows the history: an unpin is honoured only
 * if it names the currently pinned message and its actor may remove that pin;
 * a pin only if its actor may pin that message and may replace whatever is
 * active. A pin claims its message's author; when the message is known the
 * real author wins, and a false claim makes the pin invalid.
 */
export function resolveActivePin(events: Iterable<PinEvent>, ctx: PinContext): ActivePin | null {
  const unique = new Map<string, PinEvent>();
  for (const event of events) if (!unique.has(event.id)) unique.set(event.id, event);
  const ordered = [...unique.values()].sort(comparePinEvents);

  let active: ActivePin | null = null;
  for (const event of ordered) {
    const role = ctx.kind === "channel" ? ctx.roleOf(event.actorPubkey) : null;
    if (event.action === "unpin") {
      if (active && active.messageId === event.messageId && canUnpin(ctx.kind, event.actorPubkey, role, active)) {
        active = null;
      }
      continue;
    }
    const known = ctx.authorOf(event.messageId);
    if (known !== undefined && event.claimedAuthor && known.toLowerCase() !== event.claimedAuthor) continue;
    const author = known?.toLowerCase() ?? event.claimedAuthor;
    if (!canPinMessage(ctx.kind, event.actorPubkey, role, author)) continue;
    if (active && active.messageId !== event.messageId && !canUnpin(ctx.kind, event.actorPubkey, role, active)) {
      continue;
    }
    active = {
      eventId: event.id,
      messageId: event.messageId,
      pinnedBy: event.actorPubkey,
      pinnedAt: event.createdAt,
      messageAuthor: author ?? null,
    };
  }
  return active;
}
