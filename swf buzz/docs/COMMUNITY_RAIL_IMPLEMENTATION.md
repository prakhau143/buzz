# Community Rail (Phase A, desktop)

Date: 2026-09-30.

**Scope.** Phase A of the desktop community rail + mobile plan. The mobile phases (B–F) are
not started.

**No changes to:** protocol, NIP-42, membership authorization, identity storage, or the
Add Community flow.

## What it is

- A fixed **64 px rail** on the far left of every in-community view: `channels`, `inbox`, `dm`,
  `community-channels`, `community-dm`.
- It is for **fast switching**. The sidebar's existing community switcher stays unchanged as
  the context / management surface:
  - current community
  - other communities, with their role
  - Add community

```
Rail (fixed) | Sidebar (resizable) | Conversation (resizable) | Thread (resizable)
```

## Behaviour

| | |
|---|---|
| Items | The current community, plus communities the relays have confirmed this identity is owner/admin/member of (`access.memberships`). Remembered-but-unverified addresses are never listed. Ordered by when each community was added, so icons don't jump on switch |
| Click | Switches immediately, through the same verify → switch → restore-on-failure path as the switcher. Clicking the active community does nothing |
| + | Opens the **existing** Add Community flow (`router.push({ name: "communities" })`). No second implementation |
| Active | 3 px accent pill on the rail edge, accent-tinted ring, surface + small shadow, green/grey connection dot |
| Inactive / hover | Slightly muted avatar; subtle surface on hover |
| During a switch | The target shows a spinner ring and `aria-busy`. Other items are disabled. The switcher shows "Switching to …" |
| Error | Relay refused or unreachable → an inline alert beside the rail (dismissible). The same message is shared with the switcher |
| Icons | The community's NIP-11 `icon` when the relay publishes one (fetched once per relay per session, shared with the switcher). Otherwise its initial |
| Membership refresh | Sign-in already discovers memberships. The rail re-asks at most every 5 min, the switcher every time it opens |
| ≤ 768 px | Hidden. Mobile gets its own navigation model in a later phase; the sidebar drawer still holds the switcher |

## One source of truth

`src/features/communities/useCommunitySwitch.ts` now owns:
- `switchTo`
- the in-progress target (`switchingTo`) and the community being left
- the error
- `openAddCommunity`

This state is module-level. `CommunitySwitcher.vue` was refactored onto it, with the same
behaviour and markup; its existing tests pass unchanged. `CommunityRail.vue` uses it too.

So a switch from either control:
- shows as in progress in both
- lands both on the same active community (`activeRelayUrl`)
- can't be started twice

## Accessibility

- `<nav aria-label="Communities">` of real `<button>`s.
- Labels: "X, current community" / "Switch to X" / "Add community". The current item has `aria-current`.
- Arrow Up/Down move between items; Tab leaves the rail.
- `:focus-visible` ring.
- The tooltip (name + host, or connection state) appears on hover **and** keyboard focus. It is fixed-positioned, so the rail's scroll never clips it.
- Touch targets are 44 px. Motion is limited to 120 ms colour transitions; the spinner slows under `prefers-reduced-motion`.

## Layout

- The rail is rendered by `App.vue`, **outside `ErrorBoundary`** (like the header), so a crashing view can't take it down.
- `.app-body` is a row: `rail | .app-view`.
- `AppShell`'s resizable columns measure only `.app-view`, so the sidebar/details resize maths are untouched.
- `AppShell` itself was not changed.

## Files

- **New:**
  - `src/features/communities/useCommunitySwitch.ts`
  - `src/features/communities/ui/CommunityAvatar.vue`
  - `src/layouts/CommunityRail.vue`
  - `tests/unit/features/communities/communityRail.spec.ts`
  - this doc
- **Changed:**
  - `src/App.vue`: rail placement and routes
  - `src/layouts/CommunitySwitcher.vue`: uses the shared composable and `CommunityAvatar`
  - `tests/unit/features/communities/communitySwitcher.spec.ts`: icon fetch mocked, so there is no network in unit tests

## Automated verification

- `vue-tsc`: clean. `eslint . --max-warnings 0`: clean.
- `vitest run`: 136 files, 1433 tests pass.
  - The first full run flagged a UTF-8 BOM in the new spec (a Windows PowerShell write). It was stripped, and the BOM guard and rail spec re-run green.
- `communityRail.spec.ts` covers:
  - listing: verified only, added order, current first-class, no unverified candidate
  - the connection dot
  - switching: immediate switch; no-op on the active item; refusal keeps the current community and shows the error
  - `+` → the existing flow
  - **shared state with the switcher**: in-progress shown in both, both land on the new community, and no second switch can start
  - keyboard: arrow navigation, and the tooltip on focus

## Installed desktop app verification (2026-09-30)

### Build and install

- `npm run build` ✓
- `npm run tauri build` ✓. Artifacts:
  - MSI: `src-tauri/target/release/bundle/msi/SWF Buzz_0.1.0_x64_en-US.msi` (14:23:29)
  - NSIS: `src-tauri/target/release/bundle/nsis/SWF Buzz_0.1.0_x64-setup.exe` (14:23:52)
- The running SWF Buzz was closed. The NSIS installer ran silently over the existing install (exit 0);
  `%LOCALAPPDATA%\SWF Buzz\swf-buzz.exe` is now 14:23:40.
- Identity, communities and settings were preserved: the app opened as the same identity with both communities.
- Launched normally. **No WebView2 debugging**: port 9334 is not listening.
- No source file changed after the build started, so the installed build is exactly the tested code.

### How it was inspected

The user was actively using the machine, so the mouse and keyboard were never taken over:
- Screenshots used Win32 `PrintWindow` of the SWF Buzz window only.
- Structure and actions used **Windows UI Automation** against the WebView2 accessibility tree:
  reading the rail's `<nav>` and button names, and invoking buttons.

### Results (real identity; communities buzz.lmdconsulting.com and buzzdev.lmdconsulting.com, both "Member")

| Check | Result |
|---|---|
| Rail visible, fixed far left, 64 px | ✓ UIA `Group "Communities"` at x=8, width 64. Screenshot shows the rail left of the sidebar |
| Sidebar and existing switcher intact | ✓ |
| Current community in rail + other verified membership | ✓ "buzz.lmdconsulting.com, current community", "Switch to buzzdev.lmdconsulting.com", "Add community" |
| Unverified remembered URLs hidden | ✓ The picker reported "1 of your communities couldn't be reached". That one is not in the rail |
| Stable order | ✓ buzz, then buzzdev, in both states |
| Icon / fallback | ✓ Neither relay publishes an icon; the initial "B" is shown |
| Active indicator + connection dot | ✓ Accent pill + ring + green dot on the active item. It moved to buzzdev after the switch |
| **Rail → switcher sync** (A→B from the rail) | ✓ The switcher showed "buzz… Connecting…" during the switch, then "buzzdev.lmdconsulting.com · Connected". The channel list (welcome-everyone / general / Test Channel), DMs ("No conversations yet") and the user card all switched to buzzdev |
| **Switcher → rail sync** (B→A from the sidebar menu) | ✓ The menu showed "Switching…". The rail then marked buzz current and buzzdev "Switch to …". The channel list and DMs returned to buzz's |
| `+` opens the existing Add Community flow | ✓ Went to the existing "Where would you like to work?" picker (`communities` route); the rail is hidden there. No second implementation exists |
| Rail hidden on non-community routes | ✓ Picker, and connecting screens |

**Observed, pre-existing, not changed.** During a switch, `useAuth.switchCommunity` re-sets
the session identity, so `session.isReady` is briefly false. The whole app chrome, header and
rail alike, is hidden until the new community opens. The rail's spinner is therefore rarely
visible in practice; the switcher's "Switching…" is. Changing this is session/identity code,
which was out of scope.

### Not verified live

These still pass in unit tests:

| Item | Why it wasn't checked live | Unit test coverage |
|---|---|---|
| Hover styling, tooltip | Needs the pointer (the user was using it) | tooltip on focus |
| Keyboard focus / arrows / Enter | Needs keyboard focus (the user was using it) | arrow navigation |
| Error state + failed-switch restore; duplicate-switch prevention | Can't be triggered safely against production relays | covered |
| Inbox after switching | Not opened, to avoid clashing with the user's own use of the app at that moment. Channel list, DMs and user card were checked | — |
| Resize handles | Need a pointer drag | `AppShell` and its resize code are untouched |
| ≤ 768 px | The desktop window can't get that narrow: `tauri.conf.json` `minWidth: 960`. The rule is CSS-only (`@media (max-width: 768px) { .app-rail { display: none } }`) | — |
