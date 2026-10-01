# Phase 4 — run state

Living checklist for the master autonomous run. **Purpose: a resume should not
have to re-derive any of this.** Updated at the end of each completed unit.

Last updated: 2026-09-25, Phase 4 closure run — Parts A and E closed against the
real relay; a grow-only publish defect and an E2E isolation defect found and
fixed in the process; responsive verification established as blocked by design,
not merely unattempted.

> **2026-09-25 final QA run — supersedes conflicting lines below.** See
> `docs/PHASE_4_FINAL_QA_REPORT.md`.
> - Search and inbox are now **real-relay verified**.
> - DM read state is a **parity gap**, not a protocol limit: OLD BUZZ uses
>   NIP-RS for DMs.
> - Presence has **no** unit test; "unit-proven" below applies to typing only.
> - Media privacy is community-scoped, not channel-scoped.
> - Four defects were fixed:
>   - the `DevSigningService` production guard;
>   - thread reply ordering;
>   - the `fetchEventsOnce` TDZ crash;
>   - dashboard hostname clipping.
> - Phase 4 was **not closed**: another session modified 4A history transport
>   during the final runs.

**Read the status column literally.** "unit-proven" and "real relay" are
different claims and are not interchangeable here.

---

## Where the run got to

| Unit | Status |
|---|---|
| Phase 0 — current-state reconciliation | **DONE** |
| UI completion — community modal | **DONE** |
| UI completion — moderation audit rendering | **DONE** |
| UI completion — invites | **DONE** (honest limits; relay has no list/revoke) |
| UI completion — responsive | **HUMAN QA REQUIRED — blocked by design, not unattempted.** Headless Chrome against the dev server renders only the "identity is held by the desktop app" gate: every authenticated surface is behind a Tauri-only identity boundary and is unreachable from a browser. So no browser tool can verify the sidebar/channel/thread/modal layouts — only the real desktop window can. See §Responsive below for the one defect that *was* observed and the manual checklist |
| UI completion — accessibility | **HUMAN QA REQUIRED** — same boundary: the keyboard walkthrough needs the desktop window. Escape/focus-trap/aria are unit-guarded, which is not the same as operated |
| **Phase 4B — edit / delete / admin delete** | **COMPLETE** — unit + 7/7 real relay |
| Phase 4C — **read state** | **COMPLETE** — unit + **7/7 real relay** (`tests/integration/readState.e2e.spec.ts`). Closing it found a real defect: see §Grow-only below. `docs/PHASE_4C_READ_STATE.md` |
| Phase 4C — search | **IMPLEMENTED, unit-proven** — NIP-50; relay-enforced access, no client-side filtering |
| Phase 4C — inbox | **IMPLEMENTED, unit-proven** — bridge `feed_types`; three server categories, agent view is a narrowing |
| Phase 4D — composer / media / rich message | **IMPLEMENTED (channel + thread + DM), real-relay proven.** Picker, upload lifecycle, `imeta` send and rendering all exist. DM attachments wired end to end and verified 3/3 against the live relay (`dmAttachments.e2e.spec.ts`), closing former open item 8. That E2E also exposed and fixed a real rendering bug — see §Authorized media below. Voice notes descoped: relay rejects audio |
| Phase 4E — DM completion | **COMPLETE** — unit + 2/2 real relay |
| Phase 4F — presence / typing | **COMPLETE** — leak fixed, unit-proven |
| Phase 4G — hardening | **COMPLETE** — subscription/timer audit + security audit below |

| UI completion — moderation **real row** | **COMPLETE** — 3/3 real relay (`tests/integration/moderation.e2e.spec.ts`). `moderation_actions` now holds genuine `timeout`/`untimeout` rows; the audit pipe is proven end to end rather than merely empty |

Phase 4A remains COMPLETE and was not reopened. 4A-bis remains documentation
only — no HTTP bridge history was implemented.

---

## §Authorized media — a real defect found by the DM attachment E2E

**Every attachment in the app rendered broken, in every channel and every DM,
and no unit test could see it.**

`MessageAttachments.vue` pointed `<img :src>`, `<video :src>` and `<a :href>`
straight at `attachment.url`. But `GET /media/{sha256}` is **not public**: the
relay requires a Blossom GET auth event (`t get` + matching `x`, a different
verb from an upload token) **and** relay membership —
`api/media.rs:527-550` → `verify_blossom_get_auth` + `enforce_relay_membership`.
That gate is exactly what keeps a private channel's attachments private, so it
is correct; a browser simply cannot put an `Authorization` header on `<img src>`,
so the element got 401.

Every unit test passed throughout, because none of them ever fetched the URL —
they asserted `src === attachment.url`, which **pinned the bug in place**. Only
a live relay could settle it. Two such assertions were rewritten (not deleted)
to assert the opposite: the raw relay URL must never appear in the rendered
HTML.

Fix: `mediaService.fetchAuthorizedBlobUrl(url, sha256)` signs a `t get` token
and fetches the bytes; `composables/useAuthorizedMedia.ts` resolves each
attachment to a `blob:` URL and revokes them on unmount, so a long-lived
channel view does not retain every image it has scrolled past. A failed fetch
degrades to a labelled placeholder rather than blanking the message.

---

## §Grow-only — a real defect found by the read-state E2E

The E2E first asserted that publishing a lower frontier could not rewind the
stored one. **The relay disagreed, and the relay was right**: `publishReadState`
is a transport with NIP-33 replace semantics — our coordinate becomes whatever
it is handed, downward included. Asserting grow-only at that layer was testing
the wrong thing.

Chasing where the guarantee actually lives exposed the bug. `markUnreadFrom`
deliberately rewinds `lastSeenAt[channel]` (mark-unread is device-local by
design), but `publishFrontier` published that **same map** — so the next advance
in *any other channel* shipped the rewind to the relay. Mark-unread was
silently syncing, in the one direction it must never sync.

Fix: `stores/readState.ts` now keeps `publishedFrontier`, raised by advances and
by relay hydration and never lowered by a mark-unread, and publishes that.
Persisted under its own key so a reload cannot drop contexts out of our
coordinate. Pinned by `tests/unit/stores/readStatePublishFrontier.spec.ts`
(4 tests; the rewind case fails without the fix — verified, not assumed).

What remains true and is NOT a bug: merge **across** coordinates is grow-only,
so a second device's higher mark always wins. Both facts now have E2E coverage.

---

## §E2E isolation — second defect, found by running the whole set

The moderation E2E timed out MEMBER_A. Restrictions are **global relay state
keyed by pubkey**, so every other live spec signing as that identity began
failing with `restricted: you are timed out until …` once the files ran in
parallel. It passed in isolation and failed in the suite — the classic shape.

Fix: the moderation spec now times out a **freshly generated throwaway pubkey**
that no other spec uses, making the isolation structural rather than dependent
on file order or on the untimeout landing in time. Full E2E set: exit 0.

Rule for anything added here later: a live spec must not mutate relay state
belonging to a shared test identity.

---

## §E2E rate limit — media uploads throttle at one per minute

Separate from the quota issue below, and it bites a different spec.
`dmAttachments.e2e.spec.ts` uploads a real blob on every run, and the relay
rate limits media uploads per `(community, pubkey)` over a 60-second window
(`api/media.rs` `MEDIA_UPLOAD_RATE_WINDOW`). Consequences:

- Running the whole `tests/integration` directory in one go fails it with 429.
- Two runs inside a minute fail the second.
- **In isolation, with a minute's spacing, it passes 3/3** — verified
  repeatedly, including immediately after a throttled failure.

Deliberately NOT handled by skipping on 429: a spec that treats "throttled" as
"fine" would equally treat a genuinely broken upload as fine. The constraint is
documented in the spec header instead, so a failure there prompts a re-run in
isolation rather than a hunt for a defect that isn't there.

The same class of problem, already recorded below for moderation: these specs
share one live relay, so *some pairs interfere*. `ownerRoleResolution` fails
when run in the same invocation as `moderation`, and passes alone. Run live
specs one file at a time.

---

## §E2E quota — the operator-gated specs are not repeatable

`MAX_COMMUNITIES_PER_OWNER = 5` (`crates/buzz-relay/src/relay_members.rs:456`,
overridable by `BUZZ_MAX_COMMUNITIES_PER_OWNER`). The operator-gated live specs
(`liveRelay`, `reactions`, and the `swf-e2e-*` / `swf-p0-*` / `swf-react-*` /
`swf-signout-*` families) **provision a fresh community per test and never
release it**, so a single full run consumes the operator's entire quota and
every subsequent run fails with `limit_reached: owner already owns the maximum
number of communities`. They pass once on a clean relay and never again.

This is a test-infrastructure defect, not an application defect, and it is why
those specs have been skipped in most runs. Not fixed here: every remedy is an
environment/config decision that was previously ruled user-approval territory —
(a) mint a throwaway operator per run and add it to `RELAY_OPERATOR_PUBKEYS`,
(b) raise `BUZZ_MAX_COMMUNITIES_PER_OWNER` for dev, or (c) give the specs a
teardown, which the relay makes expensive since community deletion is the heavy
async workflow rather than a delete.

**The pattern that does work** — and which `readState.e2e.spec.ts` and
`moderation.e2e.spec.ts` follow deliberately: reuse an existing community and
its existing members, and where a spec must mutate global state (a restriction),
target a freshly generated throwaway pubkey. Those specs are repeatable and
consume no quota. New live specs should follow them, not the `swf-e2e-*` shape.

---

## §Responsive — what was actually observed

Headless Chrome (no new dependency; the installed Chrome with `--headless=new
--screenshot`) against the running dev server at 320/375/430/1440 px.

**Reachable surface: the desktop-gate screen only.** Outside Tauri the app
correctly refuses to resolve an identity and renders "Your identity is held by
the SWF Buzz desktop app." That is a sound security boundary and it is also why
browser-based verification of the real UI is impossible, not merely unavailable.

**One defect observed, unfixed and reproducible:** at ≤430 px the login card
overflows the right edge and clips its own text (the word "Open" disappears at
375 px). The card's left edge sits exactly at the page padding while its right
edge runs past the viewport, i.e. an ancestor is computing wider than the
screen. Three CSS attempts produced **byte-identical** screenshots under a fresh
Chrome profile with cache-busting, so the served render did not pick them up and
no fix can be claimed. `min-width: 0`, `overflow-wrap: anywhere` and a
viewport-bound `max-width` were left in `LoginView.vue` as defensible hardening
(they also protect the monospace identity line from overflowing) — **but they
are unverified and must not be recorded as the fix.**

Repro: `npm run tauri dev`, then
`chrome --headless=new --window-size=375,800 --screenshot=out.png http://127.0.0.1:1420/`.

### Manual checklist (needs the desktop window)

At 1710 / 1440 / 1280 / 1024 / 768 / 430 / 390 / 375:
no horizontal overflow anywhere; sidebar (drawer ≤768); channel list; channel
header; DM header; message list; composer with the attachment picker; thread
panel (full-screen on narrow); context/details pane; community modal
(full-screen on mobile); members table; moderation timeline; invite surfaces;
profile onboarding.

Keyboard: Tab / Shift+Tab order; Enter and Space activate; Escape closes modal
and thread; focus trap inside modals and the mobile thread; focus restored to
the trigger on close; visible focus everywhere; attachment picker fully operable
by keyboard; no keyboard trap; icon-only buttons announce a name.

---

## Facts a resume needs (already established — do not re-derive)

### Kinds, verified in OLD BUZZ source
- Edit **40003** (`buzz-core/src/kind.rs:483`), `h` + `e` tags, content = new text.
- Self delete **5**; admin delete **9005** (`kind.rs:341`). **Not interchangeable** —
  see `docs/PHASE_4B_EDIT_DELETE.md` §1.
- Read state **30078** (`kind.rs:70-75`) — NIP-78/NIP-RS, parameterized
  replaceable keyed `(pubkey, kind, d)`, stored globally (`channel_id = NULL`),
  **content NIP-44 encrypted to the author's own keypair**. The relay stores it
  without interpreting it. **DONE** — `src/stores/readState.ts` is now a
  hydration cache over it; full spec transcription in `src/protocol/readState.ts`
  and rationale in `docs/PHASE_4C_READ_STATE.md`. Two facts a resume needs:
  the spec requires a **32-lowercase-hex** slot id (the OLD BUZZ desktop client
  is looser at 1–64 ASCII — we follow the spec, `NIP-RS.md:55,:68`), and the
  merge is **grow-only**, which is why manual mark-unread is device-local
  without the unimplemented `ov_*` override layer.
- **NIP-44 now exists in Rust.** It used to throw in `signingService.tauri.ts`,
  which made relay-hosted read state impossible in production. Added
  `nip44_encrypt`/`nip44_decrypt` Tauri commands (`identity/signing.rs`,
  `identity/commands.rs`, registered in `lib.rs`) plus the `nip44` crate
  feature. The `ensure_no_key_material` egress guard runs on the **plaintext**
  before sealing; decrypt errors never echo the payload.
- kind:41011 group-DM add is **real** (`command_executor.rs:431-566`). The
  "UNVERIFIED" annotation that used to sit on it in `kinds.ts` was wrong and has
  been corrected.

### Search — the relay is the access boundary, and this is load-bearing
NIP-50 REQ carrying `search` (`handlers/req.rs:596-628`). Search REQs are
**one-shot**: the relay answers then EOSEs and registers no subscription, so
`fetchEventsOnce` is the right primitive and `subscribe` would leak one per
keystroke. The relay resolves `accessible_channels` from the **authenticated**
pubkey (`req.rs:110-126`), maps it to a `ChannelScope` (`:576-594`), binds
`community_id` as the first SQL predicate, and *re-authorizes every hit* —
`buzz-search/src/lib.rs:12-15` states outright that "search is never the access
boundary". We therefore deliberately do **not** re-filter hits against a local
channel list; `tests/unit/protocol/search.spec.ts` asserts the filter carries no
channel allowlist, because a stale local list would hide legitimate results
while adding no protection.

### Inbox — three server categories, not four
Feed reads go over the HTTP bridge (`POST /query`) because `feed_types` is only
honoured there (`api/bridge.rs:1210`; the bridge two-pass parses raw JSON at
`:1112` precisely because `nostr::Filter` drops the extension). **This is not
4A-bis**: that proposal was about moving channel *message history* off the
socket and remains unimplemented — the feed has no socket equivalent to move.

The CLI advertises four type names (`buzz-cli/src/commands/feed.rs:6`) but the
relay canonicalizes **`agent_activity` → `activity`** and de-duplicates by
canonical name (`bridge.rs:1226-1232`), so there are three server queries:
`mentions` and `needs_action` join `event_mentions` for the caller's pubkey,
`activity` scans accessible channels. "Agent updates" is therefore a
**client-side narrowing** of the activity result to kinds 43001/43003/43004 —
requesting `agent_activity` separately returns the identical rows as
`activity`, so two tabs would show one result set twice. `InboxService`
partitions them (agent kinds to the agent view, the rest to activity) and
`tests/unit/features/inboxService.spec.ts` asserts the partition loses nothing
and double-counts nothing.

### Invite surface — complete, and smaller than the spec assumed
The relay exposes exactly two invite operations (`router.rs:108,124`):
`POST /api/invites` (mint) and `POST /api/invites/claim`. There is **no list and
no revoke endpoint**, and only `SHA-256(code)` is stored, so codes cannot be
re-displayed even in principle. The UI states this rather than showing an empty
table or a dead Revoke button.

### Real-relay E2E harness
- Runner: `<scratchpad>/run-e2e.cjs` — reads the throwaway dev identities from
  `C:\Users\lenovo\swf-buzz-dev-reset-2026-09-22\*.secret.txt`, decodes nsec→hex
  in-process, and execs vitest with `SWF_E2E_DM_SK_A/SK_B/HOST` in the child env.
  No secret is printed, written into the repo, or passed on argv.
- Spawn vitest as `node node_modules/vitest/vitest.mjs`, **not** `npx.cmd` —
  npx swallowed both output and exit status on Windows.
- `SWF_E2E_DM_HOST=swf-development-1790079628466.localhost:3000`, where
  `07227e7a…` is owner and `2dffa5eb…` is a plain member — the exact pairing an
  admin-vs-member test needs.
- **NIP-42 binds the authenticated pubkey to the socket.** Every identity switch
  must reconnect (`actAs()` in `messageEditDelete.e2e.spec.ts`), or the relay
  refuses with "event pubkey does not match authenticated identity".
- Channel creation is **rate limited**; back-to-back E2E runs hit
  "rate-limited: quota exceeded; retry in Ns". Not a code fault — space the runs.
  This bites hardest running the whole `tests/integration` directory at once,
  because several files each create channels: `messagingCorrectness` and
  `messageEditDelete` are the usual casualties. Run those individually with
  ~60-90s of headroom if a combined run trips the quota.

### Environment change that inverted a test expectation
`BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` is now set. A stranger connecting to
`ws://localhost:3000` is therefore refused ("restricted: not a relay member").
`liveRelay.e2e.spec.ts` previously *recorded* the opposite as an observation
(membership was unenforced); it now asserts the refusal, because that is the
property the flag was enabled to get.

### 4D — voice notes are not implementable against this relay build
`PUT /upload` dispatches by **sniffed** MIME into image / video / file
(`api/media.rs:362-394`). Audio is refused outright by `validation.rs:198-207`
— *"audio is rejected until Buzz has an explicit sanitizer and location-metadata
validator for its container"* — and `media.rs:383` stops recognized audio
falling through to opaque file storage. So a recorder would always end at a
rejected upload. No recorder was built: a UI affordance for an impossible
action is the fake-button failure the contract forbids. Enabling voice notes
needs a relay-side `buzz-media` change, which is out of scope while OLD BUZZ is
read-only.

Image/video/file attachments are implemented **in the data layer only**, reusing
`MediaService` (no second upload backend) and the same JPEG metadata sanitizer
as avatars — the Chromium APP2 ICC profile it strips is not avatar-specific.

**Be precise about what "4D" currently means**, because the layers diverge:

| Layer | State |
|---|---|
| `protocol/imeta.ts` build/parse | done, 11 tests |
| `Message.attachments` populated by `parseMessageEvent` | done |
| `features/messages/attachments.ts` (upload, sanitize, early audio refusal) | done |
| `useSendMessage` accepts and forwards `attachments` | done |
| Composer attach affordance (file picker) | **done** — `MessageComposer.vue`, behind an opt-in `allowAttachments` prop |
| Rendering an attachment in a message | **done** — `MessageAttachments.vue`, wired from `MessageItem.vue` |
| Attachments on the **channel** surface | **done** — `ChannelsView.vue` passes `allow-attachments` and forwards the third emit arg |
| Attachments on the **thread** surface | **done in the closure run** — see below |
| Attachments on the **DM** surface | **NOT implemented** — see below |

**This table was corrected during the Phase 4 closure run; the previous version
said the composer and rendering were absent, which was already false when it was
written last.** A resume trusting it would have rebuilt working UI. The upload
happens *on send, not on pick*, which is the right call — uploading at pick time
orphans a blob on the relay every time someone attaches a file and then changes
their mind.

Two genuine gaps remained behind that stale entry, found by checking every
`<MessageComposer>` call site rather than the component itself:

1. **Thread replies dropped attachments.** `MessageComposer` emits
   `send: [content, mentionPubkeys, attachments]`, but `ThreadPanel.sendReply`
   took only the first two parameters, so the third was silently discarded — and
   the panel never set `allow-attachments`, so the control was hidden anyway.
   Fixed: the prop is set and the argument forwarded. A thread reply is an
   ordinary channel message carrying thread markers, and `useSendMessage` already
   accepted `attachments`, so nothing below the component needed to change.
2. ~~**DM attachments are genuinely not implemented.**~~ **CLOSED.** The
   diagnosis was right: `attachments: []` at `useSendDm.ts` was filling the
   optimistic `Message`'s required field, not dropping an argument, so nothing
   failed loudly — an empty array reads as "this message has no attachments".
   Now threaded `DmView` → `useSendDm.send` → `DmService.sendMessage` →
   `DmTransport.send` → `buildMessageEvent`, with `allow-attachments` set on
   the DM composer. No new upload backend and no DM-specific renderer: a DM is
   a channel on the wire, so the same `imeta` builder and `MessageAttachments`
   apply. Unit-pinned in `tests/unit/features/dm/dmAttachments.spec.ts`
   (9 tests; 5 fail if the transport stops forwarding `attachments` — verified
   by reverting, not assumed) and proven 3/3 on the live relay.

`protocol/imeta.ts` shipped with **no unit coverage**; 11 tests were added here.
The one that matters most pins the **first-space-only** split: each element
after the tag name is a `key value` pair and values routinely contain spaces, so
a naive `part.split(" ")` truncates `filename my quarterly report.pdf` to `my`.
That reads as cosmetic and is actually a corrupted download name. Verified by
reverting to the naive split — 2 of the 11 fail. `parseMessageEvent` now
populates `Message.attachments` (previously the field existed on the type with
no producer, so every constructor was a typecheck error waiting to happen).

### 4E — a DM is a channel, so it now rides the channel machinery
`DmTransport` was widened from "messages only" to the full timeline shape:
`subscribe(id, since, onEvent)`, `fetchHistory → TimelinePage`, `fetchOlder`
(keyset), `fetchSince` (gap backfill). Two real defects closed:
`Kind41010Transport.subscribe` anchored `since` to **wall-clock now** (reopening
the gap 4A closed for channels) and **dropped** the edit/delete events 4B put on
that same subscription, so a DM showed stale text after an edit and kept
rendering deleted rows. `useDmMessages` now mirrors `useChannelMessages`
exactly — overlays, `mergeMessages`, `loadOlder`, reconnect `repairGap`.

The shared *mechanics* are imported from `features/messages`; the wire calls stay
behind `DmTransport`, so D1.F's protocol boundary is intact and a future NIP-17
transport must satisfy the same contract rather than silently regressing DMs.

**Not closed by 4E — DM read state is still session-local.** Channels use
NIP-RS `kind:30078` (4C); DMs use the in-memory `stores/dmReadState.ts`.
Migrating them is a design step, not a rename: the NIP-RS frontier is grow-only
and slot-keyed, so DM conversations need slot allocation of their own.
`dmReadState.ts` carried a comment asserting "there is no protocol-level
read-receipt mechanism" — the same false premise that had already propagated
into the channel work before 4C caught it. Corrected in place rather than left
to mislead a third time.

### 4F — the typing leak was resource-only, which is why the test asserts timers
`useTypingIndicator.resubscribe` cleared the visible list on a channel switch
but left that channel's expiry timers armed for the full 5s window, holding
their Map entries with them. It is **not** a rendering bug: a stale timer filters
a pubkey usually absent from the new list, and `setTyping` happens to clear it
when the same person types again. An assertion about `typingPubkeys` therefore
passes with or without the fix — the first version of this test did exactly that
and was rewritten. `vi.getTimerCount()` is the assertion that actually fails
(3 vs 0), verified by reverting the fix.

Subscription ids are already serialized inside `RelayConnectionService.subscribe`
(`${id}-${++serial}`), so the fixed `"typing-live"` label is not a collision.

### 4G — audit results
- **Subscriptions**: all 10 live-subscribing composables pair `subscribe` with
  `onUnmounted` + `close()`. `useDmHttp.ts` does not, and was left alone — it is
  the legacy Okta `DmServiceHttp` track the contract says not to touch.
- **Timers**: every `setInterval` is cleared. Two uncleared `setTimeout`s remain
  (`UserProfilePanel.vue`, `AppSidebar.vue`) — both 1.5s one-shot "Copied"
  resets that self-terminate. Bounded and not endless; left as-is.
- **Secrets**: `localStorage`/`sessionStorage` hold only community id, pending
  invite token, profile cache and read-state slot/client ids — no key material.
  `nsec` exists only inside `CreateIdentityFlow.vue`'s one-time reveal and is
  zeroed on leave. The two identity `console.info` lines are DEV-gated and print
  8-char public fingerprints. Production bundle scan (33 files): no
  `nsec1`/`ncryptsec1` literals; the single 64-hex literal is nostr-tools' ping
  sentinel `ids:["aaaa…"]`.
- **Authorization**: `capabilitiesFor` derives from `platformRole` and
  `communityRole` only, never from each other and never from a pubkey compare.
  Edit/delete stay per-message in `channelPermissions.ts` because they depend on
  the message's author and the channel's visibility — a session-level "can I
  edit?" could only be answered wrongly.
- **Encoding**: 390 files, 0 BOM, 0 mojibake.

  Note for future passes: reading a UTF-8 source with PowerShell 5.1
  `Get-Content` *without* `-Encoding utf8` decodes it as ANSI, so a perfectly
  correct em-dash is **displayed** as the three-character sequence this
  repository's guard looks for. It is a console artifact, not file damage —
  "repairing" what the console shows would write the corruption into a clean
  file. Verify at byte level first
  (`[System.IO.File]::ReadAllText($p, [System.Text.UTF8Encoding]::new($false))`).

- **E2E gate now actually gates.** Before 4G every run exited non-zero on the
  nostr-tools AUTH re-throw (open item 3), so a green suite and a broken suite
  were indistinguishable by exit code. Fixed in the harness; verified narrow by
  planting a probe spec that rejects with an unrelated error — it still fails
  the run (exit 1), so this is a filter, not a swallow.

  This document deliberately does **not** quote the corrupt byte sequences: the
  encoding guard scans `docs/` too, so spelling them out here would make the
  file explaining the problem its own first offender.

---

## Known open items (carried, not hidden)

1. ~~**DM overlays.**~~ **CLOSED in 4E** — `Kind41010Transport` forwards
   edit/delete and `useDmMessages` folds them, proven against the real relay.
2. ~~**Thread panel overlays.**~~ **CLOSED in the Phase 4 closure run (Part C).**
   The cause was structural, not a missed call: replies are found by `#e` against
   the **root**, but an edit or deletion of a *reply* carries `e` = that reply's
   own id, so a root-anchored query and subscription are blind to them by
   construction — and `fetchThread` additionally filtered to renderable message
   kinds, discarding even the root's own overlays.

   Fixed by reusing the channel mechanics rather than growing a second
   message-state implementation: `CHANNEL_TIMELINE_KINDS`, `OVERLAY_KINDS`,
   `classifyTimelineEvent` and `splitTimeline` are now exported from
   `MessageService`, and `useThread` folds them with the same
   `messageOverlay` module (`applyEdit`/`applyDelete`/`renderTimeline`) that
   `useChannelMessages` uses. Two fetches, deliberately: the root-anchored query
   (widened to the full timeline kind set) plus a second `#e` query over the
   reply ids, which is the only way to see reply modifications.

   The live subscription is filtered by **`#h` (channel), not `#e` (root)**. Reply
   ids change as replies arrive, so an `#e`-anchored overlay subscription would
   have to be torn down and reopened on every new reply — reintroducing exactly
   the miss-window 4A closed. Overlays for other messages in the channel are
   therefore delivered and are inert, because overlays are keyed by target id.
   Base messages are filtered to the thread in **both** `ThreadService` and
   `useThread`: the second check is not redundant, it is the invariant guarding
   the thread cache at its write point, and a test pins it (it failed when only
   the service filtered).

   `tests/unit/features/threads/threadOverlays.spec.ts` — 12 tests. Verified to
   catch the original bug: with the overlay fold reverted, **8 of 12 fail**; the
   4 that still pass are the scoping tests, which exercise filtering rather than
   folding. Root edit/delete is covered too — leaving the root stale while the
   replies updated would be the same bug one level up. Thread suite: 37/37.
3. ~~**Unhandled rejection on auth denial.**~~ **CLOSED in 4G — root cause
   found in nostr-tools.** `Relay._onmessage`'s AUTH branch runs
   `this.auth(this.onauth).catch(err => { if (!(err instanceof
   SendingOnClosedConnection)) throw err })`. Re-throwing *inside* a `.catch`
   creates a new rejected promise nothing is attached to, so every legitimate
   AUTH refusal (`OK false "restricted: not a relay member"`) surfaced as an
   unhandled rejection and the E2E run exited non-zero with zero failures — a
   gate that cannot gate. Our own `relay.auth()` handle receives the same cached
   promise and handles the denial correctly, so the app was never wrong; this is
   the library's duplicate, which no application code can attach to.
   Fixed in the harness only (`tests/integration/setup.e2e.ts`, wired via
   `vitest.e2e.config.ts`): ignore unhandled rejections whose message matches a
   relay AUTH refusal, re-raise everything else. Narrow by design — a blanket
   swallow would have hidden real failures, and putting it in app code would
   have hidden them in production too.
4. **Responsive + accessibility need a human.** jsdom has no layout engine, so
   the six-breakpoint check and the keyboard walkthrough cannot be honestly
   claimed from here. Source-level guards exist for the rules themselves.
5. **Moderation audit has never had a real row.** `moderation_actions` is empty
   because nothing has been moderated on this relay; the invalidation path is
   unit-proven, the rendered-refresh path needs one real ban in a real window.
6. **Read state has no real-relay E2E.** The unit suite proves merge, validation
   and publish shapes, but not that a real relay accepts `kind:30078` with these
   tags and serves it back to a second identity. Belongs with the rest of 4C.
7. **Mark-unread is device-local by design** — a rewind cannot be expressed in a
   grow-only frontier; NIP-RS's `ov_*` layer is the honest fix and is not built.
   Deliberately not faked into a publish that would be a silent no-op.
8. ~~**DM attachments are not implemented.**~~ **CLOSED.** The parameter is
   threaded `DmView` → `useSendDm.send` → `DmService.sendMessage` →
   `DmTransport.send` → `buildMessageEvent`, the DM composer sets
   `allow-attachments`, and retry re-sends the already-uploaded attachments
   rather than re-uploading (which would orphan a duplicate blob). Rendering
   reuses `MessageAttachments`; no DM-specific renderer was written. Verified
   3/3 against the live relay.
9. ~~**4D has no real-relay E2E.**~~ **CLOSED** by
   `tests/integration/dmAttachments.e2e.spec.ts`: a real blob is uploaded, sent
   on a DM, received by a second identity, and its `imeta` parsed back with the
   space-containing filename intact. The audio refusal is asserted against the
   live endpoint, not just the client guard, and a malformed-`imeta` event is
   proven not to throw.
