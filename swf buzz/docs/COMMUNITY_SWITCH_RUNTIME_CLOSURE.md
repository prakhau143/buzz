# Community Switch Runtime — Closure Report

Date: 2026-09-28

## Verdict

**PASS.** In the real Tauri desktop app, A → B → A → B changed every community-scoped surface
(sidebar channels, DMs, inbox, opened channel and its messages, selection, route, cache keys), not
just the community name, and no stale data leaked on any leg (§15).

## 1. Root cause

The switcher named community B while the sidebar kept A's channels and DMs because the
**sidebar stays mounted across a switch** and three things inside it were fixed at mount:

1. **Query keys evaluated once.** `useChannels` and `useDmList` passed
   `queryKey: queryKeys.channels()` / `queryKeys.dmList()` — a plain array computed in `setup()`.
   The keys *do* name the community (`["identity", pk, "community", <relayUrl>, …]`), but a key
   computed once keeps naming A forever. After the switch the mounted observers still watched A's
   key. `queryClient.clear()` (which teardown does run) removes cache entries but does **not** reset
   a mounted observer's current result, so A's lists stayed on screen. The header reads
   `activeRelayUrl`, which is reactive, so only the name changed. Same defect in
   `useCommunityMembers` (roster) and the three moderation queries.
2. **Live subscriptions never re-opened.** The switch's `relayConnectionService.disconnect()` closes
   *every* registered subscription. `useChannels`, `useDmList` and `useUnreadTracking` subscribed
   once in `setup()` and never again, so B had no live channel/DM/unread updates.
3. **Event-time keys in live handlers.** The live handlers computed `queryKeys.channels()` when an
   event *arrived*, so an A event arriving after the switch would have been written into B's list.

`communityIsolation.spec.ts` passed throughout because it tests the key factory, not a mounted
component living through a switch.

## 2. Existing architecture discovered (kept)

- `identitySession.ts` — one lifecycle for every entry point; `tearDownConnectionScopedState()`
  disconnects the socket, clears signer, connection verdicts, selection, read state, presence,
  nav history and `queryClient.clear()`.
- `queryKeys.ts` — every relay-backed key is identity **and** community scoped.
- `CommunitySwitcher.vue` — re-verifies membership before leaving A and rolls back to A if B fails.
- `RelayConnectionService` — a `connectGeneration` already discards stale *sockets*; there was no
  equivalent for stale *subscriptions or fetches*.
- `useChannelMessages` / `useDmMessages` / reactions / typing / threads already re-key and
  re-subscribe on channel change and on reconnect — they were not the cause.

## 3. Changes made

| File | Change |
|---|---|
| `src/features/communities/communitySession.ts` (new) | Community session generation + `ready`, `withinCommunitySession`, `StaleCommunitySessionError` |
| `src/features/auth/identitySession.ts` | Teardown ends the session first; `beginIdentitySession` begins one, aborts if overtaken by a newer switch, commits at READY |
| `src/services/RelayConnectionService.ts` | Each subscription is stamped with its session; events/EOSE for an ended session are dropped; stale subscriptions are never re-issued |
| `src/services/relayQuery.ts` | `fetchEventsOnce` rejects with `StaleCommunitySessionError` if the session changed before it settled |
| `src/services/relayBridgeQuery.ts`, `features/inbox/InboxService.ts`, `features/moderation/ModerationService.ts` | HTTP reads wrapped in `withinCommunitySession` |
| `src/app/providers/queryClient.ts` | Stale-session errors are not retried |
| `src/features/channels/useChannels.ts`, `src/features/dm/useDmList.ts` | Reactive keys; live subscription re-opened per session with the key captured at subscribe time |
| `src/features/community-members/useCommunityMembers.ts`, `features/moderation/useModerationQueue.ts` | Reactive keys |
| `src/features/readState/useUnreadTracking.ts` | Re-subscribes per session |
| `src/layouts/AppHeader.vue`, `features/presence/presenceSync.ts` | Presence restarted and re-tracked per session |
| `src/features/communities/switchNavigation.ts` (new), `stores/ui.ts`, `features/auth/useAuth.ts`, `views/ChannelsView.vue` | After a switch, open the previous channel only if B has that **id**, else B's first listed channel. The request is made *after* the landing navigation — found in the Tauri run: made before it, the landing `router.push` dropped `?channelId=` |
| `src/layouts/CommunitySwitcher.vue` | Header keeps naming A with "Switching to B…" until the switch completes |

No forced reload, no `localStorage` wipe, identity untouched.

## 4. Community session lifecycle

```
click B → verify B membership (A untouched)
        → teardown: endCommunitySession (gen n+1) → disconnect A → clear signer/selection/read state/presence/caches
        → setActiveRelay(B) → beginCommunitySession(B) (gen n+2)
        → connect B → NIP-42 (must be signed by this pubkey) → relay_members role
        → still gen n+2? else abort (a newer switch owns the app)
        → READY → commitCommunitySession(n+2) → hydrate B read state
        → mounted consumers re-key / re-subscribe for gen n+2
failure → switcher reconnects A (new generation) and shows "…You're still in A."
```

Teardown-then-initialize (not prepare-B-then-commit) because `RelayConnectionService` is a single
socket by design (docs/ARCHITECTURE.md §7). The UI never *claims* B while showing A: the header
keeps naming A (status "Switching to B…") and every community-scoped list is keyed by B, so it is
empty/loading until B answers.

## 5. Subscription teardown

`disconnect()` closes every subscription (unchanged). New: each subscription carries its session
generation; `issueSubscription` drops events/EOSE for any other generation and never re-issues a
stale subscription on a new socket. Consumers that outlive the switch re-open theirs on
`communitySessionGeneration`: channel list, DM list, unread tracking, presence. Per-channel
consumers (messages, DM messages, reactions, typing, thread) already re-subscribe because the
selection is cleared and re-chosen.

## 6. Stale-response protection

- Relay REQ fetches: `fetchEventsOnce` captures the generation; a result for an ended session
  rejects (`StaleCommunitySessionError`, not retried).
- HTTP bridge / inbox / moderation reads: `withinCommunitySession`.
- Live events: dropped in the transport by generation.
- Session establishment: `beginIdentitySession` re-checks its generation after connect and after
  role resolution; an overtaken attempt returns `null` without touching role or session.
- Query keys were **not** changed (tests pin their shape); the guard is at the transport.

## 7–10. Channel, DM, inbox, message isolation

- Channels / DMs: reactive community-scoped keys; live updates written to the key captured when
  the subscription opened. Covered by `communitySwitchRuntime.spec.ts`.
- Inbox: its keys were already reactive; it depended on the (stale) DM list for DM scoping, which
  now follows the community; its HTTP reads are session-guarded.
- Messages / threads / reactions: keys were already reactive and channel-scoped under the
  community; late events are dropped by the transport guard.

## 11. Read state

Unchanged behaviour: teardown `$reset()`s the store and READY runs `hydrateFromRelay()` for B. No
rewind is published by a switch; the monotonic frontier code is untouched. Unread tracking now
re-subscribes in B (before this fix it stopped after the first switch).

## 12. Navigation

Selection is cleared by teardown (unchanged). New: after a successful switch the channel view
waits for **B's** list, then reopens the previous channel only if B lists that same id, else B's
first sidebar channel; nothing is chosen if B lists none or the user already picked one. Thread
panel closes with the selection. Matching is by id, never by name.

## 13. Tests added

- `tests/unit/features/communities/communitySwitchRuntime.spec.ts` — mounted sidebar through
  A→B, A→B→A→B, stale A answer after switch, A subscriptions closed / B opened, late A live event,
  B live events, `channelAfterCommunitySwitch` (id not name). **6 of these fail on the previous
  code** (verified by temporarily restoring the old composables).
- `tests/unit/services/RelayConnectionService.communitySession.spec.ts` — events/EOSE after the
  session ended are dropped; stale subscriptions not re-issued; `fetchEventsOnce` rejects stale.
- `tests/unit/auth/identitySession.spec.ts` — an overtaken switch never commits.
- `tests/unit/features/communities/communitySwitcher.spec.ts` — header keeps naming A until B is
  ready. (The mock's `switchCommunity` now awaits its behaviour hook so a switch can be held open.)

## 14. Test counts

| Check | Result |
|---|---|
| Baseline before changes | 116 files / 1176 tests passed |
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings 0`) | clean |
| `npm run build` | built |
| `cargo check` | finished |
| `cargo test` | 78 passed, 0 failed |
| Full unit suite, 3 consecutive runs | 118 files / 1192 tests passed, each run |
| Full unit suite after the final `useAuth.ts` ordering fix | 118 files / 1196 tests passed (the 4 extra tests vs. the earlier runs were not added by this fix) |

+16 tests, +2 files; no test deleted or weakened. One affected-subset run after the ordering fix
had a single timeout (`useAuth.spec.ts`, 8 s, unrelated stored-token test) while the Tauri app was
running; the file passed 44/44 on its own.

Not run: `tests/integration/communitySession.e2e.spec.ts` (needs `SWF_E2E_MEMBER_SK` /
`SWF_E2E_OPERATOR_SK`; not configured).

## 15. Tauri runtime evidence

Real app: `npm run tauri dev` (WebView2 with `--remote-debugging-port`), identity `8e428c1c…555f954a`
(member of both). Driven read-only over the DevTools protocol: DOM text **plus** the app's own
query cache and Pinia state, so data is checked by id and source community, not by name.

| Step | Header | Channels (ids) | DMs | Cache communities | Route / selection |
|---|---|---|---|---|---|
| Enter A (`wss://buzz.lmdconsulting.com`), open DM "Sandeep Singh" | buzz.lmdconsulting.com | Welcome `5241eb40…`, SWF Project `2212ef42…`, LMD All Members `3a1ce10d…` (+ archived huddles, not listed) | 6 (Sandeep, Devankit, Tanishq, Hardik, Himanshu, Sonia) | A only | `/dm?conversationId=bb997519…` |
| During A → B | buzz.lmdconsulting.com — "Switching to buzzdev.lmdconsulting.com…" | A's while B is verified, then empty | — | — | — |
| A → B (`wss://buzzdev.lmdconsulting.com`) | buzzdev.lmdconsulting.com | Test Channel `31863437…`, general `5dad4d4e…`, welcome-everyone `53f0182f…` | none ("No conversations yet.") | B only | `/channels?channelId=31863437…`; DM selection cleared |
| B Inbox | buzzdev | — | — | inbox keys all `wss://buzzdev…` | "You're all caught up" (B's empty state, no A rows) |
| B → A | buzz.lmdconsulting.com | A's three, same ids as step 1 | A's six | A only | `/channels?channelId=5241eb40…` (Welcome) |
| A → B | buzzdev.lmdconsulting.com | B's three, same ids | none | B only | `/channels?channelId=31863437…`; B messages (Devankit Sahu) rendered |

Every channel and DM list query had its observers on the active community's key; no key for the
other community remained in the cache on any leg. Presence restarted (A's DM avatars show
status dots after B → A). No production data was written by the verification itself beyond what
the app does on its own (presence heartbeat, read-state for the channel it opens).

## 16. Remaining limitations

- The post-switch default channel is the first *listed* channel. The channel list carries no
  per-channel membership, so on `buzzdev` it opened "Test Channel", which this identity has not
  joined (it shows "Join channel"). Preferring a joined channel needs a membership source.
- **Separate, pre-existing:** the bottom-left profile card asks only the *current* relay for the
  identity's kind:0. `buzzdev` has none for `8e428c1c…`, so the card shows the pubkey there. Before
  this fix the name appeared in B only because A's cached answer survived the switch. The profile
  is identity-level by design (`identityProfile.ts` resolves it across relays for the setup gate);
  the card should use that resolution. Not changed here.
- Switching is teardown-first (single socket). During the switch the sidebar lists are empty /
  loading under B's keys rather than showing A; A is restored on failure by reconnecting.
- `applyIdentityAndResolveRole` (Okta/dev path) connects without a community session; the
  generation stays consistent there, but `ready` is not committed on that path.
- SWF-backend (HTTP) queries (`useDmHttp`, `useCommunity`) are not relay-scoped and were not part
  of this fix.
- The real-relay E2E `tests/integration/communitySession.e2e.spec.ts` needs
  `SWF_E2E_MEMBER_SK` / `SWF_E2E_OPERATOR_SK`, which are not configured on this machine.
- Running `prettier --write` on the touched files also re-wrapped pre-existing long lines in
  them (formatting only).
