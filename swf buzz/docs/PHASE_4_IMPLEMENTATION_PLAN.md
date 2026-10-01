# Phase 4 — SWF Implementation Plan

**Date:** 2026-09-23
**Status:** PLAN ONLY. Nothing here has been implemented.
**Source of truth:** `docs/PHASE_4_OLD_BUZZ_PROTOCOL_AUDIT.md` (every requirement
below traces to a `file:line` finding there).

---

## §1. What must NOT change

Carried forward from `docs/OLD_BUZZ_OWNER_ADMIN_AUDIT.md` and re-confirmed by
this audit. None of these is open for revision during Phase 4:

1. Owner is **community-scoped**. The same identity may hold different roles in
   different communities.
2. Owner authentication is **NIP-42**; `relay_members` is the sole source of
   truth for community role.
3. **Owner ≠ Operator.** Two independent planes (`capabilities.ts:49-64`).
4. Owner may be created only by: `RELAY_OWNER_PUBKEY` bootstrap,
   `initial_owner_pubkey` at provisioning, or operator transfer.
5. kind:9030 and kind:9032 **cannot** assign owner; transfer is operator-only.
6. Any authenticated community member may create a channel.
7. Community role and channel role are separate planes.
8. Never infer owner from username, localStorage, selected community, profile,
   invite, or any frontend state. Never hardcode a pubkey.
9. **Do not migrate DMs to NIP-17.** The shipping path is kind:41010 + kind:9
   (audit §6.3). SWF is already correct here.
10. Do not bypass relay ownership guards with direct DB manipulation.

---

## §2. Prerequisite — P0, before any Phase 4 code

### P0.1 Restore a real community owner

The only `owner` rows belong to the operator key `38eb252a…` (audit §0.1). Until
a non-operator identity holds `relay_members.role = owner`, no owner-path UI can
be exercised and no owner-vs-admin test is meaningful.

- **Action:** `POST /operator/communities/transfer` (`api/operator.rs:358-430`),
  NIP-98-signed by the operator, transferring `ab019095…` to `07227e7a…`.
- **Not** a code change. Not a DB edit. Requires explicit user go-ahead —
  it changes live ownership.
- **Verify:** re-read `relay_members`; sign in as `07227e7a…`; assert the session
  resolves `owner` through the normal NIP-42 → roster → `resolveMyRole` path.

### P0.2 Fix the unresolved-role fallback

`src/features/access/communityDiscovery.ts:100` reports an unresolved role as a
definite `"member"` (audit §0.3). Change to preserve `null`, matching
`identitySession.ts:324`. Small, isolated, and it removes a defect that
reproduces the exact symptom we just spent a day diagnosing.

### P0.3 Correct two false statements in our own source

Both are factual claims that are now disproven (audit §0.2) and will mislead
whoever reads them next:

- `src/stores/readState.ts:5-8` — "OLD BUZZ has NO unread/read-marker protocol at
  all (confirmed, not assumed)". Replace with the accurate statement: OLD BUZZ
  has kind:30078/NIP-RS; the relay never *interprets* it.
- `docs/PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md:154` — same correction.
- `src/protocol/dm.ts:1-9` and `src/features/dm/Kind41010Transport.ts:1-9` —
  kind:41011 is **not** unverified; it has a real handler.

Comment/doc only. No behavior change.

---

## §3. Phase 4 scope

Ordered by dependency and by risk. **4A first** because every later phase
inherits its correctness; a search or inbox built on a lossy message pipeline
just distributes the loss.

### PHASE 4A — Messaging correctness (highest risk)

| Requirement | From | Files likely to change |
|---|---|---|
| Adopt `before_id` keyset pagination | audit §1, `protocol.rs:108-141` | `MessageService.ts`, `useChannelMessages.ts` |
| Consume relay-signed `kind:39006` as the **only** exhaustion authority | `bridge.rs:668-670` | `protocol/kinds.ts`, `MessageService.ts` |
| Single combined live REQ instead of a separate `since:now()` sub | `relayChannelFilters.ts:27-43` | `MessageService.ts:95-109` |
| Reconnect gap repair: `since − skew` + `(created_at,id)` cursor backfill | `relayReconnectReplay.ts:104-179` | `RelayConnectionService.ts`, new `reconnectRepair.ts` |
| Keep SWF's `status:"failed"` model (divergent but better) | audit §9 | document only |

**Protocol events:** 9, 40002, 39006.
**Dependencies:** none. **Blocks:** everything else.
**Tests:** unit for the keyset predicate incl. same-second bursts; **real-relay
E2E for reconnect loss** (matrix #5-8).

### PHASE 4B — Editing and deletion

| Requirement | From | Notes |
|---|---|---|
| kind:40003 edit with `e` → target | `kind.rs:483`, `ingest.rs:1154-1170` | relay enforces authorship — client gating is UX only |
| Latest-authorized-edit-wins overlay + `(edited)` label | `formatTimelineMessages.ts:257-298` | original is retained, never overwritten |
| Self-delete kind:5 | `ingest.rs:2710-2724` | |
| **Admin delete kind:9005** — a different kind, not kind:5 + role check | `side_effects.rs:569-655` | common mistake; call it out in review |
| Render deletes by removing the row; surface the kind:40099 audit message | `side_effects.rs:1730-1766` | |

**Dependencies:** 4A. **Tests:** matrix #12-14.

### PHASE 4C — Search, unread, inbox

| Requirement | From | Notes |
|---|---|---|
| NIP-50 `search` filter | `req.rs:596-760` | no server highlighting — client-side only |
| Result → channel/message/thread navigation | `resolveSearchHitDestination.ts` | server returns no thread-root id |
| **Replace localStorage unread with kind:30078 / NIP-RS** | `kind.rs:75`, `docs/nips/NIP-RS.md` | CRDT max-merge; localStorage becomes a hydration cache only |
| Inbox via the bridge `feed` flag, 4 categories | `bridge.rs:1206-1297` | counts are client-computed from read state |
| Exclude DMs from the feed poll | `feed.ts:66-75` | avoids duplicate notifications |

**Dependencies:** 4A; unread depends on nothing else but is the largest single
correctness gain for multi-device use.
**Risk:** NIP-RS is a 796-line spec — budget for reading it in full before coding.
**Tests:** matrix #15-17, plus a cross-device read-state convergence test.

### PHASE 4D — Composer and media

| Requirement | From | Notes |
|---|---|---|
| Blossom upload `PUT /upload`, **kind:24242** auth + `X-SHA-256` | `media.rs:140-239` | *not* NIP-98 27235 — easy to get wrong |
| NIP-92 `imeta` tags with mandatory `url`/`m`/`x`/`size` | `imeta.rs:161-163` | ingest rejects mismatches against the blob |
| Rich text → markdown at submit | `useRichTextEditor.ts:188-217` | |
| Emoji + custom emoji (30030/10030) | `MessageComposer.tsx:510-540` | |
| Voice notes | `useComposerVoiceNote.tsx:57-81` | real feature; uploads as ordinary media |

**Dependencies:** 4A. **Tests:** matrix #18.

### PHASE 4E — DMs (finish, do not rebuild)

The transport is already correct. Remaining work is discovery and polish:

| Requirement | From |
|---|---|
| Subscribe `{kinds:[44100,44101],"#p":[me]}` for receiver-side discovery | `useMembershipNotifications.ts:48-65` |
| kind:30622 visibility read-model for hide/unhide | `side_effects.rs:3453-3533` |
| Participant display names from kind:0 with kind:39000 tag fallback | `dmParticipantDisplay.ts:55-108` |
| Re-evaluate kind:41011 group-DM add (now known real) | `command_executor.rs:431-566` |

**Dependencies:** 4A (DM messages are kind:9), profile work from 4G.
**Tests:** matrix #20-24.

### PHASE 4F — Presence and typing

Typing already matches. Presence needs the 180 s TTL / 60 s heartbeat contract
honored (`presence.rs:16-44`) and the multi-node caveat in
`protocol/presence.ts:1-4` resolved. Optional: kind:30315 custom status.
**Tests:** matrix #25-26.

### PHASE 4G — Hardening, profiles, E2E

| Requirement | Notes |
|---|---|
| Add `nip05` to kind:0 writes | genuinely missing (`protocol/profile.ts:47-55`) |
| Decide the **designation** question explicitly | no such field exists in OLD BUZZ (audit §6.2). Either add a documented SWF-only field or drop it — do not silently reuse `about` |
| Document the profile-replication divergence | per-community rows are the OLD BUZZ model; our replication is a UX layer over the same wire format |
| Consolidate the **two parallel thread stacks** | `ThreadService` vs `ThreadServiceHttp` — pick one |
| Fix the reaction-removal live filter + its false comment | `ReactionService.ts:152-166` |
| Full two-identity real-relay E2E | §5 |

---

## §4. Implementation order

```
P0  Owner transfer + role-fallback fix + false-comment corrections
 ↓
4A  Messaging correctness  ← everything inherits this
 ↓
4B  Edit / delete / admin delete
 ↓
4C  Unread (NIP-RS) → Search → Inbox
 ↓
4D  Composer + media
 ↓
4E  DM completion
 ↓
4F  Presence / typing
 ↓
4G  Profiles, thread consolidation, hardening
 ↓
Two-identity real-relay E2E → Phase 4 completion audit
```

Deviation from the originally proposed order: **public/private channel
membership and profile/member-directory work move into P0/4G rather than sitting
between owner and messaging.** Reason: neither is a protocol gap — both are UI
over already-correct wire behavior — whereas 4A's pagination and reconnect
defects can silently lose messages, and every phase after it inherits that.

---

## §5. Test matrix

All protocol behavior is tested against the **real development relay**, not only
mocks. The DM bug fixed on 2026-09-23 passed a green unit suite for weeks while
being completely broken live — a mock that encodes the same wrong assumption as
the code proves nothing.

| # | Test | Phase | Real relay? |
|---|---|---|---|
| 1 | Two identities, same community | P0 | yes |
| 2 | Same channel, both members | 4A | yes |
| 3 | Send message | 4A | yes |
| 4 | Receive message live | 4A | yes |
| 5 | Restart receiver, history intact | 4A | yes |
| 6 | Older-message pagination incl. same-second burst | 4A | yes |
| 7 | Reconnect after drop — **no lost, no duplicated messages** | 4A | yes |
| 8 | Duplicate event delivery is idempotent | 4A | yes |
| 9 | Thread reply with NIP-10 markers | 4A | yes |
| 10 | Reaction add | 4A | yes |
| 11 | Reaction removal visible **live** to the other identity | 4G | yes |
| 12 | Edit own message; edit someone else's is refused by the relay | 4B | yes |
| 13 | Self-delete | 4B | yes |
| 14 | Admin delete (kind:9005) + 40099 audit message | 4B | yes |
| 15 | Search returns only permitted results | 4C | yes |
| 16 | Mention produces a `p` tag and is indexed | 4C | yes |
| 17 | Inbox aggregation + unread convergence across two devices | 4C | yes |
| 18 | Attachment upload → `imeta` → render → download | 4D | yes |
| 19 | Profile update propagates | 4G | yes |
| 20 | DM creation returns a server channel id | 4E | yes ✅ *passing* |
| 21 | DM discovery by the receiver without being told | 4E | yes ✅ *passing* |
| 22 | DM reply round trip | 4E | yes ✅ *passing* |
| 23 | DM survives restart | 4E | yes |
| 24 | DM duplicate prevention from **both** sides | 4E | yes ✅ *passing* |
| 25 | Presence online/offline with TTL expiry | 4F | yes |
| 26 | Typing indicator delivery | 4F | yes |

Tests 20-22 and 24 already pass — `tests/integration/dmLiveRelay.e2e.spec.ts`.

**Gate for every phase:** `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, `cargo check`, plus that phase's real-relay E2E. No phase is
called complete on a green unit suite alone.

---

## §6. Risk register

| Risk | Where | Mitigation |
|---|---|---|
| **Following OLD BUZZ docs instead of its code** | DM/NIP-17, FTS allowlist, reaction validation (audit §7) | Trace call sites; docs are not evidence |
| Silent message loss on reconnect | 4A | Dedicated E2E #7 that kills the socket mid-stream |
| False "end of history" from empty-page heuristic | 4A | Consume kind:39006 |
| Rebuilding a working DM stack | 4E | §1 rule 9 |
| Using NIP-98 for media upload | 4D | Blossom kind:24242 + `X-SHA-256` |
| Treating admin delete as kind:5 + role check | 4B | It is kind:9005 |
| Inventing a `designation` field into `about` | 4G | Decide explicitly first |
| Trusting our own prior audits | everywhere | Two were wrong (audit §0.2); re-verify before relying |
