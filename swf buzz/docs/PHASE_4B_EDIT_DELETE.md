# Phase 4B — Message edit, delete, and admin delete

**Status: COMPLETE** — implemented, unit-tested, and verified against the real
relay (7/7, `tests/integration/messageEditDelete.e2e.spec.ts`).

Source of truth: `docs/PHASE_4_OLD_BUZZ_PROTOCOL_AUDIT.md` §3 and the OLD BUZZ
code cited inline below. Every kind and tag shape here was read out of OLD BUZZ
rather than inferred from its documentation.

---

## 1. The three operations, and why they are three

| Operation | Kind | Who the relay permits |
|---|---|---|
| Edit | **40003** | the target's author only (or the owning human of an agent author) |
| Self delete | **5** | the target's author only |
| Admin delete | **9005** | the author, **or** a channel owner/admin |

The trap this phase was written around: **admin delete is not "kind:5 plus a
role check."** kind:5 is NIP-09 retraction and the relay gates it on authorship
alone, so an admin's kind:5 against somebody else's message is refused outright.
Only kind:9005 carries the owner/admin path
(`crates/buzz-relay/src/handlers/side_effects.rs:569-655`,
`moderation_authz.rs:31`). A client that implemented the role check locally and
sent kind:5 would pass every mock-based test and fail silently in production —
which is why the real-relay test asserts the refusal explicitly rather than only
asserting the success path.

### Tag shapes (mirroring `desktop/src-tauri/src/events.rs`)

```
kind:40003  tags: ["h", <channelId>], ["e", <targetEventId>], ["p", …mentions]
            content: the new text
kind:5      tags: ["h", <channelId>], ["e", <targetEventId>]      content: ""
kind:9005   tags: ["h", <channelId>], ["e", <targetEventId>]      content: ""
```

`h` is non-standard for NIP-09 but required, so channel-scoped subscriptions
observe the deletion (OLD BUZZ notes the same at `events.rs:384`). The relay
rejects any deletion not carrying exactly one `e`/`a` target
(`ingest.rs:2710-2724`).

---

## 2. Overlays: the original event is never mutated

`src/features/messages/messageOverlay.ts` keeps edits and deletions as separate
records and folds them in at render time. Base messages stay exactly as the
relay sent them.

This is not tidiness, it is correctness. Relays replay history in whatever order
they like, and a reconnect backfill routinely delivers an **older** edit after a
newer one. If edits were applied by overwriting the message as they arrived, a
late-arriving stale edit would win and the user would watch their message revert.
Recomputing from the retained set makes arrival order irrelevant.

Two further rules:

- **Same-second ties break by event id**, so two edits written in the same second
  converge on the same winner for every client instead of depending on which
  socket delivered first.
- **An edit for a message not yet loaded is retained**, and applies when the
  target arrives. Dropping it would silently lose the edit on any backfill that
  delivered the overlay first.

## 3. Authorization: relay first, client for UX

The relay is the enforcement point. `channelPermissions.ts` mirrors its rules so
the menu does not offer actions that would be refused — `canEditMessage` and
`messageDeleteMode`. Unauthorized actions are **hidden, not disabled**, per the
design spec.

One check is genuinely the client's, though: a kind:5 whose author is not the
target's author is **ignored on render**. The relay should never emit one, and
honouring it would be a client-side deletion forgery. An admin delete (9005) is
honoured as-is, because the relay has already established the sender holds
`DeleteMessage` and the event alone does not carry channel role.

Also enforced: with no signed-in key, **no** delete path is offered — including
the admin one. There would be nothing to sign with, so offering it could only
produce a publish that fails. (A unit test caught this falling through to the
admin branch during development.)

## 4. Subscription shape

Edits and deletions travel the **same** `#h` filter as messages, in one
subscription — not a second one. A separate subscription could miss an edit while
receiving its message, leaving stale text on screen indefinitely; this reuses
4A's pagination, cursor and reconnect backfill unchanged.

Exhaustion is still judged on base messages only: a page containing nothing but
overlays means there is no older *message* at that cursor.

## 5. Optimistic behaviour

`useMessageMutations` applies the overlay locally on confirm, then reconciles
with the signed event (real id and relay `created_at`, which is what other
clients order against). A refusal rolls the overlay back and surfaces the relay's
own words — a generic failure message turned a precise server error into a
guessing game twice in this codebase already.

## 6. Verification

**Unit** — `messageOverlay.spec.ts` (12), `messageEditDelete.spec.ts` (protocol,
9), `messagePermissions.spec.ts` (10), `messageMenuActions.spec.ts` (7), plus
timeline-split assertions in `messagePagination.spec.ts`.

**Real relay** — `messageEditDelete.e2e.spec.ts`, 7/7:

| Scenario | Result |
|---|---|
| Author edits; edit renders, base event retained unmodified | pass |
| Several edits — newest wins | pass |
| Another member's edit of my message | refused by relay |
| Author self-deletes (kind:5); row disappears | pass |
| Owner deletes another's message — kind:5 **refused**, kind:9005 accepted | pass |
| Plain member attempts admin delete | refused by relay |
| Second identity sees the edit and the deletion unprompted | pass |

Harness note: NIP-42 binds the authenticated pubkey to the **socket**, so every
identity switch reconnects (`actAs`). Swapping the signer alone leaves the
connection authenticated as the previous identity and the relay refuses with
"event pubkey does not match authenticated identity" — worth knowing for any
future two-identity test.

## 7. Known limitations

- **DM conversations do not render overlays yet.** A DM is a channel, so edits
  and deletions are real there, but the DM read model has no overlay pipeline;
  `Kind41010Transport` drops them rather than half-applying them. Phase 4E.
- **The thread panel reads its own cache** (`queryKeys.thread(rootId)`) and so
  does not apply overlays to replies. Channel-feed rows are correct.
- **No edit history.** The relay retains every edit event, but the UI shows only
  the newest plus an "(edited)" marker.
- **No admin edit.** OLD BUZZ has none: `validate_edit_ownership` requires the
  actor to *be* the author. Not a gap — a deliberate protocol boundary.
