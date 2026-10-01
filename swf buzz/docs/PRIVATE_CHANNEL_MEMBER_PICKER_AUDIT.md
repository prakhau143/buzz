# Private Channel Member Picker — Audit (Part 0)

**Date:** 2026-09-23
**Scope:** why "Add members" shows only existing channel members; header nav
cleanup; raw-pubkey DM entry removal.

---

## 1. Root cause

**"Add members" opens the read-only *Members* modal, which is fed by the
channel-member query. There is no community-member query in that path and no add
action at all.**

The chain, exactly as it runs today:

```
ChannelMenu.vue:31        "➕ Add members"  → emit("add-members")
ChannelsView.vue:280      @add-members="openMembersFromMenu"
ChannelsView.vue:176-179  openMembersFromMenu() → openMembers()
ChannelsView.vue:161-163  openMembers() → showMembersModal = true
ChannelsView.vue:265-270  <MembersModal :members="members" …>
ChannelsView.vue:63-68    members = useChannelMembers(selectedChannelId)
useChannelMembers.ts:9    channelService.fetchMembers(channelId)
```

`MembersModal.vue:36-43` then renders exactly that list and emits
`select-member` → `ChannelsView.vue:164-167` → opens a profile.

So the modal is a **member viewer**, not a member picker. It can only ever show
people already in the channel — when the channel has one member, it shows one
member. Nothing is broken in the data layer; the wrong data source is wired in,
and the add capability was never built.

This is precisely the "galat approach" shape:

```
getChannelMembers() → show picker
```

## 2. Current data sources (both already exist and are correctly separated)

| Concern | Service | Composable | Query key | Wire |
|---|---|---|---|---|
| **Community** members | `features/community-members/RelayMembersService.ts` | `useCommunityMembers()` (`useCommunityMembers.ts:15`) | `queryKeys.relayMembers()` | NIP-43 roster, kind:13534 snapshot |
| **Channel** members | `features/channels/ChannelService.ts` | `useChannelMembers()` (`useChannelMembers.ts:6`) | `queryKeys.members(channelId)` | NIP-29 channel membership |

No new service is needed. The two planes are already distinct — the picker just
never consulted the first one.

## 3. Add-member operation (already correct, already protocol-based)

`ChannelService.addMember` (`ChannelService.ts:101-104`) publishes
`buildPutUserEvent(...)` — **kind:9000** — through `signAndPublish`, i.e. the
existing Nostr signing service. `useChannelMemberActions.ts:16-21` wraps it with
a mutation that invalidates `queryKeys.members(channelId)` on success.

So Part 4's requirements (no direct DB writes, no new HTTP API, relay is the
authorization boundary, membership state refresh) are satisfied by wiring to
what already exists. Nothing new is required on the write path.

## 4. Authorization

- Community plane: `capabilities.ts:60` → `canManageCommunityMembers(role)` →
  owner/admin only (`community-members/permissions.ts:34-36`).
- Channel plane: `Member.role` from `useChannelMembers` — `ChannelsView.vue:69-71`
  already computes `myChannelRole`.
- The relay is the real enforcement point (`relay_admin.rs`); UI gating is
  fast-fail UX only, as documented in `community-members/permissions.ts:7-13`.

The picker must therefore **hide/disable** Add for unauthorized users but must
not treat that as security.

## 5. Header navigation

`layouts/AppHeader.vue:35-39`:

```ts
const navLinks = [
  { to: "/", label: "Home", matchNames: ["home"] },
  { to: "/community", label: "Channels", matchNames: ["community-channels"] },
  { to: "/community-dm", label: "Direct Messages", matchNames: ["community-dm"] },
] as const;
```

Purely presentational. Removing the last two entries removes the header links
only — the **routes** `/community` and `/community-dm` stay registered, because
the sidebar and other views navigate to them by name.

## 6. Raw pubkey DM entry

`layouts/AppSidebar.vue`:

- `114-115` — `newDmPubkey`, `newDmError` refs
- `137-151` — `startNewDm()` (hex validation, `open([pubkey])`, navigate)
- `205-215` — the `.new-dm` block: input `placeholder="Pubkey (hex) to message…"`
  + `Start` button + error paragraph

Removing these leaves the DM list itself (`188-203`) untouched.

The supported flow already exists: `UserProfilePanel.vue:28-36` `startDm()` →
`useOpenDm().open([pubkey])` → route to `dm`. After the sidebar box is removed,
`UserProfilePanel` is the only remaining DM entry point — Part 9's "one shared
entry function" is satisfied by extracting that open+navigate pair so every
Message action uses it.

## 7. Files to modify

| File | Change |
|---|---|
| `src/features/channels/useChannelMemberPicker.ts` | **NEW** — picker view-model: community ∖ channel |
| `src/features/channels/ui/AddMembersModal.vue` | **NEW** — the picker UI |
| `src/features/channels/ui/MemberPickerRow.vue` | **NEW** — profile-enriched row |
| `src/features/dm/useDirectConversation.ts` | **NEW** — shared `openDirectConversation()` |
| `src/views/ChannelsView.vue` | route `add-members` to the new modal |
| `src/layouts/AppHeader.vue` | drop two nav entries |
| `src/layouts/AppSidebar.vue` | remove raw-pubkey DM block |
| `src/features/channels/ui/UserProfilePanel.vue` | use the shared DM entry |

## 8. Files that must NOT be modified

`ChannelService.ts`, `RelayMembersService.ts`, `useChannelMembers.ts`,
`useCommunityMembers.ts`, `useChannelMemberActions.ts`, `protocol/membership.ts`,
`protocol/relayMembers.ts`, the router's channel/DM routes, `MembersModal.vue`
(still the members *viewer*), `DmService.ts`/`Kind41010Transport.ts`,
`identitySession.ts`, `capabilities.ts`, `permissions.ts`.

No new backend, no parallel membership system, no second profile model.
