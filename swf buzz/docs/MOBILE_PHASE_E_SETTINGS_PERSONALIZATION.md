# Phase E — Settings & Personalization

Date: 2026-09-30. Builds on Phases A–D. Not committed.

## E0. Audit: what already exists

Most of Settings is already real, working SWF code from the earlier settings work (`docs/SWF_SETTINGS_FEEDBACK_IMPLEMENTATION.md`, `docs/SETTINGS_LAYOUT_IMPLEMENTATION.md`, `docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md`). Phase E keeps it and fills the gaps rather than rebuilding it.

| Area | Where | Finding |
|---|---|---|
| Route / shell | `/settings?section=&from=` (router `meta.fullscreen`), `SettingsView.vue` | Full-screen shell: 240 px sticky sidebar (Back to app, search, groups, version), full-width content (`.content-inner` has no max-width, since the earlier layout fix), and a compact bar with a `<select>` picker at ≤ 860 px. Escape closes (unless a dialog consumed it); Back returns to `from` (in-app paths only). **Gaps:** nav rows 36 px, back 32 px, search 34 px, compact controls 36 px (under 44); no phone presentation (phones got the desktop compact bar); no Communities list; no Support/Feedback entry |
| Registry | `settingsRegistry.ts` | Allowlist of sections (excluded OLD BUZZ features cannot come back through a flag). Groups: Personal / Community / App. Sections: profile, appearance, notifications, shortcuts, custom-emoji, community, invites (managers only), mobile, updates |
| Profile | `ProfileSection.vue` → `features/profile/myProfile.ts` (`saveMyProfile`), `profileStore` (canonical registry), `resolveIdentityProfile` | **Universal** identity profile: published to the open community, canonical everywhere in the app at once, replicated to every other community with a per-community outcome. Display name (required), designation, about, photo (validated, re-encoded upload), unknown kind:0 fields preserved; npub / NIP-05 shown; no private key |
| Appearance | `AppearanceSection.vue` → `features/appearance/appearance.ts` | Device-local: mode System / Light / Dark, light and dark themes, accent, text size, density, zoom; instant apply, "Saved" only when stored, reset |
| Notifications | `NotificationsSection.vue` → `notificationSettings.ts` | Per identity, on this device: desktop alerts (real OS permission shown), per-slot toggles, sound, badge, taskbar, test alert. Read by the ONE `useNotificationService` / `alertIfAllowed` / `useInboxBadge` |
| Shortcuts | `ShortcutsSection.vue` ← `shortcutRegistry.ts` | Read-only, rendered from the same registry the handlers use; mac / Windows key labels. **No customization engine exists**, so none is invented |
| Custom emoji | `CustomEmojiSection.vue` → `customEmoji.ts` (NIP-30 kind 30030) | Upload → preview → shortcode validation → publish MY set; the whole community palette is shown; only my own emoji are removable (a set is per author — nobody can mutate another's) |
| Community | `CommunitySection.vue` | The OPEN community: local name label, icon (kind 9033, relay decides), relay URL, members/roles and moderation panels (role-gated), leave |
| Communities list | `useCommunitySwitch` / `useAccessibleCommunities` (probe + relay-signed roster role), `CommunityRail`, `CommunitySwitcher` | Exists as switching UI; **no Settings page** |
| Send feedback | `SendFeedbackDialog.vue` (profile menu, AppSidebar) → `feedbackService` (kind 42000 over the open relay → deployment-wide `product_feedback`, read by operators) | Categories Bug / Praise / Needs work, required message, images + MP4 video, opt-in diagnostics (5 fields, secrets redacted), stages uploading / sending / sent / error. **Not reachable from Settings or from mobile** |
| Roles | `capabilities.ts` | `platformRole: operator` (deployment) is separate from `communityRole` (owner/admin/member). Neither implies the other |
| Mobile | `MobileProfileView` | Links to only three settings sections, which opened the desktop compact layout on the phone |

## Plan

1. **Registry and navigation (E1, E10).** Regroup into **Profile · App · Communities · Support**:
   - Profile: Profile.
   - App: Appearance, Notifications, Shortcuts, Custom emoji, Mobile, Updates.
   - Communities: **Communities** (new), Community (open community), Invites (managers).
   - Support: **Send feedback** (new).

   Existing working sections (Mobile pairing, Updates, Community, Invites) are SWF features, not excluded OLD BUZZ ones, so they stay. No placeholders.
2. **Desktop shell (E1).** Controls reach 44 px (back, search, nav rows, compact bar); the full-width content is unchanged.
3. **Communities (E7).** A list of communities this identity can **actually** open (`useCommunitySwitch().accessible`, re-verified with `refreshIfStale`). Each row shows the icon, name, host, role from the relay roster, and connection state for the open one. **Switch** runs the verified `switchTo` (with shared error); **Add community** uses the existing flow. Operator is shown as a separate deployment-level line, never as a community role.
4. **Send feedback (E8).** A Support page describing who reads feedback and what is (not) sent, opening the SAME `SendFeedbackDialog` (no second form or transport).
5. **Mobile settings (E9).** At phone width `SettingsView` renders a mobile screen: safe-area header with back to where you came from, the section title, and the same section component (same state, same persistence). With no section it shows the grouped settings list. `MobileProfileView` lists every visible section plus Send feedback.
6. Profile / Appearance / Notifications / Shortcuts / Custom emoji: kept (already meet E2–E6). Only phone-width polish where QA finds problems.
7. Tests, visual QA (phone and desktop widths, light / dark), security audit (bundle scan, payloads, storage), full verification.

---

## Architecture decisions

- **Keep, don't rebuild.** Profile, Appearance, Notifications, Shortcuts, Custom emoji, This community, Invites, Mobile pairing and Updates were already real implementations on the right sources of truth. Phase E changes their navigation, touch sizing and phone presentation — not their logic or storage.
- **One section component per page, two presentations.** `SettingsView` chooses the desktop shell or the phone screen (`useIsMobile`), and both render the same lazily loaded section. There is no mobile copy of any section, and therefore no second state or persistence layer.
- **The registry is still an allowlist.** Two sections were added (`communities`, `feedback`). Excluded OLD BUZZ features can still not appear, and there are no placeholders.
- **No new services.** Communities uses `useCommunitySwitch` / `useAccessibleCommunities` (the rail's source). Feedback opens the existing `SendFeedbackDialog` (kind 42000 transport). Notifications stays on `notificationSettings` → `alertIfAllowed` / `useInboxBadge`.

## E1. Settings shell

- **Desktop:** Back to app, search, grouped nav, and a full-width content column (`240px | minmax(0, 1fr)`; `.content-inner` is `width: 100%`, no max-width). Measured widths were 1200 / 1040 / 804 px at 1440 / 1280 / 1024, and 768 at 768 (compact bar). Escape closes Settings unless a dialog or menu owns it. Back returns to the `from` in-app path only (never `//…` or `/settings`).
- **44 px targets:** Back to app, nav rows, the compact back and picker, and every button, field and select inside a settings page. Nav rows also got `focus-visible` rings.
- **Groups (E10):**
  - Profile: Profile.
  - App: Appearance, Notifications, Shortcuts, Custom emoji, Mobile, Updates.
  - Communities: Communities, This community (renamed from "Community" so it isn't confused with the list), Invites (owners and admins only).
  - Support: Send feedback.

## E2. Profile

Unchanged logic. It is the universal identity profile (`saveMyProfile`): published, canonical everywhere at once, and replicated to every community with per-community results. It has validation, upload, loading, error and "Saved" states, and never touches a private key. Consistency across surfaces comes from the single `profileStore` registry, covered by the existing `profileConsistency.spec`. On a phone it renders full width with 16 px fields.

## E3. Appearance

Unchanged logic: System / Light / Dark, light and dark themes, accent, text size, density and zoom. It applies instantly, persists per device, and has reset. Changes:

- Accent swatches are now 44 px targets around a 28 px disc, with an inset ring on the selected one (visible `focus-visible`).
- Segmented options are 44 px.
- Zoom buttons are 44 px.

## E4. Notifications

Unchanged logic. It is per identity on this device and feeds the ONE pipeline. It has the DM, mention, thread-reply and needs-action slots, desktop alerts with the real OS permission state, notify-while-viewing, sound, Inbox badge, taskbar indicator and a test alert. A change takes effect on the next event immediately (tested through `shouldAlert`).

`ToggleSwitch` is now a 48 × 44 button around the 40 × 22 track, used on every toggle.

## E5. Shortcuts

Read-only, rendered from `shortcutRegistry` (the same table the handlers use), with mac and Windows labels. **Customization is not offered.** The dispatcher has no rebinding or persistence layer, and inventing one would be the fragile keybinding engine the brief warns against. This is documented as a limitation.

## E6. Custom emoji

Unchanged logic (NIP-30 kind 30030):

- Upload → preview → shortcode validation (`aria-invalid`) → publish **my** set.
- The whole community palette is shown.
- Only my own emoji can be removed, because removal rewrites my own signed set, and nobody can mutate another author's set. This is tested.

Changes: the remove control is a 44 px target and is always visible on touch screens (it used to appear only on hover, which phones don't have).

## E7. Communities (new)

`CommunitiesSection.vue` lists the communities this identity can actually open, from the same source as the rail. It re-asks membership on open ("Checking membership…").

- **Rows:** the open community first, with its live connection state from the connection store (Connected / Connecting / Reconnecting / Offline / Not authorized / Error, with a dot and a word). Each row shows the icon, name, host, and role from the relay-signed roster ("Role not confirmed" when the relay gave none).
- **Switch:** runs the shared verified switch. While it runs, all Switch buttons are disabled and the target reads "Switching…". A refusal shows the shared error (`role=alert`) and you stay where you were.
- **Add community:** uses the existing flow.
- **Access card:** "Role in &lt;community&gt;" (the community plane) and "Deployment access: Operator / None" (the platform plane), with a plain note that neither implies the other. Operator is never inferred from ownership, and ownership never from operator status (tested both ways).

## E8. Send feedback (new Settings entry)

`FeedbackSection.vue` has the categories (Bug / Praise / Needs work), a "Write feedback" button, and the facts:

- only this deployment's operators read it (not community members, owners or admins);
- it is signed with your public key, and the private key never leaves the signer;
- diagnostics are opt-in, 5 fields, with key-like text redacted.

The button opens the **same** `SendFeedbackDialog`, which the profile-menu entry still uses as well: required message, images and MP4, sending / success / error-and-retry states, and the kind 42000 transport.

The dialog is teleported to `<body>`. Rendered inside the animated settings page, its fixed overlay was confined to the page box (a real bug found in QA).

On phones the dialog is a bottom sheet (full width, `94dvh`, safe-area padding), and its action buttons are 44 px.

## E9. Mobile settings

- **At < 768 px `SettingsView` renders a phone screen:** a safe-area header with a 44 px back button and the section title, and a scrolling body. `--app-height` visual-viewport tracking keeps forms keyboard-safe, inputs are 16 px (no iOS zoom), and page actions stack under the description.
- **Without a section** it shows the grouped list (Profile / App / Communities / Support) with descriptions.
- **Back navigation:** a section opened from that list is a real step (`push`, `via=list`) and its back returns to the list. A section opened from the Profile tab goes straight back to `/m/profile`. With no `from`, back lands on `mobile-profile`, not a desktop route.
- **The mobile Profile tab** now lists **every visible section** in the same groups (it used to show only three), including Communities and Send feedback. Invites appears only for managers.
- **No bottom-nav conflict:** Settings is a full-screen stack page with no bottom nav.

## E11. State and persistence

| Setting | Scope | Store |
|---|---|---|
| Profile | Identity (all communities) | Nostr kind:0 via `myProfile` / `profileStore` — not local |
| Appearance | This device | `swf-buzz:appearance.v1` |
| Notifications | This identity on this device | `swf-buzz:notifications.v1:<pubkey>` — another identity on the same device does not inherit it (tested) |
| Shortcuts | Code (read-only) | — |
| Custom emoji | Community (my set) | kind 30030 on the relay |
| Community name label | This device | community address book |
| Community icon / roles / invites | Community | relay (role-gated by the relay) |
| Memberships / roles | Relay answer, re-asked | `access` store (never authority) |

No secret is stored in any of them (tested: the settings storage dump has no key material).

## E12. Accessibility

- One `h1` per page. On phones it is visually hidden under the header title but still read.
- Group headings are `h2`. Nav buttons use `aria-current="page"`.
- Toggles are `role=switch` with labels. Segmented controls are `radiogroup` with arrow keys. Swatches are `radiogroup`.
- Validation uses `aria-invalid`. Errors use `role=alert` and statuses use `role=status` / `aria-live`.
- Visible `focus-visible` rings on nav, back, list items, segments, swatches and toggles.
- 44 px targets throughout (swept automatically).
- Reduced motion is respected (the page-in and toggle transitions).
- Connection state is shown as text plus a dot, never colour alone.

## E13. Performance

No new store, subscription, poll or timer:

- Communities reuses the switch's shared state and asks membership once per visit.
- Feedback mounts the dialog only when opened.
- Viewport tracking starts and stops with the phone tier and on unmount.
- Sections stay lazily loaded.

## Security audit (E17)

| Check | Result |
|---|---|
| `nsec` / key material logged | No `console.*` in `src` touches nsec / secret / private-key values |
| Private key in settings state or storage | None. Settings keys hold preferences only (tested) |
| Private key in notification payloads | Payload is ID-only with a 16-char identity fingerprint (tested); previews hide `nsec1…` / `ncryptsec1…` (existing) |
| Private key in feedback | Event = message + category + attachment refs (tested); diagnostics redact nsec / ncryptsec / 64-hex / tokens / `Nostr` auth headers (tested) |
| Secrets in URLs | Settings URLs carry `section`, `from` (in-app path only, validated), `via` |
| Secrets in localStorage | None found (tested dump) |
| Cross-community / identity leakage | Notification settings keyed per pubkey (tested); community data comes from community-scoped queries and the relay |
| Community-level authorization | Icon, members, roles and invites stay relay-gated. Custom emoji mutate only my own signed set (tested) |
| Operator vs owner / admin / member | Separate planes, shown separately, never inferred (tested) |
| Production bundle scan | `dist/**/*.{js,html,css}` scanned for `nsec1…`, `ncryptsec1…`, PEM private keys, `sk_live_`, AWS keys: **0 hits** |

The existing mobile-pairing code is shown only on the pairing screen with "contains a one-time secret" guidance; Phase E does not change it.

## Responsive and visual QA (E15)

A temporary harness rendered the real `SettingsView`, all section components and `MobileProfileView` in headless Chrome. It used deterministic data: a canonical profile, three communities with roles, and a custom-emoji palette. A key-less stand-in signer held every relay request in flight, so no network or keys were involved. The harness was **deleted** afterwards; Chrome and Vite were stopped, and ports 1420, 9333 and 9334 were confirmed closed.

- **Phones — 390×844, 375×812, 360×800, 320×720; light and dark.**
  - Checked: the settings list, every section (profile, appearance, notifications, shortcuts, custom emoji, communities, this community, invites, mobile, updates, feedback), the Profile tab, and the feedback sheet.
  - Result: **no horizontal overflow, no off-screen elements, no clipped text**, one `h1` per screen. After the fixes below there were **no interactive controls under 44 px**, apart from the native 13 px diagnostics checkbox, whose whole label row is the click target.
- **Desktop — 1440, 1280, 1024, 768; light and dark.**
  - Checked: profile, appearance, notifications, shortcuts, custom emoji, communities, this community and feedback.
  - Result: content fills the column (1200 / 1040 / 804 / 768 px), with no overflow and no controls under 44 px.

**Fixed during QA:**

- Toggles were 40×22, segments 30 px, accent swatches 28 px, zoom buttons 30 px, emoji remove 20 px (and invisible on touch), inputs 34–36 px. All are now 44 px targets.
- "This community" name field was squeezed to 26 px at 320. It is now a stacked row.
- The feedback overlay was confined to the page box. It is now teleported to `<body>`, and is a bottom sheet on phones.
- Swatch colours overrode the new hit-area clip. They now use `background-color`.
- On phones, page actions sat beside the description. They now stack underneath.

Screenshots are in `docs/assets/settings-e/` (10 files).

## Files changed

| File | Change |
|---|---|
| `src/features/settings/settingsRegistry.ts` | Profile / App / Communities / Support groups; `communities` and `feedback` sections; "This community" label |
| `src/features/settings/ui/SettingsView.vue` | Phone screen (list + section, back rules, viewport tracking); 44 px shell controls; 44 px buttons and fields in pages; two new lazy sections |
| `src/features/settings/ui/sections/CommunitiesSection.vue` | **new** (E7) |
| `src/features/settings/ui/sections/FeedbackSection.vue` | **new** (E8) |
| `src/features/settings/ui/primitives/ToggleSwitch.vue` | 44 px button around the track; focus ring on the track |
| `src/features/settings/ui/primitives/SegmentedControl.vue` | 44 px segments; focus ring |
| `src/features/settings/ui/sections/AppearanceSection.vue` | 44 px swatches (`background-color`) and zoom buttons |
| `src/features/settings/ui/sections/CustomEmojiSection.vue` | 44 px remove control, always visible on touch |
| `src/features/settings/ui/sections/CommunitySection.vue` | Stacked name row, 44 px field |
| `src/features/feedback/ui/SendFeedbackDialog.vue` | Phone bottom sheet; 44 px actions |
| `src/features/mobile/views/MobileProfileView.vue` | Every visible section, grouped from the registry |
| `tests/unit/features/settings/settingsShell.spec.ts` | **new** (12) |
| `tests/unit/features/settings/phaseESections.spec.ts` | **new** (15) |
| `tests/unit/features/settings/settingsRegistry.spec.ts` | Allowlist expectation updated to the Phase E structure (still exact, still bans excluded sections) |
| `docs/assets/settings-e/*.png` | QA screenshots |

## Tests added (E14): 27

The numbers below refer to items in the Phase E brief.

- **`settingsShell.spec.ts`** (1, 2, 18, 19, 21, 22):
  - nav groups and allowed sections only; excluded sections absent; Invites for managers only
  - `aria-current`
  - section switch uses `replace`
  - Back to app accepts in-app paths only
  - Escape closes unless a dialog owns it
  - full-width and 44 px layout contract
  - phone list with no URL rewrite
  - list → section is `push` with `via=list`, and back returns to the list
  - Profile tab → section → back to `/m/profile`
  - back with no `from` goes to `mobile-profile`
  - phone safe areas, 44 px back, 16 px inputs, viewport tracking
  - Profile tab lists every visible section with correct links
- **`phaseESections.spec.ts`** (10–17, 20, 23, 24):
  - **Communities:** listing with the open community first and a real connection state; roles, including "not confirmed"; a live Reconnecting state; Switch goes through the verified switch, with the error shown; buttons disabled while switching; operator ≠ owner shown both ways; Add community.
  - **Feedback:** opens the same dialog, teleported to `<body>`; the copy covers audience and no private key.
  - **Custom emoji:** only my emoji are removable; `aria-invalid` on a bad name and Save disabled.
  - **Appearance:** persisted, applied as theme attributes, read back after reload; light/dark switching.
  - **Notifications:** persisted per identity; `shouldAlert` changes immediately; another identity doesn't inherit.
  - **No secrets:** none in settings storage; feedback event contents; diagnostics redaction; notification target is ID-only.

Already covered by existing suites and kept green:

- profile load/save/consistency (`profileConsistency.spec`)
- feedback validation, sending and error (`feedback.spec`)
- the appearance / notification / emoji models (`settingsModels.spec`)
- desktop regression across Inbox, search, notifications, rail, switching, reveal, DMs, threads and read state

## Final verification (E18)

| Check | Result |
|---|---|
| `npx vue-tsc --noEmit` | exit 0 |
| `npx eslint . --max-warnings 0` | exit 0 |
| `npx vitest run` | **152 files / 1613 tests passed** (Phase D ended at 150 / 1586: +2 files, +27 tests) |
| `npm run build` | exit 0 |

One earlier full run showed two failures:

- the feedback test written before the Teleport fix, which is now updated;
- a 5 s timeout in `messageListScroll` while a production build ran in parallel. It passes alone and in the clean full run.

## Known limitations

- **No real device.** Not verified on real Android or iOS, on a live relay, or in the installed Windows app (not rebuilt or reinstalled this phase). Everything was checked in emulated viewports plus unit tests.
- **Shortcut customization** isn't offered, because the architecture has no rebinding layer; the page is read-only.
- **Custom-emoji deletion** is limited to your own set by design (NIP-30 sets are per author). There is no community-wide moderation of emoji sets.
- **Community display names** are a device label (the relay stores none), so another device may show the host until it is renamed there.
- **Profile photo on phones** uses the file picker (drag-and-drop is desktop-only by nature).
- **Membership re-check:** Communities re-asks membership every visit. On a slow relay the list shows the last known answer with "Checking membership…" until it returns.
- **Excluded features:** Mobile pairing and Updates stay under App because they are existing SWF features, not excluded OLD BUZZ ones.

## Next phase

**Phase F — mobile interactions:** long-press message actions, swipe-back, pull-to-refresh, haptics where the platform allows, micro-interactions, and a final accessibility and performance pass.

Then **real-device + live-relay QA**: Android, iOS, the installed Windows build, and real notification delivery and cross-community switching.

---

**PHASE E = COMPLETE.** E0–E18 are implemented or audited, and all automated checks are green. Nothing was committed or pushed.

