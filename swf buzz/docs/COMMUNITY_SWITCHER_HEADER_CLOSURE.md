# Community Switcher + Header Closure

**Date:** 2026-09-28 · **Identity:** `8e428c1c…555f954a` · **Scope:** the community switcher's
list and switching, the top header, and app-level back/forward. Nothing else was redesigned.

## 1. Root cause: non-member communities appeared

`src/layouts/CommunitySwitcher.vue` built "Other communities" as
`communities.value.filter(c => c.relayUrl !== current)`. That is this device's **recent-address
book** minus the current entry. Nothing checked membership, so any relay ever typed or linked
(e.g. the `swf-development…localhost:3000` relay) was listed and clickable. Clicking was the first
moment the relay was asked, and the answer was "not a member".

## 2. Membership filtering

Recent addresses and accessible communities are now separate concepts:

```text
recent addresses (relayCommunities, localStorage)        ← candidates only, grant nothing
   → signed membership probe per relay                  ← existing communityDiscovery.discoverMemberships
     (NIP-98 POST /query: the relay authenticates the key, 403 to a non-member)
   → role from the relay-signed kind 13534 roster
   → accessible ⟺ role ∈ {owner, admin, member}          ← useAccessibleCommunities.accessibleOnly
   → CommunitySwitcher "Other communities"
```

- **Excluded:**
  - not a member (403)
  - blocked
  - unreachable
  - unknown to the relay (404, forgotten by the existing discovery)
  - **allowed in but with no roster role** (an open relay that doesn't name this pubkey is not a
    verified member)
  - malformed or stale addresses
- **Nothing is stored locally as authority.** The list is re-verified **every time the menu
  opens** ("Checking your communities…"). The target is verified **again right before
  switching**. Recent addresses are kept as candidates only; the existing "Add community" flow
  still uses them.
- **Why a signed HTTP probe and not a NIP-42 socket per candidate:** the app has one relay socket
  (`RelayConnectionService`), and opening sockets to every candidate would disturb it. The NIP-98
  probe proves possession of the same key to the same relay, which applies the same
  `relay_members` check (`relay_membership_required`). It is the mechanism the community picker
  already used.

**Live evidence** (same probe, your identity):

| Relay | Probe | Role | Listed |
|---|---|---|---|
| `wss://buzz.lmdconsulting.com` | 200 | member | yes (current) |
| `ws://localhost:3000` (local dev relay) | **403** `relay_membership_required` | — | **no** |

## 3. Community switch

The old path, `useAuth.switchCommunity` → `beginIdentitySession`, **tears down community A before
connecting to B**. A refused B therefore left the app in neither community.

The switcher now does:
1. `verify(B)`: a fresh signed probe. If B isn't owner/admin/member, stop: **A is never touched**,
   an error is shown, and the list refreshes.
2. `switchCommunity(B)`: same identity, A-scoped state torn down, NIP-42 to B, role resolved.
3. If B still fails (e.g. membership changed between steps 1 and 2): `switchCommunity(A)`
   restores A, and the error says "You're still in A."

## 4. Cache / session isolation

Unchanged, because the existing architecture is correct:
- Relay-backed query keys are `communityScoped(...)`.
- `beginIdentitySession` tears down the socket, signer, caches, presence and selection before
  every connect.
- `tests/unit/features/communities/communityIsolation.spec.ts` (A → B → A) passes in all runs.

New state added here follows the same rule:
- Navigation history is reset on teardown, and every entry carries its community.
- The accessible list is keyed to the current pubkey. A result arriving after an identity switch
  is discarded.

## 5. Header

| Before | After |
|---|---|
| `☰` glyph · SWF Buzz · **Home** · · · **Connected** · **avatar** · **Sign out** | `[sidebar]` `[‹ Back]` `[› Forward]` │ `[logo] SWF Buzz` |

- **Removed from the header only:**
  - Sign out stays in the bottom-left profile menu, with its confirmation.
  - Connection state lives in the community switcher, where it describes one community.
  - The brand mark still links home.
- **Icons:** `AppIcon` (ASCII SVG paths), with `chevron-left` / `chevron-right` added. No emoji
  or glyphs.
- **Sidebar toggle:** the same single `ui.sidebarCollapsed` state as before, now with
  `aria-pressed` and "Show / Hide sidebar" labels.
- The presence heartbeat and sync still live in this persistent component.

## 6. Navigation history

`src/stores/navHistory.ts` + `src/features/navigation/useAppNavigation.ts`:

- **Entries:**
  - `{type:"channel", community, channelId}`
  - `{type:"dm", community, conversationId}`
  - `{type:"thread", community, parent, parentId, rootEventId}`
- **Recording:** a visit is recorded when the **route** (`/channels?channelId`,
  `/dm?conversationId`) or the **open thread** changes.
  - Login, home, auth, loading, modals, profile panels, typing, presence and read-state updates
    never change those, so they never create entries.
  - A community change alone doesn't record either.
  - A thread counts only while you're still in the channel/DM where it was opened, so a stale
    thread panel can't create a "DM + thread" entry.
- **Back / Forward:**
  - They replay entries without recording new ones.
  - A new visit after going back drops the forward branch.
  - Entries from another community are skipped, so they're never rendered against the current
    community.
  - History is cleared on identity/community teardown.
  - Buttons are disabled (muted, not clickable) when there's nowhere to go.
- **Keyboard:** Alt+Left / Alt+Right are consumed with `preventDefault` so the webview's own
  history doesn't also move. There's no conflict with existing shortcuts: `Ctrl+,` is Settings.
- **Not done:** `window.history.back()` is deliberately not used, because the router history also
  contains login and query-only steps.

## 7. Responsive

The real `AppHeader` was screenshotted through a temporary harness page (headless Edge), then deleted:

- **375 px:** `☰ ‹ ›` and the brand on one line, no overflow or collision.
- **768 and 1440 px:** the same, with Back/Forward muted when disabled.
- Other widths (1710, 1280, 1024, 430, 390) weren't captured separately. The header is a single
  non-wrapping flex row of four fixed-size items (~250 px total), so it can't overflow at ≥ 375 px.
- **The collapsed "compact icon rail" was not built.** Collapsing still hides the sidebar, as
  before, per "preserve existing responsive behaviour". Mobile keeps the existing drawer.

## 8. Accessibility

- **Icon buttons:** `aria-label` Back / Forward / "Show|Hide sidebar", with the tooltip text
  extending the label, never replacing it.
- **Disabled state:** native `disabled`, so it's exposed and not activatable.
- **Focus:** visible ring on header buttons.
- **Switcher:** a menu with Escape and outside click (existing `AnchoredPopover`), arrow-key item
  focus, a `role=status` "Checking…" line, and a `role=alert` error.

## 9–10. Tests

New and updated:
- **`tests/unit/features/communities/communitySwitcher.spec.ts` (7):**
  - the role rule
  - a remembered non-member localhost relay is not listed
  - a role-less "allowed in" candidate is not listed
  - only the current community when it's the only membership
  - A → B switch
  - target not a member at click time → A never torn down
  - target fails after verification → A restored, with a message
- **`tests/unit/features/navigation/appNavigation.spec.ts` (6):**
  - records channel / DM / thread visits with the community
  - login / home / profile panel create nothing
  - back/forward walk and button states
  - back into a thread reopens it
  - the forward branch drops
  - never navigates into another community's entry
- **`tests/unit/layouts/navigationSurface.spec.ts`: header tests rewritten** for the new
  contract, which you requested (the old test asserted "Home only"). They assert: exactly three
  buttons + brand; no Home / Connected / avatar / Sign out; Back/Forward start disabled.

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `cargo check` | PASS |
| `cargo test` | PASS: 78 |
| Unit suite run 1 / 2 / 3 | **1176/1176 · 1176/1176 · 1176/1176** (116 files each) |

## 11. Runtime verification

- **Done (real relays, your identity):** the membership probe the switcher now uses accepts
  `buzz.lmdconsulting.com` (member) and rejects `localhost:3000` (403). This is the exact
  include/exclude decision in section 2.
- **Header rendering:** verified by screenshots of the real component.
- **Not done: clicking through the Tauri window** (the switcher menu, Add community, and a switch
  between two real member communities). This identity is a member of only one community I can
  reach, so an A → B switch between two *real* member communities can't be exercised with it.
  The unit tests cover it with verified mocks.
- The exact tenant host shown in your screenshot (`swf-development-179009…localhost:3000`) wasn't
  probed individually. It's excluded by the same rule if it answers 403, 404 or can't be reached.

## 12. Remaining limitations

1. Tauri click-through not yet done (section 11).
2. There's no second real member community to demonstrate a live A → B switch.
3. The collapsed sidebar is hidden, not an icon rail (existing behavior kept).
4. The accessible list is re-verified on open, so a slow relay shows "Checking…" briefly. The
   last verified list isn't shown instantly, because showing it could display a community you
   were just removed from.

## Summary answers

- **Visible to the current identity:** `buzz.lmdconsulting.com` (current). No other remembered
  address is a verified membership.
- **Why non-members are excluded:** only a relay's signed-probe answer of owner/admin/member
  qualifies. Remembering an address grants nothing.
- **A → B → A isolation:** passes (existing isolation suite, all runs). Navigation history and the
  accessible list are identity- and community-scoped.
- **Back/forward:** passes (6 tests).
- **Header contains only the intended controls:** yes (test plus screenshots).
- **Existing functionality intact:** full suite green three times; typecheck, lint, build and
  cargo pass. The Tauri click-through is still pending.
