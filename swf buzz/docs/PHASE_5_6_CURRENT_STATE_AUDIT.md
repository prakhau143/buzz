# SWF Buzz — Phase 5 + Phase 6 current-state audit

**Date:** 2026-09-28 (audit run 15:15–16:40 local).
**Method:** source + tests + test results produced during this run + the running Tauri app (read-only) + the local relay. Earlier reports were treated as history, not proof.

**Status legend:**
- **PASS** = verified during this run
- **PARTIAL** = implemented, but a required verification or a known limit remains
- **BLOCKED** = cannot be verified here (environment, credential or policy)
- **NOT IMPLEMENTED** = genuinely absent

## 1. Executive summary

SWF Buzz's protocol, messaging, security and Phase 6 session-model behavior is **verified by automated tests and a full real-relay E2E run on the current code**:
- 13/13 live files, 47 live tests, exit 0, including a new real A→B→A isolation test;
- unit suite green on every run;
- typecheck, lint, production build, cargo check and cargo test green.

What is **not** yet verified is human-facing:
- the keyboard/accessibility walkthrough;
- the full responsive matrix per screen;
- DM read→restart on the live community;
- a real network cut;
- release packaging (signed installer, and the code is not committed).

The audit found **no application defects**. It fixed 9 stale statements in 7 docs and added one live E2E spec.

**Two process findings:**
- **The repository has no commits for any of this work.** `main` is at the initial import; 305 paths are modified or untracked. That is the single biggest release-readiness risk.
- **Another session (`buzz-4b`) edited source during this audit (15:48–15:59):** switcher membership verification, navigation history, and new tests. Every gate in §10 was run against the tree **after** those edits.

## 2. Phase 5 status

| Area | Requirement | Automated evidence (this run) | Runtime evidence | Status |
|---|---|---|---|---|
| Identity | create / import nsec + ncryptsec / derive pubkey | Rust 78 tests (incl. `pasted_nsec_variants_resolve_to_the_same_identity`), `loginView.spec` 30 | App running on imported identity after restart | PASS |
| Identity | paste normalisation (whitespace, zero-width) | `backup.rs normalize_key_input` + test | — | PASS |
| Identity | switch / archive-on-replace / delete on sign-out / socket torn down first | `useAuth.spec`, `identitySession.spec`, E2E `liveRelay` 13-row matrix + sign-out ×3 (real relay) | — | PASS |
| Identity | key never in logs / UI / network / bundle | scans: 0 nsec/ncryptsec literals in dist/src/tests/docs; Debug-redaction test; `DevSigningService` prod guard test | — | PASS |
| Auth | NIP-42 on every socket; failed auth; membership refusal | every E2E file authenticates; `liveRelay` "refuses a fresh identity" | App "Connected" to live relay | PASS |
| Auth | NIP-98 HTTP | inbox / moderation / operator probe E2E; throwaway 200 vs random 403 | — | PASS |
| Roles | operator deployment-wide, ≠ owner; relay-derived roles | E2E `liveRelay` resolveAccess, `ownerRoleResolution` 3/3 | — | PASS |
| Community | connect existing; membership; role | E2E `communitySession` (real `resolveAccess` + probe), unit | Live community loaded | PASS |
| Community | leave community / leave channel | unit only | not exercised (would mutate live) | PARTIAL |
| Community | archived hidden | `channelVisibility.spec` 7 | Tauri: "LMD All Members huddle" absent | PASS |
| Community | deep links (hostile) | Rust `hostile_or_malformed_links_are_rejected` + deeplink tests | — | PASS |
| Messaging | send / receive / pagination / same-second / dedup / gap repair | E2E `messagingCorrectness`, `threadMedia` (reconnect), unit | Live history visible | PASS |
| Messaging | edit / self delete / admin delete | E2E `messageEditDelete` 7/7 | — | PASS |
| Messaging | threads / reactions / mentions | E2E `threadMedia` 5/5, `reactions` 1/1 | — | PASS |
| Read state | kind:30078, NIP-44, grow-only, no rewind published | E2E `readState` 7/7; `readStatePublishFrontier.spec` | — | PASS |
| Read state | hydration gate, catch-up, dedup, DM = channel model | `readStateRestartCatchUp.spec` 13 | Tauri: no DM falsely unread after restart | PASS (code) |
| Read state | DM read → restart on the **live** relay | — | not performed (publishes read state; requires restarting your app while you use it) | BLOCKED → human QA |
| Search | NIP-50, relay access boundary, private-channel non-leak | E2E `searchInbox` 6/6, `communitySession` (no cross-community hits) | Palette opened with Ctrl+K in Tauri | PASS |
| Search | people / channels / DMs sections | `paletteModel.spec` | Palette groups seen in Tauri | PASS |
| Inbox | mentions / needs_action / activity partition / non-member refused | E2E `searchInbox` | — | PASS |
| Inbox | activity scoped to DM / p-tag / my threads | `inboxModel.spec` scoping cases (Poseidon-shaped) | — | PARTIAL (unit only; live feed not re-checked) |
| Inbox | no Agents / Projects filters | `inboxModel.spec`, `inboxView.spec`, `productBoundary.spec` | — | PASS |
| Attachments | Blossom upload, 24242 auth, sha256, imeta, authorized GET, anon + non-member refused, audio refused, malformed imeta | E2E `dmAttachments` 3/3 + `threadMedia` (channel, thread, DM) | — | PASS |
| Attachments | blob URL cleanup | `useAuthorizedMedia` revokes on unmount | — | PASS |
| Attachments | video | unit only | — | PARTIAL |
| Presence / typing | lifecycle, cleanup, timers | typing timer-count test; 10 subscribe sites paired with close; listeners balanced in every file; 8/8 intervals cleared | — | PARTIAL (presence has no dedicated test) |
| Security | scans, prod guard, isolation, deep links | as above | — | PASS |
| Network-cut recovery | reconnect + gap repair | E2E forced disconnect / reconnect (`messagingCorrectness`, `liveRelay`) | a real network cut in the desktop app not performed | PARTIAL |
| Tauri runtime | app builds, runs, signs via keyring | cargo check / test; app running | ✓ | PASS |
| Local real-relay E2E | full suite | 13/13 files, 47 tests, exit 0 | — | PASS |
| Live OLD BUZZ (read-only) | NIP-42, membership, community, channels, archived hidden, history | — | Tauri screenshots: Connected, channels, DMs, DM history, archived huddle hidden | PASS (observed) |
| Live OLD BUZZ | pagination on live | — | not exercised | PARTIAL |
| Live OLD BUZZ | buzzdev rejects the member identity | — | key lives only in your running app; driving it would interrupt your session | BLOCKED |

## 3. Phase 6 status

| Area | Requirement | Automated evidence | Runtime evidence | Status |
|---|---|---|---|---|
| Boundary | no huddle UI / commands / audio / WebRTC / 48100-48106 | `productBoundary.spec` (source guards) | — | PASS |
| Boundary | archived huddle channels hidden; live huddle not guessed | `channelVisibility.spec` | Tauri | PASS (live-huddle limit documented) |
| Boundary | no built-in / local / managed agents, no agent creation, no "X is working", no Agents/Projects filters | `productBoundary.spec`, `inboxModel.spec` | — | PASS |
| Boundary | external participants communicate normally | `externalParticipant.spec` | — | PASS |
| Boundary | kind:30177 "Agent" label | descriptive only (badge); no agent functionality | — | PASS (kept by decision) |
| Session | fresh login → Choose a community, no auto-connect | `useAuth.spec` A/C/E, `loginView.spec`; **E2E `communitySession` #1 (real relay)** | — | PASS |
| Session | sign-out → sign-in → Choose | `useAuth.spec` A/B/C/E | — | PASS |
| Session | app restart → Choose | `useAuth.spec` silent-resume tests | not observed in the real app | PARTIAL |
| Session | webview reload keeps the selection (sessionStorage), no cross-restart binding | `relayCommunities.spec` | not observed in WebView2 | PARTIAL |
| Session | recent communities never auto-connect | E2E `communitySession` #1 | — | PASS |
| Isolation | A → B → A, one identity | `communityIsolation.spec` + **E2E `communitySession` #2 (real relay: channels, cache, NIP-50)** | — | PASS |
| Switcher | current / connection / recent / Add; membership-verified list | `communitySwitcher.spec` (added by `buzz-4b`) | Rendered in Tauri | PARTIAL (no live switch performed) |
| Picker / connect UX | identity verified, recent, URL, stepper, retry, use another; error classes; real lifecycle progress | `communityConnect.spec`, `connectCommunityPanel.spec`, `operatorDashboardAndPicker.spec` | not rendered live this run | PARTIAL |
| Palette | Ctrl/Cmd+K, sections, permitted Create channel only, no agent creation | `paletteModel.spec` | **Tauri: Ctrl+K opened it, grouped sections, active row, ↑/↓ moved it, Esc closed only the palette** | PASS |
| Sidebar | channels, DMs, unread, lock/hash, aria-current, focus, archived hidden | unit | Tauri 1280 / 1024 / 375 | PASS |
| Unread | unified NIP-RS, gate, catch-up, dedup, policy | `readStateRestartCatchUp.spec` | see Phase 5 (live restart BLOCKED) | PARTIAL |
| Threads UI | parent, replies, composer, close | E2E thread logic | not visually audited | PARTIAL |
| Premium UI | message / DM / thread visual polish | — | not restyled | PARTIAL |
| Responsive | widths 1710 → 375 across every screen | — | 1024 fixed + verified; 375 drawer; 1280 / 1710 sidebar only | PARTIAL |
| Accessibility | Tab / Shift+Tab / Enter / Space / Esc, traps, focus restore, contrast | semantics in code; unit guards | palette keyboard only (above) | PARTIAL → human QA |
| Performance | listeners / timers / blob URLs / subscriptions | static audit clean | large-channel profiling not done | PARTIAL |
| Reconnect UX | — | E2E reconnect logic | no real network cut in app | PARTIAL |
| Release readiness | Windows installer, signing, commits | prod build OK | **no commits; no signed installer built** | PARTIAL |

## 4–7. Matrices by status

- **PASS:** every row marked PASS above.
- **PARTIAL:** leave community/channel (unit only), inbox scoping (unit only), video attachments, presence tests, network cut, live pagination, restart and reload runtime, switcher live, picker live render, unread live restart, threads UI, premium UI, responsive matrix, accessibility, performance profiling, reconnect UX, release readiness.
- **BLOCKED:**
  - DM read → restart on the live relay (publishes read state; needs your app restarted);
  - buzzdev rejection (the key is only in your running app).
- **NOT IMPLEMENTED (by product decision, not defects):**
  - huddles
  - agents
  - Projects / Workflows / GitHub / Terminal / Canvas
  - NIP-17
  - "Browse channels"
  - "followed threads"
  - `ov_*` mark-unread override

## 8. Bugs found and fixed in this run

- **No application defects found.**
- **Stale documentation corrected** (9 statements, 7 files):
  - README: "Connect existing community" → the Choose-a-community flow.
  - COMMUNITY_CONNECTION: the same flow, plus the sessionStorage selection.
  - KNOWN_LIMITATIONS: removed the entry for the deleted agent observer heuristic.
  - ARCHITECTURE: the agents module description, and §10 activity bar marked removed.
  - PROTOCOL_IMPLEMENTATION_REFERENCE: the two "SWF Agent is working" UI rules re-scoped to OLD BUZZ only.
  - TESTING: the `agents.spec.ts` entry.
  - SECURITY: the NIP-17 open question, recorded as decided (not used).
- **Test gap closed:** `tests/integration/communitySession.e2e.spec.ts`. Earlier live specs never exercised the Phase 6 routing rule or real cross-community isolation.

## 9–10. Tests executed and exact counts (all on the current tree)

**Static gates:**

| Gate | Result |
|---|---|
| typecheck | exit 0 |
| lint (`--max-warnings 0`) | exit 0 |
| production build | exit 0 |
| cargo check | exit 0 |
| cargo test | 78 passed, exit 0 |
| encoding | 478 files, 0 BOM / mojibake / invalid UTF-8 |
| secret scan | 0 nsec / ncryptsec literals in dist, src, tests, docs; the only 64-hex in the bundle is nostr-tools' `aaaa…` sentinel |

**Unit suite:**

| Run | Result | Exit | Fingerprint |
|---|---|---|---|
| 1 | 1163/1163 | 0 | `24388c66…` (before `buzz-4b`'s last edit) |
| 2 | 1176/1176 | 0 | `93162358…` |
| 3 | 1176/1176 | 0 | `93162358…` |
| 4 | 1176/1176 | 0 | `93162358…` |

Runs 2–4 are three consecutive runs on identical code.

**Real-relay E2E** (local relay, throwaway operator `73f77dc6…`), first attempt, exit 0, 0 skipped:

| File | Tests |
|---|---|
| liveRelay | 6/6 |
| reactions | 1/1 |
| ownerRoleResolution | 3/3 |
| readState | 7/7 |
| searchInbox | 6/6 |
| messagingCorrectness | 1/1 |
| messageEditDelete | 7/7 |
| privateChannelMembers | 1/1 |
| threadMedia | 5/5 |
| dmLiveRelay | 2/2 |
| dmAttachments | 3/3 |
| moderation | 3/3 |
| **communitySession (new)** | **2/2** |

**E2E environment cleanup: PASS.**
- `.env` edited byte-safely (CRLF preserved), then restored byte-identical (sha256 `98d7cb08…`).
- The throwaway gets 403 after the restart; the secret was deleted.
- No `SWF_E2E_*` variable in any scope.
- The relay runs with `BUZZ_GIT_PROBE_WRITERS=8` (launch-only; without it this machine's relay hangs in its storage self-test).

## 11–12. Real-relay and Tauri evidence

- **Live community** (`wss://buzz.lmdconsulting.com`), read-only, via screenshots of your running app:
  - connected;
  - 3 channels; the archived "LMD All Members huddle" is hidden;
  - DMs listed with presence;
  - DM history rendered;
  - the switcher and search field rendered.
- **Keyboard (palette):** verified as in §3. Everything else was not driven, because you were actively using the app. Automation stopped at that point, and the window was restored to maximized.

## 13–18. Security, boundary, session, isolation

Covered row by row above. No authorization bypass or cache leak was found. Community-scoped query keys carry identity + community, and the A→B→A real-relay test confirms it.

## 19–22. Read/unread, responsive/a11y, performance, docs

See the matrices. The docs are now consistent with the product boundary. Remaining doc gaps (not contradictions): the palette and the DM read-state model are described only in `PRODUCT_BOUNDARY_SESSION_CLOSURE.md`.

## 23–24. Remaining blockers and exact next actions

1. **Commit the work.** Nothing since the initial import is committed. Review `git status` (305 paths), then commit in logical units. Coordinate with the `buzz-4b` session first.
2. **Human QA in the Tauri window.**
   - Keyboard walkthrough: Tab / Shift+Tab through the sidebar → switcher (Enter opens, Esc closes, focus returns) → palette (Ctrl+K, ↑↓, Enter, Esc) → a channel → composer → attachment picker → thread panel (Esc) → community modal (focus trap, Esc).
   - Widths 1710 / 1440 / 1280 / 1024 / 768 / 430 / 390 / 375 on: channel, DM, thread, picker, palette, inbox, members, moderation.
3. **Live checks only you can do:**
   - open a DM → fully quit and restart the app → confirm it is not unread;
   - Add community `wss://buzzdev.lmdconsulting.com` → expect "You're not a member of this community" → choose `buzz.lmdconsulting.com` again;
   - toggle Wi-Fi off for 30 s, then on → messages sent meanwhile appear.
4. **Release:** run `npm run tauri build`, decide on Windows code signing (SECURITY.md D7), and smoke-test the installer.
5. **Optional polish still PARTIAL:** message / thread / DM visual pass, presence unit tests, video attachment E2E.

## 25. Release-readiness assessment

**Not release-ready yet. The blockers are process and human QA, not code defects:**
- uncommitted work;
- no signed installer;
- the human accessibility/responsive pass;
- three live checks.

The automated evidence for protocol, security, messaging and the session model is strong and current.
