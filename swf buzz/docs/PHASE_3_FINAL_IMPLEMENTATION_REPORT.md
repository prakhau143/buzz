# Phase 3 — Final Implementation Report

Covers the identity / operator-role / onboarding hardening pass (2026-09-22) and restates Phase 3's
honest status after it. Companions: `PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md` (what the protocol is),
`PHASE_3_CHAT_UI_DESIGN.md` (what the UI should be), `PHASE_3_IMPLEMENTATION_AUDIT.md` §18–§20 (the
earlier passes), `IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md` (the lifecycle this pass extends),
`SWF_ROLE_MODEL.md`, `DECISIONS.md` D12–D14.

**Phase 3 is PARTIAL and is not claimed otherwise.** The protocol and identity layers are verified
against the real relay; the 3.9 UI surface (Inbox, message edit/delete, composer affordances) and
the GUI-only verification (responsive at six widths, unread/mention badges, the new create-identity
screens in a real window) are not done. Nothing here is marked PASS on the strength of a mock.

---

## 1. Executive summary

The reported symptom was "import the operator key, get the member UI". This pass did not start by
guessing at it: it first made the runtime observable (Part A1), then read the evidence.

What the evidence showed, and what changed:

1. **Nothing recorded who signed the operator probe.** `operatorService.isOperator()` returned a
   bare boolean and swallowed every failure, so "403", "network error" and "signed by the wrong
   key" were indistinguishable — all three became "not an operator", i.e. the member UI. Added
   `probeOperator()`, which returns `{status, signerPubkey, error, origin}`, and a diagnostics store
   + dev-only panel that surface it (§13, §17 of the lifecycle doc).
2. **A signer/identity mismatch fell through to "member".** `resolveAccess` now compares the signed
   NIP-98 event's pubkey with the identity being signed in and returns a `mismatch` decision:
   explicit error, signer cleared, nothing routed (§9). Previously the app would have routed on
   another key's answer.
3. **Create-identity had no backup checkpoint.** It generated a key and went straight on. Replaced
   with an explicit state machine that generates only after a passphrase, *shows* npub/nsec/ncryptsec
   once, and requires two acknowledgements before any relay authentication (§5).
4. **Role checks were scattered.** Added one capability model (`capabilities.ts`); the sidebar now
   gates on it. Operator ≠ owner is enforced structurally, not by convention (§8).
5. **Community selection could be inherited.** The persisted "last opened community" is now cleared
   on session teardown, so the next identity's community is decided for its own pubkey (§7).

On the live relay, with a temporary throwaway operator (added alongside the real key, reverted and
verified — §19), the real `resolveAccess` routed an operator to `/operator` (probe 200, signed by
that key) and a member into the community (probe 403), three times, with no restart, and refused a
deliberately mismatched signer. So the routing path itself is correct once the evidence is read
properly.

**And the new audit log then answered the original report directly — see §1a. The key being
imported is not the operator key.**

## 1a. The reported symptom, diagnosed from the new audit trail

Within minutes of relaunching on this build, the Rust audit line (new this pass) recorded, on the
real device, an actual import performed in the app window:

```
swf-buzz: identity resolved — storage=system-keyring, recovery=none, pubkey=7e13d4f6…a9c15702
swf-buzz: identity removed from this device — was pubkey=7e13d4f6…
swf-buzz: identity imported  — storage=system-keyring, pubkey=7e13d4f6938d2cd7355161d7c973c36dbcf8fd8924201d146cb27d99a9c15702
swf-buzz: identity removed from this device — was pubkey=7e13d4f6…
swf-buzz: identity imported  — storage=system-keyring, pubkey=7e13d4f6938d2cd7355161d7c973c36dbcf8fd8924201d146cb27d99a9c15702
```

Filled into the requested diagnostic block:

```
Imported pubkey:            7e13d4f6938d2cd7355161d7c973c36dbcf8fd8924201d146cb27d99a9c15702
Expected operator pubkey:   0f61e5e47ca8c4e22c64bab3a1163989a4e3a2d45d014e3d153f1c15b2320029
Pubkey match:               NO
NIP-98 signer pubkey:       7e13d4f6…  (the signer is the imported key — no signer mismatch)
NIP-98 response:            403 expected for this key (it is not in RELAY_OPERATOR_PUBKEYS)
platformRole:               null
Community role:             member  (7e13d4f6… is a `member` of kwikster.localhost:3000)
Final route:                the member/community flow
Stale previous identity:    NO — the import genuinely replaced the stored key; it is simply the same key
```

**Classification: "Pubkey match = NO" — a key/configuration fact, not a UI bug.** The private-key
backup being imported derives to `7e13d4f6…`, which is the *member* identity, so the relay correctly
refuses its operator probe and the app correctly shows the member UI. The relay's configured
operator is `0f61e5e4…`; the database confirms `0f61e5e4…` is `owner` and `7e13d4f6…` is `member` of
the same community, i.e. two genuinely different people.

Per Part B this pass did **not** provision a new operator or change the relay: the fix is to import
the private-key backup that actually derives to `0f61e5e4…` (its `nsec` / hex / `ncryptsec` —
`swf-buzz-identity-0f61e5e4.ncryptsec` per the Phase 2.1 audit). An `npub` cannot be used and
nothing can be derived from one. If that private key is genuinely unavailable, Part B's provisioning
process applies — generate a new keypair, add only its **public** key to `RELAY_OPERATOR_PUBKEYS`,
restart, then import the matching private key — and that is a decision for the operator, not
something to do automatically.

The repeated `removed → imported` pairs in the log are also the answer to the earlier "8×
identity removed" question: each pair is one sign-out (which now deletes the key, per D13) followed
by one import. It is not a retry loop — `delete_identity` is called once per sign-out.

## 2. Identity lifecycle

Unchanged from the P0 pass and preserved deliberately: `beginIdentitySession` /
`endIdentitySession` / `endIdentitySessionAndRemoveIdentity`, the three consistency checks
(`session.pubkey`, the signer registry, `connection.authenticatedPubkey`), `connectGeneration`,
identity-scoped Vue Query keys, `queryClient.clear()` on teardown, separate `platformRole` and
`communityRole`. This pass added the mismatch guard, the diagnostics trail, and the active-community
reset inside the same functions — no parallel lifecycle was introduced.

## 3. Sign-out deletion

Unchanged (`DECISIONS.md` D13): sign-out ends the session **and** removes the identity from the
device via Rust `delete_identity`, verified by re-resolution; on failure the session still ends and
the login screen says the identity is still stored and offers a retry. Re-verified live this pass:
after each sign-out, `get_identity()` reports none, the signer throws, the socket is closed, caches
are empty and `lastOperatorProbe` is cleared.

## 4. Import flow

Unchanged in security terms: nsec / 64-char hex / ncryptsec(+password), decoded in Rust; `npub1…`
refused with the exact message in `identityApi.NPUB_REJECTED_MESSAGE` and nothing derived from it.
"Switch / Import another identity" still tears the session down *before* Rust swaps the key.
New: every import/replace/create/delete logs the resulting **public** key to the `tauri dev` stderr,
so the audit trail no longer stops at app start.

## 5. Create-identity onboarding (new)

`CreateIdentityFlow.vue` + Rust `create_identity_with_backup`:

```
BACKUP_PASSWORD → GENERATE_IDENTITY → IDENTITY_BACKUP_REVEAL → BACKUP_CONFIRMATION → (sign in)
```

- The passphrase (≥ 12 chars, confirmed) is validated **before** Rust is asked; a refusal leaves the
  device untouched.
- Rust generates only if no identity exists, persists it, encrypts it (NIP-49) and returns the
  one-time reveal `{pubkey, npub, nsec, ncryptsec}`.
- The reveal screen shows the public identity, the private key behind **Show** (hidden by default),
  and the encrypted backup with **Copy backup** / **Download backup**.
- Continue is disabled until both boxes are ticked: "I have securely stored my identity backup." and
  "I understand that losing it may prevent me from signing in again."
- **No relay authentication and no routing happen before that confirmation.** Leaving early warns
  once and returns to STATE 2 without signing in.
- The `nsec` lives only in that component's local value and is cleared on confirm/leave/unmount;
  tests assert it never reaches a store, the emitted events or the DOM afterwards.

## 6. Operator authentication

`GET /operator/communities/availability`, NIP-98-signed, built in exactly one place
(`OperatorService`, asserted by `identitySecurity.spec.ts`). `probeOperator` reports the status and
the signing pubkey; `isOperator` is `status === 200`. The relay is authoritative — nothing local
infers operator status, and `OperatorDashboardView` re-probes on arrival.

## 7. Community roles

`relay_members` (kind:13534 snapshot) after NIP-42, resolved per community for the current pubkey.
`discoverMemberships` re-probes every known address with the active signer on each sign-in. The
persisted active community is cleared on teardown so no selection is inherited across identities.

## 8. Permission model

`src/features/access/capabilities.ts` is the single mapping from the two planes to UI capabilities
(table in the lifecycle doc §10). Operator capabilities never come from a community role and vice
versa. Message edit/delete/admin-delete are intentionally absent — no receive-side support exists,
and a button that cannot work is worse than no button.

## 9. Routing

One decision function, `resolveAccess(pubkey)`:

| Evidence | Route |
|---|---|
| probe signed by this pubkey, 200 | `/operator` (regardless of community role) |
| probe 403, exactly one membership | open that community |
| probe 403, several memberships | `/communities` picker |
| probe 403, none | `/welcome` |
| nothing answered | stay signed out with the connection error |
| probe signed by a *different* pubkey | **mismatch** — error, no route |

No component decides operator status independently; nothing derives a role from a URL, a hostname, a
selected community, a cached flag or a previous session.

## 10. Cache isolation

Unchanged and re-verified: all query keys are `["identity", <pubkey>, …]`, `queryClient.clear()` on
every teardown, and the Pinia stores (`session`, `access`, `connection`, `ui`, `readState`,
`dmReadState`, `agentActivity`, and now `diagnostics`) all reset. The dev panel reports "Stale
previous identity: YES/NO" by comparing every live holder against `session.pubkey`.

## 11. Relay lifecycle

Unchanged: `disconnect()` unsubscribes, closes and bumps the connect generation so an in-flight
connect or a pending reconnect cannot revive a previous identity's socket. `beginIdentitySession`
sets the active community immediately before connecting, so HTTP helpers address the same community
the socket is in.

## 12. NIP-42 verification

Unchanged: `connection.authenticatedPubkey` comes from the **signed AUTH event**, and
`beginIdentitySession` refuses a session whose AUTH was signed by another key. "Connected" is never
read as "authenticated".

## 13. NIP-98 operator verification (new evidence)

`buildNip98Auth` returns the signed event's pubkey alongside the header; `buildNip98AuthHeader`
remains for callers that don't need it. Every operator probe records
`{forPubkey, signerPubkey, status, error, origin}`. This is what makes the four-way decision table
in §9 possible instead of one boolean.

## 14. UI changes

- `LoginView`: STATE 1 is exactly "SWF Buzz" + "No identity is stored on this device." +
  [Import existing identity] [Create new identity] + Development-only; STATE 2 keeps "Identity found
  on this device." + fingerprint + [Continue with this identity] [Switch / Import another identity];
  STATE 3 (switch) unchanged, with its explicit tick and the post-switch progress list.
- `IdentitySetup`: "Create new identity" now hands over to the backup checkpoint instead of
  generating a key on the spot.
- `CreateIdentityFlow.vue` (new): the four onboarding screens above.
- `AppSidebar`: create-channel, create-community and the Operator Dashboard link are capability-gated
  (hidden, not disabled, when not permitted); both role badges remain separate.
- `IdentityDiagnosticsPanel.vue` (new, dev-only).

## 15. Tests

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings 0`) | pass, 0 warnings |
| `npm run build` | pass (built in ~11s) |
| `npm run test` (Vitest) | **59 files, 581 passed, 0 failed** (+15 this pass) |
| `cargo clippy --all-targets -- -D warnings` (src-tauri, backend) | pass, 0 warnings |
| `cargo fmt` | applied |
| `cargo test --lib` | **src-tauri 68 passed** (+3), **backend 35 passed** |
| `npx vitest run --config vitest.e2e.config.ts` (temporary operator) | **2 files, 6 passed, 0 failed** |
| same, with the operator config reverted | 1 passed, 5 skipped by design |

New tests this pass: `tests/unit/access/capabilities.spec.ts` (6), the mismatch + probe-evidence
cases in `useAuth.spec.ts` (2), `probeOperator` in `OperatorService.spec.ts` (1), the create-identity
checkpoint cases in `loginView.spec.ts` (3) and `onboardingUi.spec.ts` (3 + 1 rewritten), the probe
URL / mismatch / diagnostics assertions in `identitySecurity.spec.ts` (1), and three Rust tests in
`identity/commands.rs`.

## 16. Live E2E

Real relay (`ws://localhost:3000`), real NIP-42/NIP-98, no mocks. New block: "resolveAccess:
operator vs member routing, probe evidence, signer mismatch, A → B → A ×3", which drives the app's
own `resolveAccess` — the exact function Continue/Import run.

Per cycle (×3, no restart, sign-out-with-removal between every step):

| Step | Verified |
|---|---|
| A (member) signs in | `platformRole=null`; probe **403** signed by A, `forPubkey`=A; membership role `member`; decision opens the community |
| A opens the community | NIP-42 AUTH pubkey = A; `communityRole=member`; capabilities: no operator dashboard, no create-community |
| A signs out + removed | device holds no identity; session/roles/access/diagnostics cleared; signer throws |
| B (operator) signs in | probe **200** signed by B; `platformRole=operator`; decision `route → operator`; `access.isOperator` true |
| B opens the community it owns | AUTH pubkey = B; `communityRole=owner` **and** `platformRole=operator`, held separately; capabilities include deployment + member management |
| B signs out + removed | as above |
| Mismatch (signer A, signing in B) | decision `mismatch`; no route; `platformRole` null; `access.isOperator` false; recorded in diagnostics |

Also still passing in the same run: the full Phase 3 flow (channels, messages, realtime, threads,
reactions, pagination, forced reconnect), the 13-row switching matrix, the shared-device sign-out
block, and the reactions `#h` evidence test. Every logged line is public information — asserted to
contain no `nsec`/`ncryptsec`.

## 17. Known limitations

1. **GUI-only verification is outstanding** — responsive layout at 1440/1280/1024/768/390/375, the
   unread/mention badges, the new create-identity screens and the diagnostics panel have not been
   seen in a real window. No GUI automation is available to this process.
2. **3.9 UI remains PARTIAL** — no Inbox view; no message edit/delete/admin-delete (no receive-side
   protocol support); composer attachment/voice/formatting/emoji-picker not built.
3. **Reaction removal** is not fanned out to other clients in realtime by the relay (documented
   relay limitation, unchanged).
4. **Rust `delete_identity` against the real OS keyring** is unit-tested only; the desktop
   sign-out is the last confirmation (unchanged from the previous pass).
5. **The per-owner community cap** (5) is a real relay limit: repeated E2E runs need a fresh
   throwaway owner, which is why this pass rotated the temporary key once.
6. **Moderator** (the relay's other platform role) still has no client probe and is deliberately not
   represented.
7. `dmReadState` is reset per session but not pubkey-namespaced (in-memory only).

## 18. Files changed

**Rust** — `src-tauri/src/identity/commands.rs` (log_identity, `create_identity_with_backup`,
`CreatedIdentityReveal` + tests), `src-tauri/src/lib.rs` (command registration).

**TypeScript / Vue** — `src/services/nip98.ts` (`buildNip98Auth`), `src/stores/diagnostics.ts` (new),
`src/features/communities/OperatorService.ts` (`probeOperator`), `src/features/auth/useAuth.ts`
(mismatch guard, diagnostics, dev log), `src/features/auth/identitySession.ts` (diagnostics clear,
active-relay reset, platform-role mismatch rule, dev log), `src/features/access/capabilities.ts`
(new), `src/features/communities/relayCommunities.ts` (`clearActiveRelay`),
`src/features/identity/identityApi.ts` (`createIdentityWithBackup`),
`src/features/identity/ui/IdentityDiagnosticsPanel.vue` (new),
`src/features/onboarding/ui/CreateIdentityFlow.vue` (new),
`src/features/onboarding/ui/IdentitySetup.vue`, `src/views/LoginView.vue`,
`src/layouts/AppSidebar.vue`, `src/App.vue`.

**Tests** — `tests/unit/access/capabilities.spec.ts` (new), `tests/unit/auth/useAuth.spec.ts`,
`tests/unit/auth/identitySession.spec.ts`, `tests/unit/onboarding/loginView.spec.ts`,
`tests/unit/onboarding/onboardingUi.spec.ts`,
`tests/unit/features/communities/OperatorService.spec.ts`,
`tests/unit/security/identitySecurity.spec.ts`, `tests/integration/liveRelay.e2e.spec.ts`.

**Docs** — this file, `IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md` (§3, §3c, §3d, §10, §17),
`PHASE_3_IMPLEMENTATION_AUDIT.md` §21, `DECISIONS.md` D14, `SWF_ROLE_MODEL.md`.

**OLD BUZZ (`../buzz`)**: only `.env`'s `RELAY_OPERATOR_PUBKEYS`, temporarily, reverted — see §19.
No source file was touched.

## 19. Temporary operator configuration — and its revert

To run the operator-dependent E2E, a throwaway keypair was generated per run, its **public** key
appended after (never instead of) the real operator key in `../buzz/.env`, and the relay restarted.
The secret existed only in a scratch file outside the repository, was passed to the test process as
`SWF_E2E_OPERATOR_SK`, and was overwritten and deleted afterwards. Two keys were used because the
relay's per-owner community cap was reached mid-run.

Revert, verified three ways:
1. `../buzz/.env` is **byte-identical** to the copy taken before the first change
   (`RELAY_OPERATOR_PUBKEYS=0f61e5e4…320029`, single key, no BOM).
2. The relay was restarted on it and serves NIP-11 200; a freshly generated key's NIP-98 probe of
   the operator endpoint is refused.
3. Re-running the E2E config without `SWF_E2E_OPERATOR_SK` skips all operator blocks by design
   (1 passed, 5 skipped) — they cannot run against the reverted relay.

## 20. Final status matrix

```
PHASE 3: PARTIAL

Identity lifecycle:            PASS (live, this pass)
Sign-out deletion:             PASS (live orchestration; Rust keyring unit-tested)
Member → Operator switch:      PASS (live, ×3, no restart)
Operator → Member switch:      PASS (live, ×3, no restart)
Role isolation:                PASS (live: platform/community separate; capability model unit-tested)
Signer-mismatch guard:         PASS (live)
Create-identity onboarding:    PASS (implemented + unit-tested; NOT seen in a real window)
Channel creation:              PASS (live, unchanged)
Channel open:                  PASS (live, unchanged)
Messaging:                     PASS (live, unchanged)
Pagination:                    PASS (live, unchanged)
Threads:                       PASS (live, unchanged)
Reactions:                     PASS (protocol + #h fix live; realtime removal fan-out a relay limitation)
Unread/Mentions:               PASS (mention path live; unread local-only; badges need GUI eyes)
Agent activity:                PASS (type-level, unchanged)
Responsive UI:                 PARTIAL — implemented, never visually verified
Accessibility:                 PARTIAL — Escape/focus-visible/aria-live/aria-labels/focus trap; no keyboard walkthrough
3.9 UI surface:                PARTIAL — Inbox, edit/delete, composer affordances not built
Final desktop restart:         PASS (rebuilt and relaunched on this code; see §21)
Final smoke test:              PARTIAL — startup/identity resolution verified from the log; the
                               click-through (login → roles → channels → sign-out → STATE 1) needs a human
```

## 21. What needs a person

1. **Find the private-key backup that derives to `0f61e5e4…`** and import that (§1a: the backup
   currently being imported derives to `7e13d4f6…`, the member identity — which is why the member UI
   appears). After importing it, the dev diagnostics panel should read: Rust = session **YES**,
   probe **200** signed by `0f61e5e4…`, platformRole `operator`, route `/operator`. A 403 still
   means the imported key is not the configured operator.
2. Create a new identity and confirm the four screens read correctly, that Continue stays disabled
   until both boxes are ticked, and that "Download backup" writes the `.ncryptsec` file.
3. Sign out and confirm STATE 1 with no fingerprint.
4. Resize to 1440 / 1280 / 1024 / 768 / 390 / 375 and confirm no horizontal overflow.

---

## 22. Thread replies — live update in the panel, and replies out of the channel feed

Reported: (a) a reply sent from the thread composer appears in the channel feed but not in the
thread panel until it is closed and reopened; (b) replies render in the channel feed as if they were
new top-level messages.

### Bug 1 — root cause (exact)

`src/features/messages/useSendMessage.ts`, the pre-fix `send()` (lines 43–57): the optimistic
message and the relay-confirmed one were written **only** to `queryKeys.channelMessages(channelId)`.
The thread panel reads a different cache entry, `queryKeys.thread(rootId)` (`useThread.ts:10`), and
**nothing on the send path ever wrote there** — even when `input.reply` was set. The only writer was
the relay echo via `ThreadService.subscribeToThread` (`ThreadService.ts:58–78`), a separate
subscription with `since: now` that does not reliably deliver one's own event. Hence: instant in the
feed, absent in the panel, and present after a reopen because the panel refetches on mount.

A second, narrower defect on the same path: `useThread.ts:23` (`if (!current) return current`)
silently drops a live reply that arrives before the initial thread fetch resolves. Left as-is
deliberately — it is self-healing (the in-flight fetch includes the reply) and changing it would mean
inventing a cache entry for a thread that was never opened.

**Fix.** `send()` now mirrors every reply into its thread cache: optimistic insert (`status:
"sending"`), reconciliation with the confirmed event (dropping the optimistic copy, and not
duplicating if the live subscription delivered the same event first), and `status: "failed"` on
error with the content preserved for retry. Replies stay sorted by `createdAt`. A thread that has
never been opened is left untouched rather than fabricated.

### Bug 2 — fix

`src/views/ChannelsView.vue`: the feed now renders `topLevelMessages` (`!m.thread.rootId`) instead
of every message, and `useThreadSummaries` is fed the same filtered list. The summary row under each
parent ("N replies · View thread", already implemented) is how a thread is represented in the feed.
A reply whose parent is outside the loaded window stays hidden rather than being promoted to top
level.

### Tests

`tests/unit/features/threads/threadLiveUpdate.spec.ts` (9): optimistic reply visible in the thread
before confirmation; reconciliation without duplicates; no duplicate when the subscription wins the
race; failed state keeps content; out-of-order ordering; a non-reply never touches a thread; an
unopened thread is not fabricated; feed filtering excludes replies and nested replies; an orphan
reply is not shown top-level.

### Follow-ups NOT done (deliberately out of scope for this pass)

The reported bugs are fixed; the rest of the Slack-style threading brief is not built: stacked
participant avatars and last-reply time on the summary row, live summary-count updates without a
refetch (`useThreadSummaries` has no subscription — see its own doc comment), `?thread=<id>` route
state, "Also send to #channel", thread autofocus/auto-scroll/"New replies ↓" pill, per-thread unread
indicators, a followed-threads sidebar item, and full-screen thread on narrow widths. Efficient
reply counts already use one batched `#d` query for all visible roots (`ThreadService.fetchSummaries`).


### 22a. Thread summary row in the channel feed (Slack-style)

A parent message with replies now carries a summary row below its content and
reactions, aligned with the message text: the faces of up to 3 unique repliers
(most recent first, ~30% overlap, ringed in the feed background), the bold
accent-coloured count ("1 reply" / "2 replies"), and muted "Last reply 3m ago".
On hover/focus the row gains a bordered background, the time is replaced by
"View thread", and a `›` appears. It is a real `<button>` (Enter/Space, visible
focus ring, aria-label "2 replies, Last reply 3m ago., View thread"), and it
opens the same thread panel as the ↩ hover action. While a thread is open its
parent is tinted with an accent edge so the pairing is obvious.

**Data — which approach and why.** The channel feed query already loads replies
as well as top-level messages (it simply does not *render* the replies), so
`buildThreadSummaries()` indexes `rootId -> replies` over exactly the messages
the feed and the thread panel already share — one source of truth, no second
data path, and a new reply (including one's own optimistic reply) updates the
count, avatar order and time instantly with no request. For roots whose replies
fall outside the loaded window, the pre-existing `useThreadSummaries` already
batch-fetches the relay's own thread summaries for every visible root in ONE
request (`#d` takes many values); `mergeThreadSummaries()` combines the two,
taking the larger count and preferring locally-known participants/times. So
counts are correct on first render after a refresh, before any thread is opened,
without a per-message round trip. Relative times tick from a single 30s clock
owned by `MessageList` and passed down, rather than a timer per row.

Files: `src/features/threads/threadSummary.ts` (new selector),
`src/components/ThreadSummaryRow.vue` + `ThreadParticipantAvatar.vue` (new),
`MessageItem.vue` (replaces the old "💬 N replies" text button; parent tint),
`MessageList.vue` (shared clock, passes summaries + open-thread id),
`ChannelsView.vue` (merge), `features/identity/format.ts` (`relativeTime`, now
shared by timestamps and summary rows).

Thread panel, same pass: parent pinned at the top with an accent edge, a
"2 replies ———" divider before the replies, header reads "Thread · #channel",
and **Esc** closes it (`useEscapeKey`).

Layout fix: the dev-only identity diagnostics badge moved from bottom-**right**
to bottom-**left** (it covered the thread composer's input and Send button), and
sits above the composer below 768px.

Tests: `tests/unit/features/threads/threadSummary.spec.ts` (17 — count, unique
participants most-recent-first capped at 3, lastReplyAt, reply-to-a-reply
attaching to the root, update on a new reply, row appearing on the first reply
and disappearing at 0, optimistic replies, and every merge rule) and
`tests/unit/components/threadSummaryRow.spec.ts` (8 — labels, avatars, fallback,
button semantics/aria, click, open state, missing time, clock tick).

**Not built** (unchanged from §22's follow-ups): `?thread=<id>` route state,
"Also send to #channel", thread autofocus/auto-scroll/"New replies ↓" pill,
per-thread unread indicators, a followed-threads sidebar item, and full-screen
thread on narrow widths. Scrolling the panel to the newest reply when an already-
open thread is re-clicked is also still open.


---

## 23. Clean development reset and operator re-bootstrap (2026-09-22)

Full record with every identifier, count and verification: **`DEV_RESET_2026_09_22.md`**.
Decision: `DECISIONS.md` D15. Nothing in this section supersedes the honest
limitations in §17 or §20 — the 3.9 UI surface, responsive and accessibility
items are unchanged and still PARTIAL.

**Why.** §1a diagnosed that `0f61e5e4…` is the operator's PUBLIC key and that
pasting it into the import field derives `7e13d4f6…` (a member). The operator's
private key is unavailable and cannot be recovered from the public key, so the
old operator was retired and a new one provisioned instead of weakening
authentication.

**What happened.** Environment proven local (loopback Postgres with a dev
password, `ws://localhost:3000`, no production/staging markers) → full
`pg_dump` + `.env` backups outside the repo → FK-ordered single-transaction
delete of all communities and scoped data (36 communities / 57 memberships / 29
channels / 497 events → 0; a first attempt aborted on `thread_metadata →
channels` and rolled back cleanly, after which the order was derived from
`pg_constraint`) → fresh OPERATOR_A and MEMBER_A keypairs generated and
round-trip verified → only OPERATOR_A's PUBLIC key written to
`RELAY_OPERATOR_PUBKEYS` → relay restarted → one development community created
through the real operator endpoint with an explicit `initial_owner_pubkey`,
MEMBER_A added by the owner, `#general` created, owner message posted.

**Proof against the real relay, with the real credentials.**

| Signer | NIP-98 probe | Resolved |
|---|---|---|
| OPERATOR_A private key | 200, signer = configured operator key | `platformRole: operator` → `/operator` |
| MEMBER_A private key | 403 | `communityRole: member` (NIP-42) → chat UI |
| OPERATOR_A PUBLIC hex misused as a secret | 403 (derives an unrelated identity) | the original mistake, now inert |

Operator ⇄ member switching ran **five transitions with no restart**, asserting
at each one: probe status and signer pubkey, both role planes, the routing
decision, capabilities, and — after every sign-out — identity removed from the
device, stores and query cache empty, signer unusable.

**Also this pass:** import-field wording now states what is accepted (nsec ·
private hex · ncryptsec) and that an npub or public hex cannot sign in, and the
raw-hex ambiguity warning was rewritten to say so plainly.

```
PHASE 3: PARTIAL  (unchanged — a clean dataset is not feature completeness)
Identity lifecycle / operator routing / member routing / role isolation: PASS (live, 5 transitions, no restart)
Community creation / channel creation / channel open / messaging: PASS (live, real relay)
Threads / Reactions / Pagination / Unread-Mentions: PASS (unchanged from §19–§22)
3.9 UI / Responsive / Accessibility / Inbox / composer affordances: PARTIAL (unchanged)
TESTS: Vitest 62 files / 614 passed / 0 failed; typecheck / lint (0 warnings) / build pass;
       cargo clippy -D warnings clean; cargo test --lib src-tauri 69, backend 35;
       live relay E2E clean-bootstrap block 1/1
RELAY_OPERATOR_PUBKEYS: 38eb252a…463f2ca8 (OPERATOR_A public key only)
```

**Still needs a human at the window** (no GUI automation available here): import
OPERATOR_A and confirm Check-key shows `npub18r4j22…q4q2mh` before importing;
sign out to STATE 1; import MEMBER_A and confirm the member UI with the Operator
Dashboard hidden; and paste OPERATOR_A's public hex to confirm Check-key shows a
different identity with the ambiguity warning.


---

## 24. Final root-cause fix: raw hex is no longer a login credential

§1a and §23 diagnosed the symptom twice; this section removes the class of
mistake rather than the instance. Decision: `DECISIONS.md` D16.

### Why a public key kept becoming a different identity

```
64-char hex entered  →  parsed as a PRIVATE scalar  →  derive public key  →  a DIFFERENT identity
```

A Nostr private key is 64 hex characters. A Nostr **public** key is also 64 hex
characters. They are **cryptographically indistinguishable by format** — no
length check, regex, or curve test can reliably say which one a user meant. So
pasting a public key never failed; it silently produced an unrelated identity,
which the relay then correctly refused (403) and the app correctly rendered as a
member. Observed twice with real keys:

| Pasted (a PUBLIC key) | Silently signed in as |
|---|---|
| `0f61e5e4…320029` (old operator) | `7e13d4f6…15702` |
| `38eb252a…3f2ca8` (new operator) | `ff93c238…655651` |

The fault was never operator routing — routing was correct given the identity it
was handed. It was the **credential contract**.

### Import contract — before and after

| | Before | After |
|---|---|---|
| `nsec1…` | accepted | accepted |
| `ncryptsec1…` (+password) | accepted | accepted |
| raw 64-char hex | **accepted as a private key** | **refused** on the normal path; developer opt-in only |
| `npub1…` | refused | refused (wording improved) |

Enforced in **both** layers, not just the UI: `backup::recover_keys_from_input`
now takes `allow_raw_hex` and returns `RAW_HEX_REJECTED` when it is false, so
the rule holds even if a caller bypasses the form. `import_identity`,
`replace_identity` and `preview_identity_input` all thread the flag through and
default it to `false`.

The UI refuses hex **before decoding anything**: Check key is disabled, Rust is
never called, no preview appears, nothing is stored. An `npub` is refused the
same way with "This is a public identity key. A public key cannot be used to
sign in." A developer checkbox (shown only when the input *is* bare hex) opts
into the old behaviour with an explicit warning, and still requires Check key →
identity preview → Import.

**Check key remains a pure validation step** — it decodes, derives the public
key, returns a preview. It does not store, write the keyring, start a session,
connect the relay, set a role or change the route. Only Import identity commits.

### Community discovery 404 noise (§16 of the brief)

`POST http://acme.localhost:3000/query 404` (and five more) were **stale
address-book entries**, not authentication failures: communities deleted by the
reset that `discoverMemberships` re-probed on every sign-in. The relay answers
404 to an unknown `Host` by design (so communities cannot be enumerated), which
is materially different from 403 ("exists, you are not a member"). `probeMembership`
now distinguishes them — new `gone` outcome — and `discoverMemberships` removes
those addresses from the address book. A 403 address is kept; the build's home
relay is never forgotten (it may simply not be provisioned yet). No blanket
catch was added: the 404s stop because the stale entries stop being probed.

### Verification (real relay, real credentials)

| Input | Result |
|---|---|
| OPERATOR_A **public** hex | refused at the form — no decode, no preview, no import |
| OPERATOR_A **private** key | NIP-98 **200**, signer = configured operator key, `platformRole: operator`, route `/operator` |
| MEMBER_A **private** key | NIP-98 **403**, `communityRole: member` (NIP-42), member UI |
| operator ⇄ member ×5, no restart | every transition clean; no stale identity, roles, caches or route |

```
TESTS: Vitest 62 files / 620 passed / 0 failed; typecheck / lint (0 warnings) / build pass;
       cargo clippy -D warnings clean; cargo test --lib src-tauri 72 (+3), backend 35;
       live relay E2E clean-bootstrap 1/1
```

**Still requires the real desktop GUI** (no automation available here) — the
acceptance criterion stated in the brief: paste the operator public hex and see
it refused; import the operator `ncryptsec`/`nsec` and reach `/operator`; import
MEMBER_A and reach the member UI; switch back with no restart.

