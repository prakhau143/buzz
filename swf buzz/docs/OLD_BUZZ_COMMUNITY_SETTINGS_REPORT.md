# Old Buzz Community Settings Audit

Source audited (read-only): `buzz/buzz` (OLD BUZZ).
Path prefixes used below:

- **D** = `buzz/buzz/desktop/src`
- **T** = `buzz/buzz/desktop/src-tauri/src`
- **C** = `buzz/buzz/crates`

Every claim cites `path:line`. Anything the reader might expect but that the source does not contain is marked **not present in OLD BUZZ**.

---

## 1. Key facts

- **Most community settings are local-only.** Name, Relay URL, API Token and Repos Directory are saved to the localStorage key `buzz-communities` (D/features/communities/communityStorage.ts:6, 102-111).
- **The community icon is the only server-side community setting.** It is saved as a signed kind **9033** event and served in the NIP-11 document as `icon`.
- **The community name is never sent to the relay.** The relay's NIP-11 `name` is hard-coded `"Buzz Relay"` (C/buzz-relay/src/nip11.rs:203).
- **The API Token is stored but never used.** The client passes `token` to `apply_workspace` (D/shared/api/tauriWorkspace.ts:14), but the Rust command has no `token` parameter (T/commands/workspace.rs:153-160), so the value is dropped.
- **Roles are `owner`, `admin` and `member`.** They come from the relay-signed NIP-43 membership snapshot, kind **13534**.
- **The desktop app has no operator dashboard.** Operator and moderator tooling is a separate admin web app (`buzz/buzz/admin-web`) plus relay HTTP APIs.

---

## 2. Where community settings are opened

| Entry point | Label | Component | Citation |
|---|---|---|---|
| Bottom-left profile menu → hover the community row → submenu | "Community settings" (Settings2 icon) | `CommunitySwitcher` `variant="profile-menu"`, mounted in `SidebarProfileCard` | D/features/communities/ui/CommunitySwitcher.tsx:312-323; D/features/sidebar/ui/SidebarProfileCard.tsx:169-185 |
| Right-click a community in the community rail | "Community settings" | `CommunityRail` context menu | D/features/sidebar/ui/CommunityRail.tsx:281-284, 431-439 |
| "…" button on a row (dropdown variants `sidebar` / `profile`) | aria-label `Edit ${community.name}` | `CommunitySwitcher` | CommunitySwitcher.tsx:418-430. **Only the `profile-menu` variant is mounted in the app** (SidebarProfileCard.tsx:169) |
| Error screen shown when a community fails to apply | "Change community" | `CommunityChangeOverlay` → `CommunityEditForm` (Name and Relay URL only) | D/features/communities/ui/CommunityApplyErrorScreen.tsx:41-45; D/app/App.tsx:602-608 |

- The community rail is hidden when the user has one community or none (CommunityRail.tsx:337-339).
- The dialog is `EditCommunityDialog` (D/features/communities/ui/EditCommunityDialog.tsx).
  - Title: "Edit Community" (:129).
  - Description: "Update this community's name or relay URL." (:131).
- The icon editor inside the dialog is shown only when the community being edited is the **active** one (CommunitySwitcher.tsx:461; CommunityRail.tsx:438).

---

## 3. Edit Community form fields

The form is at EditCommunityDialog.tsx:134-235, with "Cancel" and "Save Changes" buttons at :227-234. `onSave` fires only if some field changed (:112-114).

Save calls `useCommunities.updateCommunity` (D/features/communities/useCommunities.tsx:286-317):
- It writes `buzz-communities`.
- It bumps `reinitKey` (a full restart of the community tree) only when `relayUrl`, `token` or `reposDir` changed on the **active** community (useCommunities.tsx:70-79, 309-311).

| Field | Control | Validation | Default | Save / storage | Sent to server? | Who may edit |
|---|---|---|---|---|---|---|
| **Community icon** ("Community icon" / "Shown in the community rail and switcher.") | `CommunityIconSettingsCard compact`, an image or emoji picker (EditCommunityDialog.tsx:138-148; CommunityIconSettingsCard.tsx:107-118) | **Client:** centre-square crop to 128×128, WebP q0.85 with PNG fallback (D/features/communities/lib/downscaleIcon.ts:9-33). **Relay:** empty clears the icon; no control or whitespace characters; `data:image/*` ≤ 98,304 bytes; otherwise `http(s)://` ≤ 2048 bytes (C/buzz-relay/src/handlers/relay_admin.rs:59-95) | NIP-11 `icon`. With no icon, the UI shows initials or 🐝 (CommunityRail.tsx:157-159) | **Saved immediately when the picker commits**, independent of "Save Changes" (CommunityIconSettingsCard.tsx:52-86). Error toast: "Couldn’t update the community icon." Local cache: `buzz-community-icons`, max 32 entries (D/features/communities/communityIconCache.ts:7-11) | **Yes.** kind **9033**, `content:""`, tags `[["icon", value]]` (D/shared/api/communityProfile.ts:19, 40-51). The relay stores it (relay_admin.rs:259-303) and serves it as NIP-11 `icon` (nip11.rs:30-33, 283-289). Other clients read it with Tauri `fetch_workspace_icon`, a GET with `Accept: application/nostr+json` (T/commands/workspace.rs:77-98) | **Client:** shown when the relay is open (`membershipRequired === false`) or the user's role is `owner`/`admin` (EditCommunityDialog.tsx:48-52). **Relay:** admin/owner; on an open relay with no admin or owner, any authenticated sender (relay_admin.rs:13, 97-123) |
| **Name** | `Input#edit-ws-name`, autofocus, placeholder "My Community" (:150-163) | Trimmed. "Save Changes" is disabled when the name is blank (:231) | `community.name` | Local `buzz-communities`. A name-only change does **not** restart the community | **No** (NIP-11 name is fixed, nip11.rs:203) | Anyone (local) |
| **Relay URL** | `Input#edit-ws-relay-url`, placeholder "wss://relay.example.com" (:165-179) | Required (:72, :231). `normalizeRelayUrl` prefixes `wss://` when there is no scheme (communityStorage.ts:192-197). A duplicate relay returns `duplicate-relay` (useCommunities.tsx:53-59), but **this dialog ignores that result** (EditCommunityDialog.tsx:112-116) | `community.relayUrl` | Local. On the active community it restarts and calls `apply_workspace` (D/features/communities/useCommunityInit.ts:312-319) | Only locally, as the backend `relay_url_override` (T/commands/workspace.rs:215-218). Nothing is published to the relay | Anyone |
| **API Token** "(optional)" | `Input#edit-ws-token type=password`, placeholder "buzz_..." (:180-197) | Trimmed; empty clears it (:90-93) | `community.token ?? ""` | Local. On the active community it restarts | Passed to `apply_workspace` but **dropped**, because the Rust command has no `token` parameter (T/commands/workspace.rs:153-160) | Anyone |
| **Repos Directory** "(optional)" | `Input#edit-ws-repos-dir`, placeholder "~/Development", inline error, help text "Point the agent's `REPOS` directory at an existing folder… Leave blank to use the default location." (:198-226) | Leading `~` is expanded; empty clears it (communityStorage.ts:46-60). A changed value must pass Tauri `validate_repos_dir` (EditCommunityDialog.tsx:101-110; T/commands/workspace.rs:126-137). Rules: must be absolute; must canonicalize; must be a directory; must not be the nest or an ancestor of it (T/managed_agents/repos.rs:23-55) | Unset means `<nest>/REPOS`, where the nest is `~/.buzz` (or `~/.buzz-dev` in dev) (T/managed_agents/nest.rs:95-102) | Local. On apply the backend writes `<nest>/.repos-dir` (repos.rs:197, 219-233) and symlinks `<nest>/REPOS` (workspace.rs:252-260). A bad value emits `repos-dir-error` (workspace.rs:197-207) | No (local filesystem) | Anyone |

The fallback form `CommunityEditForm` has only Name and Relay URL. It validates as follows:
- A blank name shows "Please enter a community name." (CommunityEditForm.tsx:96-98).
- It checks the join policy and probes the relay. If the relay is unreachable it shows "Can't reach this relay — check the URL", with a "use anyway" override (:105-165).
- A duplicate relay shows "Another community already uses this relay URL." (CommunityChangeOverlay.tsx:53-54).

The TypeScript `Community` type is at D/features/communities/types.ts:1-27. The Rust side has no struct of its own.

---

## 4. Feature inventory

| Feature | In OLD BUZZ? | Where / how |
|---|---|---|
| Community name | Yes, local-only | types.ts:3. The default comes from `deriveCommunityName` (communityStorage.ts:215-237): `localhost`, `127.0.0.1`, `[::1]` or `0.0.0.0` give "Local Dev"; a staging host gives "Buzz (staging)"; `relay.X.…` gives `X`; otherwise the first host label is used; if parsing fails, "Community". |
| Relay URL | Yes, local | See section 3. Duplicates are merged when a community is added (useCommunities.tsx:191-217). |
| API token | Yes, local; **ignored by the backend** | See section 3. |
| Repo directory | Yes, local filesystem | See section 3. |
| Community icon | Yes, server-side | kind 9033 and NIP-11 `icon`. Also editable in Settings → Hosted communities (D/features/settings/ui/HostedCommunitiesSettingsCard.tsx:597-600). |
| Community members list | Yes | Settings → Communities group → "Invites" (`community-members`). Visible only to owner/admin (D/features/settings/ui/SettingsView.tsx:69-70, 147-150). `CommunityMembersSettingsCard` shows a "Search members" box, a "Members {n}" header and a virtualized list (D/features/community-members/ui/CommunityMembersSettingsCard.tsx:248-389). Data is the latest kind **13534** (D/shared/api/relayMembers.ts:10, 106-128). |
| Roles | Yes: `owner` / `admin` / `member` | Type guard at relayMembers.ts:15-19. See section 5. |
| Ownership transfer | **Hosted communities only**; not possible over Nostr | Kind 9032 rejects `owner` as a target role (relay_admin.rs:439-440). UI: Settings → Hosted communities → "Transfer" → dialog "Transfer ownership" with an `npub1…` field (HostedCommunitiesSettingsCard.tsx:300-311, 836-839, 886-940). This calls Tauri `transfer_builderlab_community` → `POST https://app.builderlab.xyz/api/goose/v1/buzz/communities/transfer` (T/builderlab.rs:15, 621-634). Relay side: operator-only `POST /operator/communities/transfer` with body `{community_id,new_owner_pubkey,expected_owner_pubkey}` (C/buzz-relay/src/router.rs:103-106; api/operator.rs:39-44, 358-372). |
| Invites | Yes | See section 6. |
| Permissions | Role-based | `canManageCommunityMembers` = role is `owner` or `admin` (D/shared/api/relayMembers.ts:41-46). Whether membership is required comes from NIP-11 `supported_nips` containing 43 (T/commands/relay_members.rs:20-43). Admin commands require a global (not channel-scoped) token (C/buzz-relay/src/handlers/ingest.rs:2266-2277). |
| Channel management | Yes, but per channel; **not part of community settings** | NIP-29 kinds 9000/9001/9002/9007/9008 (C/buzz-core/src/kind.rs:335-345). UI: D/features/channels/ui/ChannelManagementSheet.tsx. |
| Copy community URL | Yes | "Copy community URL" (Link2 icon) in the profile-menu community submenu (CommunitySwitcher.tsx:286-297) and the rail context menu (CommunityRail.tsx:267-274). It copies **`community.relayUrl` exactly as stored**: the normalized `wss://host` (or `ws://`) URL. It is **not** an http or invite link, and no toast is shown. |
| Leave community | Yes | See section 7. |
| Delete community | **Not present in OLD BUZZ** (no hard delete) | — |
| Remove community locally without leaving | **Not present in OLD BUZZ** | Leaving is the only way to remove a community. |
| Archive / unarchive | Hosted communities only | Settings → Hosted communities → "Archive" / "Unarchive" (HostedCommunitiesSettingsCard.tsx:258-298, 789-870). Confirmation copy: "New and existing connections stop and the address stays reserved… it isn't deleted." Calls Builderlab `/v1/buzz/communities/archive` or `/unarchive` (T/builderlab.rs:589-614), which call relay operator `POST /operator/communities/archive` or `/unarchive` (router.rs:91-98). |
| Operator / admin controls | Relay-side and admin-web only; **no desktop operator dashboard** | See section 8. |
| Add / create community | Yes | See section 9. |
| Community switching | Yes; **no keyboard shortcut** | See section 10. |

---

## 5. Roles and membership protocol (NIP-43)

| Kind | Signed by | Tags / content | Meaning | Citation |
|---|---|---|---|---|
| 13534 | Relay | `["-"]` plus one `["member", <pubkey>, <role>]` per member. The client also accepts `["p", pk, relay, role]` | Membership snapshot | C/buzz-db/src/store/relay_members.rs:1013-1021; D/shared/api/relayMembers.ts:59-69 |
| 8000 / 8001 | Relay | `["-"]`, `["p", target]` | Member added / removed (delta) | C/buzz-relay/src/handlers/side_effects.rs:3104-3162 |
| 9030 | Admin/owner | `["p", hex]`, optional `["role", r]` (default `member`; `admin` requires owner) | Add member | relayMembers.ts:148-190; relay_admin.rs:312-479 |
| 9031 | Admin/owner | `["p", hex]` | Remove member. Admins can remove only `member`; the owner cannot be removed; users cannot remove themselves | same |
| 9032 | Owner only | `["p", hex]`, `["role", r]` (`owner` not allowed) | Change role | same; kind.rs:387-404 |
| 9033 | Admin/owner | `["icon", value]` | Set community icon | communityProfile.ts:40-51 |
| 28936 | Member | `content:""`, `[["-"]]` | Leave request | D/features/communities/leaveCommunity.ts:7, 64-68 |

Member-row UI:
- Actions: "Make admin" / "Make member" (owner only) and "Remove from community" (CommunityMembersSettingsCard.tsx:104-110, 193-239).
- Icons: Crown for the owner, Shield for admins (:152-157).

---

## 6. Invites

**Where invites are started**
- Profile-menu community submenu → "Invite to community". Shown only when the role is owner/admin (CommunitySwitcher.tsx:298-311; SidebarProfileCard.tsx:65, 176-179). It opens Settings → "Invites".
- Rail context menu: "Invite to community" (CommunityRail.tsx:322-325).

**Adding members**
- Direct add uses `DirectAddMemberForm` → kind 9030. The admin role option is shown only to the owner (AddMemberDialog.tsx:130).

**Invite links**
- Minted with `POST /api/invites` on the active relay.
  - Auth: NIP-98 kind 27235 with tags `u`, `method=POST`, `payload=sha256(body)` and `nonce`.
  - Body: `{ttl_secs?, max_uses?}`.
  - Response: `{code, expires_at, url, max_uses, uses_remaining}` (D/shared/api/invites.ts:17, 63-76, 194-217).
- UI options (D/features/community-members/ui/InviteLinkSection.tsx:19-35):
  - Expiry: 1 / 3 / 7 / 30 days (default 3 days).
  - Uses: No limit / 1 / 3 / 5 / 10 / 25.
- Relay limits (C/buzz-core/src/invite.rs:12-21; C/buzz-relay/src/api/invites.rs:5-6, 298-299):
  - TTL from 60 s to 30 days, default 72 h.
  - `max_uses` from 1 to 10,000.
  - Only owner/admin can mint.
- Link format: `{http|https}://<host>/invite/<code>` (api/invites.rs:351).

**Claiming an invite**
- `POST /api/invites/claim` with `{code, policy_receipt}`. This endpoint is exempt from the membership gate and grants role `member` (invites.ts:223-242; api/invites.rs:7-10).
- Related endpoints: `GET /api/join-policy` and `POST /api/invites/accept-policy`.
- Accepted inputs: `https://<relay>/invite/<code>`, `buzz://join?relay=<ws>&code=<code>`, or a bare code (D/shared/api/inviteHelpers.ts:18-77).

---

## 7. Leave community

**UI**
- Label: "Leave community", changing to "Leaving…" while in progress. Destructive styling, LogOut icon.
- Available only in the profile-menu community submenu, and only for the **active** community (CommunitySwitcher.tsx:324-341).
- **No confirmation dialog** (the handler runs immediately, :163-191).

**Event** (D/features/communities/leaveCommunity.ts:7, 64-68)

```json
{ "kind": 28936, "content": "", "tags": [["-"]] }
```

**Client behaviour** (leaveCommunity.ts:31-87)
- If the relay does not advertise NIP-43 (`relay_requires_membership` is false), nothing is published and the result is `left` (:60-62).
- If the community is the active one, the event goes out on the live `relayClient`. Otherwise a temporary `ReadOnlyRelayClient` is used and then disconnected (:70-87).
- An error containing "not a relay member" becomes `already-absent`. The toast reads "Community removed" / "You were no longer a member, so Buzz removed the community from this device." (CommunitySwitcher.tsx:175-180).
- Any other error is shown inline under the menu item. The default message is "Couldn't leave the community. Try again." (:181-187).

**Relay behaviour** (C/buzz-relay/src/handlers/ingest.rs:2584-2667)
- Rejects the request if membership is not enabled.
- Requires `created_at` within ±120 s and the `["-"]` tag.
- Removes the sender from `relay_members`. The event itself is **not stored**.
- Errors: `invalid: you are not a relay member` and `invalid: relay owner cannot leave`.
- On success it publishes kind 8001 and a fresh 13534, and replies `info: you have left this relay`.
- Channel-scoped tokens are rejected (ingest.rs:2274-2278).

**Local cleanup** (only after the relay accepts; D/features/communities/useCommunities.tsx:226-271; communityStorage.ts:37-38, 156-178; D/app/useCommunityNavigationTransitions.ts:74-125)
- Removes the self-profile and user-label caches, channel and project snapshots, the persisted channel-head cache, the saved agent-turn snapshot and the nav destination.
- Rewrites `buzz-communities` and activates the next community.
- If it was the last community, storage is cleared and `buzz-community-discovery-after-leave="1"` is set.

---

## 8. Operator / admin controls

**Desktop**
- **No operator dashboard and no operator menu item** exist in the desktop app. A search for "operator" in D found only search-operator parsing and the terminal palette.

**Relay operator HTTP API** (C/buzz-relay/src/router.rs:87-106)
- Endpoints: `/operator/communities` (GET list, POST provision), `/archive`, `/unarchive`, `/availability` and `/transfer`.
- Auth: NIP-98 with `u` = `RELAY_OPERATOR_API_ORIGIN` + path, and a pubkey listed in `RELAY_OPERATOR_PUBKEYS`.
- Otherwise it returns 403 "actor not authorized: not a relay operator" (C/buzz-relay/src/api/operator.rs:60-105; config.rs:256-273).

**Admin web** (`buzz/buzz/admin-web`, a separate SPA)
- Pages: reports and feedback. It signs NIP-98 kind 27235 requests through NIP-07 (admin-web/src/api.ts:1, 17, 51).
- Served only when the request Host equals the configured admin host (C/buzz-relay/src/api/admin/auth.rs:99-107).
- API under `/api/admin/v1`, mounted only when `config.admin` is set (router.rs:54-61).
- Principal resolution (auth.rs:1-28, 240-300):
  - Operator if the pubkey is in `RELAY_OPERATOR_PUBKEYS`.
  - Otherwise Operator (owner fallback) if the pubkey equals `RELAY_OWNER_PUBKEY` and the operator list is empty.
  - Otherwise the `operator` or `moderator` role from the `relay_operators` DB row.
  - Otherwise 403.

**CLI**
- `buzz-admin`, described as "Operator CLI for Buzz relay administration" (C/buzz-admin/Cargo.toml:8).

---

## 9. Add / create community

**Entry points**
- "Add a community" (Plus icon), the last item in the profile-menu community submenu (CommunitySwitcher.tsx:345-356).
- Rail "+" button, "Add community" (CommunityRail.tsx:415-430).
- Both open `AddCommunityDialog` (rendered at D/features/sidebar/ui/AppSidebar.tsx:902), which offers "Create a new community" or "Join an existing community" (AddCommunityDialog.tsx:133-193).

**Join**
- `InviteRedeemForm` takes a community URL or invite link and calls `communityOnboarding.start({source:"add-community", relayUrl, inviteCode?, policyReceipt?})` (AddCommunityDialog.tsx:53-79, 176-190).
- A transaction is saved in the localStorage key `buzz-community-onboarding-transaction.v1`, with stage `claiming` or `connecting` (D/features/onboarding/communityOnboarding.tsx:8, 149-196).

**Deep links** (T/deep_link.rs:340-365, 480-498, 620-659)
- `buzz://connect?relay=`
- `buzz://join?relay=&code=[&policy_receipt=]`
- `buzz://add-community?relay=[&name=]`

**Hosted create**
- Steps: Builderlab login, then identity binding, then a name check.
- Name rule: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 63 characters, with a 500 ms debounced availability check.
- Limit of 5 communities, under the suffix `communities.buzz.xyz` (D/features/communities/hostedCommunityApi.ts:3-5; HostedCommunityCreateFlow.tsx:188-262).
- Calls `POST …/v1/buzz/communities` (T/builderlab.rs:573-582), then onboards to `wss://<host>` (hostedCommunityApi.ts:88-91).

---

## 10. Community switching

**UI**
- The community rail, shown only when there are 2 or more communities.
  - Click to switch; drag to reorder (the order is persisted in `buzz-communities`).
  - Badges show a mention count (capped at 99+) or an unread dot (CommunityRail.tsx:67-86).
  - Context menu: "Mark all as read", "Copy community URL", "Invite to community", "Community settings" (CommunityRail.tsx:260-297, 337-359).
- The profile-menu submenu **does not list communities**. It shows actions only.

**Keyboard shortcut**
- **Not present in OLD BUZZ** (D/app/useAppShellKeyboardShortcuts.ts:67-97 handles only f/k/⇧k/⇧n/⇧o/⇧a).

**Flow** (D/app/useCommunityNavigationTransitions.ts:48-72; communityStorage.ts:34, 188-190)
1. Save the current route as a destination (`buzz-community-destinations`).
2. Go home.
3. Mark a pending restore.
4. Save the new active community (`buzz-active-community-id`).

**What resets**
- The community tree is keyed on `${id}-${reinitKey}-${pubkey}-${signerEpoch}` and gets a new QueryClient (D/app/App.tsx ~403).
- `resetCommunityState` (D/features/communities/useCommunityInit.ts:59-99):
  - disconnects the relay client;
  - resets drafts, agent observers/turns, media, reactions, search and other caches.
- Agent turns are saved and restored per community (:264-273, 359).
- `apply_workspace` resets the Rust admission gate (T/commands/workspace.rs:219-221).
