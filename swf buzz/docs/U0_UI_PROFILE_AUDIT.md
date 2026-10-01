# U0 — UI / Profile / Community-Management Audit (INVENTORY ONLY)

**Date:** 2026-09-24
**Status:** audit only. No code changed. Phase 4A untouched.

---

## 1. Architecture map

```
IDENTITY (Nostr keypair, Rust/OS keyring)
   │
   ├── PROFILE  ── kind:0, signed by the identity, identity-level
   │     protocol/profile.ts → services/ProfileService.ts
   │     → features/profile/identityProfile.ts (replicate to known communities)
   │     → composables/useProfile.ts (useProfile / useDisplayName / useProfileMap)
   │
   ├── COMMUNITY ROLE ── relay_members → kind:13534 roster (per tenant)
   │     RelayMembersService → useCommunityMembers → permissions.ts → capabilities.ts
   │
   └── CHANNEL ROLE ── NIP-29 kind:9000/9001
         ChannelService → useChannelMembers → useChannelMemberPicker
```

One socket = one community, so relay-backed reads are tenant-scoped by construction.

---

## 2. A — PROFILE

| Question | Finding |
|---|---|
| Schema | `display_name`, `name`, `about`, `picture` (`protocol/profile.ts:47-55`) |
| **Schema version** | **NONE.** No `profile_version` anywhere |
| **Designation field** | **DOES NOT EXIST.** Confirmed in Phase 4 audit that OLD BUZZ has no such field either — this is new |
| Completeness check | **DOES NOT EXIST.** `hasIdentityProfileAnywhere()` (`identityProfile.ts:194`) answers "has *any* kind:0", not "is complete" |
| Onboarding gate | `useAuth.ts:451-456`, at **login only** — not on community entry |
| Skip | `ProfileSetupView.vue:72` "Skip for now" → `profileSetup.ts:17` localStorage flag; `useAuth.ts:451` short-circuits on it |
| Picture | **URL-only and optional** (`ProfileSetupView.vue:65-67`), https-validated (`profile.ts:58-64`) |
| Identity-level store | **EXISTS** — `identityProfile.ts`: cache, `resolveIdentityProfile`, `replicateProfileToKnownCommunities`. **Reuse it; do not rebuild** |
| Live propagation | Publish replicates to known communities (`ProfileService.ts:55-59`); readers use Vue Query cache keyed `profile(pubkey)` |
| **Batching** | **NOT BATCHED — N+1.** `fetchProfile` makes **two** `fetchEventsOnce` calls per pubkey (kind:0 + agent check, `ProfileService.ts:25-28`). A 50-member list = **100 round trips**. `buildProfileFilter` already accepts `pubkeys: string[]` (`profile.ts:7-9`) but nothing uses the array form |
| Raw-pubkey fallback | `useDisplayName` falls back to `shortKey` (`useProfile.ts:28`); `parseProfileEvent` falls back to `pubkey.slice(0,8)` (`profile.ts:27`) |

**Person-rendering surfaces** (all must route through the shared lookup in U1):
`AvatarCircle.vue`, `MemberRow.vue`, `MessageItem.vue`, `ThreadSummaryRow.vue`,
`ThreadParticipantAvatar.vue`, `DmParticipantLabel.vue`, `AppSidebar.vue`,
`MemberPickerRow.vue`, `CommunityMemberRow.vue`, `UserProfilePanel.vue`,
`ChannelMemberSearchRow.vue`, `OperatorDashboardView.vue`, `DmView.vue`.

---

## 3. B — COMMUNITY MEMBERSHIP SCOPING

**I could not reproduce the reported cross-community leak from the code.** Reporting that honestly rather than inventing a cause:

- `fetchMembershipList()` uses `fetchEventsOnce` → the connected socket → one tenant. Community-scoped **by construction**.
- Switching communities calls `beginIdentitySession` → `tearDownConnectionScopedState()` → **`queryClient.clear()`** (`identitySession.ts:270`, `:213`). Caches do not survive a switch.
- The "Add members" picker already sources `community ∖ channel` (`useChannelMemberPicker.ts`), fixed earlier this session. The merged list the report describes matches the **pre-fix** modal, which showed channel members only.

**Latent risk (real, not the cause):** every Vue Query key is scoped by **identity but not by community** (`queryKeys.ts:29`). `relayMembers()`, `channels()`, `dmList()`, `presence()` are community-agnostic keys for community-specific data. Safety currently depends on the teardown calling `queryClient.clear()` — a behavioural guarantee, not a structural one. One missed teardown path reintroduces cross-community bleed.

**U2 must begin by reproducing the leak with two real communities.** If it cannot be reproduced, the work becomes adding the community dimension to the keys plus the authorization guard, not chasing a phantom.

---

## 4. C — PHOTO / MEDIA ⛔ STOP CONDITION

| Location | Media support |
|---|---|
| SWF frontend | **NONE.** Zero hits for `upload`/`multipart`/`FormData`/`blob`/`imeta` in `src/` |
| **"Server A"** = `swf-buzz-backend` (`backend/`, :8787) | **NO media route.** Routes are session, communities, invites, channels, messages, dm, ws |
| **Buzz relay** | **FULL Blossom support already exists** — `PUT /upload` (+ legacy `/media/upload`), kind:24242 auth + `X-SHA-256`, `GET /media/{sha256}`, byte-sniffed MIME, size limits, per-pubkey rate limiting, NIP-92 `imeta` tags |

So the options are **four**, not three — the fourth (use what already exists) was not on the original list:

- **A** Add an upload endpoint to `swf-buzz-backend` — new backend work, duplicates the relay
- **B** **Use the relay's existing Blossom** — no new backend; what OLD BUZZ's own clients do
- **C** https URL only (status quo)
- **D** Generated identicon default from the pubkey, user can replace

**Decision required before U1 touches the photo field.**

---

## 5. D — UI FOUNDATION

- **No icon package.** Icons are literal emoji/Unicode glyphs in markup (`☰ ⋮ 👥 🔒 # ➕ ⚙ 📋 🚪 ↩ 🔗 ⚠ ✓ ✕`), ~25-30 usages across ~15 files. `CloseButton.vue` is the **one** real inline `<svg>` — deliberately, to avoid the encoding corruption that previously mangled these files.
- **Tokens:** `src/app/theme/tokens.css` (the only CSS file in `src/`, loaded at `main.ts:7`). Beige/cream palette confirmed: `--color-bg #f7f3ea`, `--color-primary #b1592f`, `--color-brand #3f6b4f`. Spacing is already a 4px scale (`--space-1: 4px` … `--space-7: 48px`). Dark mode is a deliberate no-op.
- **Exists:** `BaseButton`, `AvatarCircle`, `StateView` (spinner, not skeleton), `CloseButton`, `useEscapeKey`, `useFocusTrap`.
- **Missing:** icon component, **shared modal shell** (every modal re-implements overlay+card), tooltip, toast, skeleton, confirmation dialog.
- **Confirmed bug:** `--color-accent` is **used in 11 places but defined nowhere** (`CloseButton.vue:67`, `MessageItem.vue:289`, `ThreadPanel.vue:107`, `ThreadSummaryRow.vue:97,117`, `IdentityDiagnosticsPanel.vue:213`, `AppSidebar.vue:405,444,461,462`, `LoginView.vue:354`). Several are **focus-ring outlines** — so focus rings are currently invisible or browser-default there.
- **No global focus-ring rule**; 17 component-scoped `:focus-visible` blocks instead.

---

## 6. E — CONVERSATION HEADER

Toggle at `AppShell.vue:84-88`, state `uiStore.detailsPaneOpen` (`ui.ts:21,37-39`), pane at `AppShell.vue:92-98`.

**Root cause of a real coupling bug:** panel *content* is chosen by `ui.contextPanel.kind`, but pane *visibility* is the independent `detailsPaneOpen` flag. `closeContextPanel()` (`ui.ts:62-64`) resets the kind to `"none"` **without** clearing `detailsPaneOpen`, leaving an **empty pane frame** that only the toggle can dismiss.

**Consequence for U2:** removing the toggle without fixing that coupling would strand users with an undismissable empty pane. The fix is to drive visibility from `contextPanel.kind` — every panel already has its own trigger elsewhere (thread reply, avatar click, ⋮ → Channel details), so no functionality is lost.

---

## 7. F — IDENTITY DIAGNOSTICS BADGE

Two dev-only mounts: `App.vue:45-48` (pre-sign-in) and `AppSidebar.vue:253` (`inline`).

**Root cause of the overlap**, quoted from `IdentityDiagnosticsPanel.vue:194-200`:

```css
.diag.inline .body {
  position: absolute;
  bottom: var(--space-3);
  left: var(--space-3);
  right: var(--space-3);
  z-index: var(--z-toast, 60);
}
```

Even in `inline` mode the expanded body is `position: absolute`, and **no ancestor** (`.sidebar-footer`, `.sidebar-content`, `.sidebar`) declares `position: relative` — so it resolves against a far-out containing block and lands on top of the sidebar's own footer buttons, with `z-index` guaranteeing it wins. Moving it into *My identity* removes the positioning problem entirely rather than nudging it.

---

## 8. G — COMMUNITY MODAL

Modal: `CommunityManagementModal.vue:44-64` — **Members / Moderation / Invites**.

### The audit log: none of (a), (b) or (c) — it is simply empty

The pipeline is wired correctly end to end:
publish kind:9040-9044 (`protocol/moderation.ts:65-117`) → relay ingest writes `moderation_actions` (`ingest.rs:2333-2341`) → SWF reads `GET /moderation/audit` (`ModerationService.ts:257-262`) → route registered (`router.rs:127`) → rendered (`ModerationQueuePanel.vue:167-177`).

**Verified against the live database:**

```
moderation_actions  = 0 rows
moderation_reports  = 0 rows
```

**No moderation action has ever been taken on this relay.** The log is empty because there is nothing to show — not a client bug and not a protocol gap. U3 needs a real ban/timeout performed to verify, not a rewrite.

**One real bug found:** `useModerationActions.ts:13-53` invalidates only `moderationRestrictions`, never `moderationAudit` — contrast `useModerationQueue.ts:19-28`, which does. So even after a genuine action the Audit tab shows stale data until its 15 s `staleTime` lapses.

### Protocol limits — requested UI that the relay cannot support

| Requested | Reality |
|---|---|
| **Invite revoke** | **Relay has no revoke path** — mint + claim only; invites expire by TTL or exhaust by max-uses. *But* `swf-buzz-backend` has `POST /api/invites/{id}/revoke` — **two different invite systems**; which one the Invites tab uses decides whether Revoke is buildable |
| **List active invites** | No GET enumerates a community's live invites; mint returns one invite at creation only |
| **Member added/removed, role changed history** | Only current-state snapshots (kind:13534) and point-in-time deltas (8000/8001) — **no queryable history** |
| **Channel created/deleted audit** | NOT FOUND |
| Ban / unban / timeout / untimeout / report-resolved | **Supported and readable** via `/moderation/audit` |

So U3's Moderation timeline can cover moderation actions and report resolutions, but **not** roster changes or channel lifecycle, and the Invites tab cannot list or revoke relay invites.

---

## 9. Risks

1. **Mandatory photo depends on an unmade decision** (§4). U1 stalls without it.
2. **Profile N+1** — mandatory avatars everywhere will multiply 2 requests/pubkey across every list unless batching lands first.
3. **Community-blind cache keys** (§3) — currently masked by `queryClient.clear()`.
4. **Removing the details toggle** without fixing the visibility coupling strands an empty pane (§6).
5. **Icons are emoji in markup**; these files have been corrupted by encoding before — bulk-editing them is exactly the operation that caused it. Any icon pass must be UTF-8-safe and verified.
6. **U3 scope is partly unbuildable** as specified (§8).
7. **Designation is new protocol surface** — a kind:0 field OLD BUZZ does not define. Harmless to other clients (unknown JSON keys are ignored) but it is an extension and should be recorded as one.

---

## 10. Recommended order

1. **Decide the photo question** (§4) — blocks U1.
2. **U1a — batch profile lookups first.** Make `fetchProfile` accept many pubkeys and use `buildProfileFilter`'s existing array form. Without this, U1 makes performance worse.
3. **U1b** — schema version + `designation` + completeness gate + blocking onboarding; then convert render surfaces.
4. **U2a** — fix the details-pane coupling, then remove the toggle.
5. **U2b** — reproduce the member leak with two communities *before* changing anything; add the community dimension to cache keys and the add-member authorization guard regardless.
6. **U3** — Members tab redesign; Moderation needs a real action to verify plus the invalidation fix; Invites limited by §8.
7. **U4** — define `--color-accent` (or replace the 11 usages), add a global focus ring, shared modal shell, then icons.
8. **U5** — full verification.
