# Phase 3 — Completion Checkpoint

**Date:** 2026-09-23
**Status:** **PARTIAL — not complete.** This document exists so that stays explicit.

Phase 3's protocol features are substantially implemented and must **not** be
rebuilt. What remains is verification and UI surface, tracked below.

---

## 1. Verified against the REAL relay

These ran against the running local buzz-relay with two real identities, not
mocks. A green unit suite is not accepted as evidence for any row here.

| Capability | Evidence | Status |
|---|---|---|
| NIP-42 authentication, both identities | both E2E specs connect and reach `status === "connected"` | ✅ |
| Community roster (`relay_members`, kind:13534) | `privateChannelMembers.e2e.spec.ts` asserts both keys are in the roster | ✅ |
| Channel creation (private) | same spec creates and rediscovers the channel | ✅ |
| Channel discovery | same spec, from both identities | ✅ |
| Channel membership add (kind:9000) | same spec: B added, appears in `fetchMembers` | ✅ |
| Channel membership is not duplicated | repeat add produces exactly one row | ✅ |
| Private-channel access control | B cannot see the channel before the add, can after | ✅ |
| Message send / receive across identities | B sends, A receives by event id | ✅ |
| DM open (kind:41010) | `dmLiveRelay.e2e.spec.ts` | ✅ |
| DM dedup from both sides | same spec | ✅ |
| DM receiver-side discovery | same spec | ✅ |
| DM history read by receiver | same spec | ✅ |

## 2. Implemented, but verified by unit tests only

Real-relay verification still owed. Not to be rebuilt — only confirmed.

| Capability | Where | Owed |
|---|---|---|
| Threads (NIP-10 markers, thread panel, summary rows) | `features/threads/*` | live reply round trip |
| Reactions add | `features/reactions/*` | live add across two clients |
| Reaction removal | `useRemoveReaction.ts` | live removal — **and a known defect, §4** |
| Mentions (`p` tags) | `MessageComposer.vue` | live mention indexing |
| Typing indicators | `protocol/typing.ts` | live delivery |
| Presence | `protocol/presence.ts` | TTL/heartbeat behavior |
| Agent activity | `features/agents/*` | live feed |
| Community member management | `community-members/*` | live role change |

## 3. Remaining Phase 3.9 work — not started

| # | Item | Notes |
|---|---|---|
| A | Responsive visual verification | desktop / tablet / mobile across the main views |
| B | Accessibility keyboard walkthrough | focus order, traps, labels, contrast |
| C | GUI smoke verification | a human path through the app, not a test runner |
| D | Inbox | **no implementation exists** — Phase 4C, server-aggregated feed |
| E | Message edit / delete / admin delete | **no implementation exists** — Phase 4B |
| F | Attachments | **no implementation exists** — Phase 4D |
| G | Voice notes | **no implementation exists** — Phase 4D |
| H | Rich formatting | composer is a plain `<textarea>` — Phase 4D |
| I | Full emoji picker / custom emoji | Phase 4D |

Items D–I are genuinely Phase 4 features by protocol dependency; they are listed
here only so "Phase 3.9 UI parity" is not silently declared done while they are
missing. Items A–C are Phase 3's own and can be done at any point.

## 4. Known defects carried into Phase 4

| Defect | Location | Phase |
|---|---|---|
| Reaction-removal live subscription omits `KIND_DELETION`, so removals never arrive live. The code comment blames the relay; the OLD BUZZ audit (§3) shows the relay *does* fan out kind:5 — the comment is wrong | `ReactionService.ts:152-166` | 4G |
| Two parallel thread stacks (`ThreadService` vs `ThreadServiceHttp`) | `features/threads/` | 4G |
| Pagination infers end-of-history from an empty page; no `before_id`, no kind:39006 | `MessageService.ts`, `useChannelMessages.ts` | **4A** |
| Reconnect re-runs the original filter with no gap repair — can silently lose messages | `RelayConnectionService.ts:290-292` | **4A** |
| Unread state is localStorage-only; no cross-device continuity | `stores/readState.ts` | 4C |

## 4b. P0 CONFIG CHECKPOINT — closed 2026-09-24

The roster/ownership drift is fixed at its source, not by hand-repair.

**Root cause:** `BUZZ_REQUIRE_RELAY_MEMBERSHIP` (the one and only variable —
single read site, `config.rs:670`) was unset and defaults to `false`. That one
flag gated roster publication on provisioning (`community_provisioning.rs:215`),
on ownership transfer (`operator.rs:438`), and **both** reconciliation jobs
(`main.rs:625`). `relay_members` and the kind:13534 roster the client actually
reads drifted apart with nothing to repair them.

**Not a one-line change:** `main.rs:319-337` makes the relay *refuse to boot*
with the flag on unless `RELAY_OWNER_PUBKEY` is also set. It was not set, so
enabling the flag alone would have taken the dev relay down.

**Applied** to `../buzz/.env` (backed up to `buzz-relay.env.backup-2026-09-24`):

```
BUZZ_REQUIRE_RELAY_MEMBERSHIP=true
RELAY_OWNER_PUBKEY=38eb252a…      # PUBLIC key; deployment-plane role
```

`RELAY_OWNER_PUBKEY` is bootstrapped as owner of the relay's own deployment
community (`localhost:3000`) only — per-community owners are untouched.

**Verified after restart:**

| Check | Result |
|---|---|
| Relay starts with the final config | ✅ `NIP-43 membership snapshots reconciled on startup count=5` |
| Community A `relay_members` | `07227e7a=owner`, `38eb252a=member`, `2dffa5eb=member` ✅ |
| Community A kind:13534 roster | identical roles ✅ |
| **kwikster** | 0 snapshots → 1; `07227e7a=owner` published ✅ |
| Community B | unchanged: `38eb252a=owner`, `2dffa5eb=admin`, `eb71ab85=member` ✅ |
| Fresh OWNER_A login → `resolveMyRole` | **`owner`** ✅ |
| Owner capabilities | manage / moderate / invite / open ✅ |
| Operator platform access | HTTP 200, retained ✅ |
| `relay_members == roster == resolveMyRole` | regression test, 3/3 ✅ |

**Flaky test found and fixed.** `navigationSurface.spec.ts > renders only the
Home link` failed intermittently — green alone, red in ~2 of 3 full runs. It was
**not** an assertion failure but `Test timed out in 5000ms`: the spec did
`await import("@/layouts/AppHeader.vue")` *inside* the test, so transforming
that SFC's module graph competed with the 5 s per-test budget under parallel
load. Moved to a static top-level import (module loading belongs outside the
test's budget). Confirmed with **4 consecutive full-suite runs, 697/697, exit 0**
— one green run does not clear a flake.

## 5. Fixed in this pass (P0)

| Fix | Location |
|---|---|
| Unresolved community role no longer collapses to `"member"` | `communityDiscovery.ts`, `Membership.role` is now `RelayMemberRole \| null` |
| Picker and operator dashboard render a role only when the relay published one | `CommunityPickerView.vue`, `OperatorDashboardView.vue` |
| Regression tests: unresolved ≠ member, and never any concrete role | `tests/unit/access/communityDiscovery.spec.ts` |
| False "OLD BUZZ has no read-state protocol" claim corrected | `stores/readState.ts`, `PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md:154` |
| False "kind:41011 unverified" claim corrected | `protocol/dm.ts`, `Kind41010Transport.ts` |
| Private-channel member picker now sources from community ∖ channel | `useChannelMemberPicker.ts`, `AddMembersModal.vue` |

## 6. Acceptance criteria — Phase 3 is complete when

1. Every row in §2 has a passing real-relay test.
2. §3 items A, B and C are done and signed off by a human.
3. §4 defects are either fixed or explicitly deferred with a phase assigned.

None of these is satisfied today. **Phase 3 remains PARTIAL.**
