# SWF BUZZ — PHASE 4 FINAL QA REPORT

Run date: 2026-09-25 (13:50–16:40 local). Evidence logs: session scratchpad
`runs/` (per-file vitest JSON + console logs for every run cited below).

## 1. Overall Status

**NOT CLOSED — PHASE 4 CANNOT BE ACCEPTED ON A MOVING CODEBASE.**

The application work QA could verify is green, and QA found and fixed four
real defects. Final acceptance is blocked for two reasons that QA cannot
resolve on its own:

1. **Concurrent modification.** A second local Claude session (`buzz-4b`)
   edited 13 source files during the final runs (15:24–16:31), including
   channel-history transport: new `src/services/relayBridgeQuery.ts`, and
   `MessageService.ts` / `useChannelMessages.ts` rewritten (+458 lines). That
   is the 4A-bis HTTP-bridge history, which is recorded as documentation-only,
   so it amounts to reopening 4A. Run 4 caught a regression from it (§12).
2. **Open parity gap.** OLD BUZZ source shows that DM read state goes through
   NIP-RS kind:30078. SWF keeps DM read state session-local (§6).

Even ignoring those, human QA of the responsive and accessibility behaviour
of authenticated surfaces is still required (§9–10).

## 2. Phase 4A
Not reopened by this QA. Pagination and reconnect repair re-verified live
(`messagingCorrectness`) in runs 2, 3 and 4. **Warning:** 4A code is being
modified concurrently by another session (see §1). That change is untested
here, and run 4 shows it failing one live spec.

## 3. Phase 4B
IMPLEMENTED + VERIFIED. `messageEditDelete` 7/7 live, runs 2/3/4. Run 1 FAIL
was environmental: relay OK latency, channel persisted in DB (see §12). Thread
reply edit, self-delete and admin-delete also verified live (`threadMedia`).

## 4. Phase 4C
### Read State
IMPLEMENTED + VERIFIED. `readState` 7/7 live, runs 1–4:
- kind:30078, NIP-44 sealed, 32-hex slot;
- a second identity cannot read it;
- cross-device merge is grow-only;
- a malformed event is ignored.

`publishedFrontier` rewind protection: unit-pinned
(`readStatePublishFrontier.spec.ts`). Keys: NIP-44 in Rust, egress guard on
the plaintext.

### Search
IMPLEMENTED + VERIFIED, real relay (new). `searchInbox` 6/6, runs 1–4:
- an accessible hit is found;
- a private-channel message is found by its author but not by a non-member
  (both halves asserted);
- `fetchEventsOnce` one-shot with debounce;
- no client allowlist (unit asserted).

The spec had never run before this QA. It had a lint error and a wrong
assertion field; both were fixed.

### Inbox
IMPLEMENTED + VERIFIED, real relay (new):
- **mentions:** delivered.
- **Inaccessible channel:** a mention inside a private channel does not reach
  a non-member's inbox. The positive control is asserted in the same test.
- **activity / agent_activity:** partitioned with no overlap and no duplicates.
- **needs_action:** accepted and scoped: only 46010/40007 rows tagged with the
  caller. A positive row is not producible from a client, because workflow
  events are relay-emitted.
- **Non-member:** refused with a 401/403, which maps to `permission_denied`.

## 5. Phase 4D
### Attachments
Verified live:
- image upload (PNG);
- generic file upload (text);
- NIP-92 imeta round trip;
- filenames with spaces;
- authorized Blossom GET returns the exact stored bytes as a `blob:` URL;
- anonymous GET refused;
- a signed GET from a non-member refused;
- audio refused by both client and relay;
- malformed imeta does not crash.

Unit-proven only:
- video upload (no MP4 fixture, no ffmpeg on the host);
- JPEG metadata sanitization;
- blob revocation on unmount;
- failed-fetch placeholder.

Source-verified: `MessageAttachments.vue` binds only resolved blob URLs, never
`attachment.url`.

**Precision on "private":** media GET requires community membership plus a
`t get` token (`media.rs:527-550`), NOT channel membership, and uploads are
not channel-bound. A private-channel attachment is protected from anonymous
users and non-members. A community member outside the channel could fetch it
only by obtaining the sha256 URL, which they never receive. This is relay
design (PROTOCOL-LIMITED), and it corrects an overstatement in the run state.

### Channel
Verified live (`threadMedia`: file on a channel message).

### Thread
Verified live (`threadMedia`: image on a thread reply).

### DM
Verified live (`dmAttachments` 3/3, runs 1–4).

### Voice Notes limitation
PROTOCOL-LIMITED. The relay refuses audio (`validation.rs:198-207`). No
recorder or button exists.

## 6. Phase 4E — DM
IMPLEMENTED + VERIFIED live (`dmLiveRelay` 2/2, `dmAttachments` 3/3):
- open, dedup and discovery;
- history;
- edit/delete with backfill after reconnect;
- two identities;
- kind:41010 + kind:9;
- no NIP-17.

kind:41011 has no live test (IMPLEMENTED, source-verified in relay
`command_executor.rs:431-566`). DM admin-delete is not applicable: a DM has
no channel-admin role.

**DM read state — FAIL (parity gap, NOT a protocol limitation).** OLD BUZZ
desktop stores DM read state in the same NIP-RS kind:30078 `contexts` map,
keyed by the DM channel UUID (`desktop/src/features/channels/useUnreadChannels.ts:320-349`
→ `readStateManager.ts:334`, with no DM filter). SWF uses session-local
`stores/dmReadState.ts`. The run state's "DMs need their own slot allocation"
premise is contradicted: they share contexts. Not converted, per instruction.

## 7. Phase 4F — Presence/Typing
**Typing:** IMPLEMENTED + UNIT-PROVEN. The timer-count test is still valid:
3 timers before cleanup, 0 after, and it fails without the fix.

**Presence:** IMPLEMENTED, **no dedicated unit test and no live test**. The
run state's "unit-proven" covers typing only.

Subscription audit: all 10 live composables pair subscribe with close on
unmount. Timer audit: 4/4 intervals cleared.

## 8. Phase 4G — Hardening/Security
**FIXED — latent key-derivation exposure.** `SECURITY.md` promised that
`DevSigningService` throws outside dev builds; that guard was never
implemented. Its `forLocalIdentity` sets a user's Nostr secret to
SHA-256(prefix + Okta `sub`), and two production paths reach it: silent
resume in the router, and "Continue with Okta" on `/invite/:token`. In any
Okta-configured production build, anyone knowing a user's `sub` could derive
their key. The current build has Okta unconfigured, so it was not exploitable
here. The guard was added and pinned by 2 unit tests, which fail without it.
The production bundle still boots (headless check).

Otherwise verified:
- No nsec/ncryptsec literals in the bundle or repo.
- Storage holds no key material.
- The only frontend nsec is the one-time creation reveal; a Debug-redaction
  test exists.
- NIP-42 socket binding (live).
- NIP-98 (inbox and bridge, live).
- A non-member is refused (live).
- Operator ≠ owner: the operator shows "deployment-level access, not a member
  or owner" in the real window.
- Capabilities are role-derived.
- Message permissions are per-message.

## 9. UI Responsive QA
Real Tauri window, programmatic resize, Operator Dashboard only (the signed-in
surface on screen):
- 1710, 1440, 1280, 1024, 768, 430 and 375: no horizontal overflow.
- **FIXED:** community hostnames clipped at 375. Re-verified in the real
  window after the fix.
- Dev-only diagnostics pill overlaps "My identity" at ≤430. Not shipped.
- `minWidth: 960` does not stop programmatic resize, so narrow widths are
  reachable.

**Login card at ≤430 — NOT VERIFIED:** it requires signing out of the live
session. All authenticated chat surfaces: **HUMAN QA REQUIRED**.

## 10. Accessibility QA
**HUMAN QA REQUIRED.** No keyboard walkthrough was performed. Aria and
Escape/focus-trap guards are unit-level only.

## 11. Real Relay E2E Matrix
| Area | Result |
|---|---|
| Non-member refused (NIP-42) | PASS |
| Owner/member role resolution | PASS |
| Read state (7) | PASS |
| Search + inbox (6) | PASS |
| Pagination + reconnect | PASS (runs 2–4; run 1 PASS) |
| Edit/delete/admin delete (7) | PASS (runs 2–4; run 1 env FAIL) |
| Private-channel add member | PASS (runs 2–3); **FAIL run 4** (concurrent change); run 1 env FAIL |
| Threads + channel/thread media + reactions (5) | PASS |
| DM (2) + DM attachments (3) | PASS |
| Moderation (3) | PASS |
| Operator-gated specs (liveRelay ×4, reactions) | NOT RUN — TEST-INFRA: OPERATOR_A owns 5/5 communities |
| Presence/typing live | NOT RUN |
| Responsive/a11y authenticated | HUMAN QA REQUIRED |

## 12. Automated Test Results
Final series (all fixes in):

| Run | Result | Exit code | Details |
|---|---|---|---|
| Run 1 | FAIL | 1 | Unit 1019/1019. 9/11 live. `messageEditDelete` and `privateChannelMembers` "publish timed out": relay OK arrived after nostr-tools' 4.4 s; DB confirms both channels were created, with 1.2–1.6 s insert lag, against 0.04–0.12 s earlier. Environmental, during the concurrent session's activity. |
| Run 2 | PASS | 0 | Unit 1023/1023. 11/11 live. |
| Run 3 | PASS | 0 | Unit 1023/1023. 11/11 live. Foreign edits landed mid-run (16:00–16:03). |
| Run 4 | STOPPED | — | Unit 1032/1032. 7/7 live green, then `privateChannelMembers` FAIL: HTTP 403 `relay_membership_required` from the new, concurrently added `relayBridgeQuery.ts`. |

Unit counts grew 1019 → 1023 → 1032 because the other session added tests
between runs. **Three consecutive green runs on identical code: NOT ACHIEVED.**

Earlier attempts were superseded by QA's own fixes. One of them found the
`fetchEventsOnce` crash: 1016/1016 passed, but the run exited 1 on an uncaught
exception.

## 13. Build Gates
Final snapshot, 16:32:

| Gate | Result |
|---|---|
| Typecheck | PASS (0) |
| Lint | PASS (0) |
| Build | PASS (0) |
| Cargo | check PASS (14:0x); test 78/78 PASS (16:33) |
| Encoding | PASS: 424 files, 0 BOM, 0 mojibake |
| Secret scan | PASS |

Not gated: 21 type errors in 13 test files (stale fixtures; tsconfig covers
`src/` only).

## 14. Remaining Limitations
- Voice notes are unsupported by the relay.
- DM read state is session-local. This is a **parity gap**: OLD BUZZ uses
  NIP-RS for DMs.
- Mark-unread is device-local; NIP-RS is grow-only and `ov_*` is not built.
- Media privacy is community-scoped, not channel-scoped (relay design).
- Operator-gated specs are quota-blocked. This is test infrastructure.
- A publish timeout is reported to users as "wasn't accepted by the server"
  even when the relay applied it. This is a UX finding and was not changed.
- `liveRelay` test 17 uses a stale numeric cursor; it is operator-gated and
  does not run.
- Responsive/accessibility need the real desktop window.

## 15. Final Phase 1–4 Acceptance Matrix
| Area | Classification |
|---|---|
| P1 identity create/import/login/logout, secure storage, NIP-42, no key leakage | IMPLEMENTED + VERIFIED (live auth; scans; Rust 78 tests) |
| P2 Tauri signing, NIP-44, backup/import (ncryptsec) | IMPLEMENTED + UNIT-PROVEN (Rust) |
| P2 profile/onboarding, deep links | IMPLEMENTED + UNIT-PROVEN; HUMAN QA REQUIRED (UI) |
| P2 operator ≠ owner | IMPLEMENTED + VERIFIED (live resolution; real window) |
| P3 community creation / owner assignment | TEST-INFRASTRUCTURE LIMITATION (quota) + UNIT-PROVEN |
| P3 membership, role resolution | IMPLEMENTED + VERIFIED |
| P3 invites / claim | IMPLEMENTED + UNIT-PROVEN (no list/revoke: relay) |
| P3 channels, private channels | IMPLEMENTED + VERIFIED (run 4 regression from concurrent change: FAIL pending) |
| P3 messaging, threads, reactions, mentions | IMPLEMENTED + VERIFIED |
| P3 presence | IMPLEMENTED — not unit- or live-proven |
| P3 typing | IMPLEMENTED + UNIT-PROVEN |
| P3 DMs | IMPLEMENTED + VERIFIED |
| P4 pagination, reconnect | IMPLEMENTED + VERIFIED (4A under concurrent change) |
| P4 edit/delete/admin delete | IMPLEMENTED + VERIFIED |
| P4 read state | IMPLEMENTED + VERIFIED |
| P4 search, inbox | IMPLEMENTED + VERIFIED |
| P4 attachments, DM attachments | IMPLEMENTED + VERIFIED (video: UNIT-PROVEN) |
| P4 voice notes | PROTOCOL-LIMITED |
| P4 DM completion | IMPLEMENTED + VERIFIED; DM read state **FAIL (parity gap)** |
| P4 hardening/security | IMPLEMENTED + VERIFIED (after the guard fix) |
| Responsive / accessibility | HUMAN QA REQUIRED |

## 16. Exact Next Action
1. **Freeze the tree.** Stop or finish the `buzz-4b` session, and decide
   whether the HTTP-bridge history rewrite stays. If it stays, it is 4A work
   and must pass `privateChannelMembers` (the 403). If not, revert it.
2. **Decide on DM read state.** Implement the NIP-RS path (the DM channel
   UUID as a context in the existing frontier), or explicitly accept it as a
   Phase 5 gap.
3. On the frozen tree, re-run `node <scratchpad>/qa-three.cjs` (three
   consecutive runs, about 70 minutes).
4. Human QA in the desktop window, using the checklist in
   `PHASE_4_RUN_STATE.md` §Responsive, plus the login card at 430/390/375
   (sign out first).
