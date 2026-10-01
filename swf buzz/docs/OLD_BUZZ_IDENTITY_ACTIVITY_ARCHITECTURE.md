# Old Buzz Identity and Activity Architecture

This audit is read-only and covers `buzz/buzz`. Path prefixes:

- **D** = `buzz/buzz/desktop/src`
- **T** = `buzz/buzz/desktop/src-tauri/src`
- **C** = `buzz/buzz/crates`

All behaviour below comes from reading the source; the app was not run. Where the source does not settle a point, the text says **NOT VERIFIED IN OLD BUZZ SOURCE**.

Related reports: `OLD_BUZZ_SIDEBAR_PROFILE_AUDIT.md`, `OLD_BUZZ_SEARCH_ANYTHING_AUDIT.md`, `OLD_BUZZ_BOTTOM_LEFT_AUDIT.md` (status and presence protocol) and `OLD_BUZZ_INBOX_AUDIT.md`.

---

## 0. Feature support matrix

| Capability | Status | Evidence |
|---|---|---|
| Single current-user source (Tauri keys) | SUPPORTED | §1 |
| Centralized kind-0 profile resolution (batched, cached) | SUPPORTED, but there are several label helpers (§6) | D/features/profile/hooks.ts:328-438 |
| Offline self-profile cache | SUPPORTED | profile/hooks.ts:60-156 |
| Central presence store with realtime updates | SUPPORTED (TanStack cache plus one live subscription) | D/features/presence/hooks.ts:93-194 |
| Central user-status store | SUPPORTED (a root context plus a fallback query) | D/app/routes/root.tsx:10; D/features/user-status/ui/UserNameIndicators.tsx:26-40 |
| Unified "known agents" set | SUPPORTED (context provider) | D/features/agents/useKnownAgentPubkeys.tsx:102-129 |
| Unified "owned agents" definition | PARTIALLY SUPPORTED. There are two definitions (§5). | D/features/agents/knownAgentPubkeys.ts:27-52; D/features/profile/lib/identity.ts:134-149 |
| Per-community isolation of cached identity data | SUPPORTED (one QueryClient per community) | D/app/App.tsx:218-241, 629-632 |
| Presence dots on message author avatars | NOT VERIFIED IN OLD BUZZ SOURCE. `usePresenceQuery` has no message/timeline consumer (§3). | — |

---

## 1. Current user

| Layer | Source | Citation |
|---|---|---|
| Keys / pubkey | Tauri `get_identity` reads `state.keys` and returns `{pubkey, display_name: truncated npub/pubkey, storage, lost, locked, …}` | T/commands/identity.rs:28-48 |
| React | `useIdentityQuery()`: key **`["identity"]`**, `staleTime: Infinity` | D/shared/api/hooks.ts:5-11 |
| Self profile (kind 0) | `useProfileQuery()`: key **`["profile"]`**, queryFn `getProfile` (Tauri `get_profile` → `/query {kinds:[0], authors:[self]}`), staleTime 30 s | profile/hooks.ts:50, 90-156; T/commands/profile.rs:20-38 |
| Self profile offline cache | localStorage `buzz-self-profile.v1:<relay>:<pubkey>` with displayName, avatarUrl, about, avatarDataUrl and hasProfileEvent. It seeds `["profile"]` and is exposed reactively by `useSelfProfileCache` via `SELF_PROFILE_CACHE_EVENT`. | profile/hooks.ts:60-88, 100-141, 164-209; D/features/profile/lib/selfProfileStorage.ts:17, 71 |
| AppShell fan-out | `identityQuery.data.pubkey` / `displayName` and `profileQuery.data` are passed as props to AppSidebar, Settings, unread, notifications and more | D/app/AppShell.tsx:184, 224, 790-791, 832-834, 905 |
| Sidebar name | `profile.displayName` → `identity.displayName` → "Current identity" | D/features/sidebar/ui/AppSidebar.tsx:461-464 |

---

## 2. Other identities (kind 0)

| Hook | Query key | Fetch | Freshness | Citation |
|---|---|---|---|---|
| `useUsersBatchQuery(pubkeys)` | `["users-batch", ...sortedLower]` plus a per-pubkey `["users-batch-entry", pk]` | Tauri `get_users_batch` → `/query {kinds:[0], authors}`. **Delta fetch**: only pubkeys that are missing or stale. It writes `buzz-user-labels.v1:<relay>` for placeholder labels and seeds `["user-profile", pk]`. | Entry fresh for 10 min; retry ×3; refetch on focus only after an error | profile/hooks.ts:285-438; D/features/profile/lib/userLabelStorage.ts:8, 23-24; T/commands/profile.rs:208-230 |
| `useUserProfileQuery(pk)` | `["user-profile", pk]` | `get_user_profile` | 60 s | profile/hooks.ts:276-283 |
| `useUserSearchQuery(q)` | `["user-search", q, limit]` | `search_users` → `/query {kinds:[0], search, search_mode:"prefix"}` | 30 s | profile/hooks.ts:440-461; T/commands/profile.rs:240-335 |

**Label resolution (canonical):** `resolveUserLabel` in `D/features/profile/lib/identity.ts:91-132` falls back in this order:

1. "You" for self, unless `preferResolvedSelfLabel`
2. displayName
3. nip05Handle
4. fallbackName
5. truncated pubkey

`mergeCurrentProfileIntoLookup` overlays the live self profile onto batch lookups (identity.ts:64-89). It is used by `useMessageProfiles` (D/features/channels/ui/useMessageProfiles.ts:54), ForumView and project people.

**Agent flag and owner on profiles (Tauri):**
- `owner_pubkey` is set only when the kind-0 event has exactly one valid **NIP-OA `auth`** tag whose signature and conditions verify.
- On batch and search results, `is_agent = owner_pubkey.is_some()`.

(T/nostr_convert.rs:58-106, 323, 352-363)

**Consumers of `useUsersBatchQuery`** (partial list):

| Surface | Citation |
|---|---|
| Messages / threads | D/features/channels/ui/ChannelScreen.tsx:344 → `profiles` prop at :953 |
| Inbox | D/features/home/ui/HomeView.tsx:326-329; D/features/notifications/hooks.ts:564 |
| Sidebar DMs | D/features/sidebar/useDmSidebarMetadata.ts:51 |
| Search | D/features/search/useSearchResults.ts:453 |
| DM header | D/features/channels/useActiveChannelHeader.ts:48 |
| Other surfaces | members sidebar, profile panel and popover, huddle, workflows, projects, pulse (a grep turns up 40+ files) |

---

## 3. Presence

- **Store:** the TanStack cache, keyed **`["presence", ...sortedLowerPubkeys]`** (presence/hooks.ts:49-51).
- **Fetch:** `getPresence` → Tauri `get_presence` → HTTP `/query {kinds:[20001], authors}`. The relay synthesizes these from Redis (T/commands/profile.rs:338-392; C/buzz-relay/src/api/bridge.rs:2243-2253).
- **Poll:** 60 s while focused and connected; staleTime 5 min.
- **Realtime:** `usePresenceSubscription` is mounted once in AppShell (AppShell.tsx:226). It opens one WS subscription for the union of active presence-query pubkeys and patches every matching query. The subject is the event **author** (presence/hooks.ts:124-194; D/features/presence/lib/presence.ts:3-50).
- **Self:** `usePresenceSession(pubkey)` holds local state (preference in localStorage plus automatic idle), publishes kind 20001 and runs a 60 s heartbeat (presence/hooks.ts:350-359, 405-421). The sidebar card reads this local value, not the relay (AppShell.tsx:230, 865).

**Consumers of `usePresenceQuery` / `useAgentAvailabilityLookup`:**

| Surface | Citation |
|---|---|
| Sidebar DM rows | useDmSidebarMetadata.ts:48 |
| DM header | useActiveChannelHeader.ts:45 |
| Profile popover | D/features/profile/ui/UserProfilePopover.tsx:270 |
| Profile panel | D/features/profile/ui/UserProfilePanel.tsx:254-257 |
| Members sidebar | D/features/channels/ui/MembersSidebar.tsx:32 |
| Agents section | D/features/agents/lib/useAgentAvailability.ts |
| Bestie (protected feature) | D/protectedFeatures/bestie/useBestie.ts |

No usage was found in message rows, search, or Inbox rows.

---

## 4. Custom status (NIP-38 kind 30315)

- **Keys:** `["user-status", ...pubkeys]` (D/features/user-status/hooks.ts:123).
- **Live updates:** `useUserStatusSubscription()` is mounted in AppShell (AppShell.tsx:227) and patches queries via `applyUserStatusEventToQueries` (user-status/hooks.ts:152-195).
- **Shared lookup:** `UserStatusLookupProvider` at the route root. Components register pubkeys with it, and `UserNameIndicators` falls back to its own `useUserStatusQuery` outside the provider (root.tsx:10; UserNameIndicators.tsx:26-40).
- **Self status:** `useUserStatusQuery([self])` combined with `visibleUserStatus` in AppShell (AppShell.tsx:231-234, 909-915).

---

## 5. Agents and ownership

| Concept | Source | Citation |
|---|---|---|
| Managed agents (local device) | `useManagedAgentsQuery`: key **`["managed-agents"]`**; Tauri `list_managed_agents` reads the local store. It polls every 5 s only while an agent is running. | D/features/agents/hooks.ts:135, 389-409; T/commands/agents.rs:293 |
| Relay agents | `useRelayAgentsQuery`: key **`["relay-agents"]`**; Tauri `list_relay_agents` queries kind 30177 authored by the viewer, kind 39002 memberships signed by the relay that include the viewer, then kind 10100 and kind 0 for candidates | hooks.ts:134, 374-387; T/commands/agent_discovery/relay_directory.rs:127-200, 309 |
| Known agents (shared baseline) | `KnownAgentPubkeysProvider` / `useKnownAgentPubkeys()` = managed ∪ relay. The documented rule is that every surface deciding "is this an agent" must share it. | useKnownAgentPubkeys.tsx:102-129; knownAgentPubkeys.ts:12-24 |
| Channel-scoped known agents | the baseline plus channel members with role `bot` / `isAgent` | knownAgentPubkeys.ts:54-60; T/nostr_convert.rs:285 |
| **ownedAgentPubkeys** (Inbox) | `useOwnedAgentPubkeys` = managed agents ∪ profiles whose `ownerPubkey === currentPubkey` | D/features/home/useOwnedAgentPubkeys.ts:7-17; knownAgentPubkeys.ts:27-52; HomeView.tsx:330 |
| **ownsAuthorAgent** (messages) | NIP-OA `profile.ownerPubkey === currentPubkey` **only**. The code says explicitly "NOT by the local managed-agents list". | identity.ts:134-149 |
| Owner label | `formatOwnerLabel`: "you", otherwise the owner's name, handle or pubkey | identity.ts:170-190 |

---

## 6. Community membership

- **Store:** communities are kept in localStorage `buzz-communities` (D/features/communities/communityStorage.ts:6) and exposed through the `useCommunities()` context (D/features/communities/useCommunities.ts:168-173).
- **Per-community QueryClient:** `CommunityQueryProvider` is keyed on the community, so every TanStack key above is **per community and per identity** (App.tsx:218-241, 629-632).
- **Membership queries:**

  | Query | Key | Used by | Citation |
  |---|---|---|---|
  | `useMyRelayMembershipQuery` | `["myRelayMembership"]` | CommunityMembersCard | D/features/community-members/hooks.ts:13-42; CommunityMembersCard.tsx:173 |
  | `useMyRelayMembershipLookupQuery` | `["myRelayMembershipLookup"]` | sidebar profile card (invite gate), settings card | SidebarProfileCard.tsx:63-65; CommunityMembersSettingsCard.tsx:253 |
  | `relayMembersQueryKey` | `["relayMembers"]` | member lists | hooks.ts:13 |

- **Channels:** key `["channels"]` (D/features/channels/hooks.ts:58, 433-441).

---

## 7. Identity per surface

| Surface | Name / avatar | Presence | Status | Agent flag |
|---|---|---|---|---|
| Sidebar profile card | `["profile"]` plus the self cache | local `usePresenceSession` | `["user-status", self]` | — |
| Sidebar DM rows | `useUsersBatchQuery` via `resolveUserLabel` / `resolveChannelDisplayLabel` | `["presence", …]`, missing = offline | UserNameIndicators | batch `isAgent` → squircle |
| DM header | `useActiveChannelHeader` (its own batch and presence queries) | own query | — | — |
| Messages / threads | ChannelScreen batch plus `mergeCurrentProfileIntoLookup` | not used | UserNameIndicators (chat) | `isAgent`, `ownsAuthorAgent` |
| Inbox | HomeView batch and notifications batch | not used | NOT VERIFIED IN OLD BUZZ SOURCE | `useOwnedAgentPubkeys` |
| Search | own label helpers plus a batch for hit authors | not used | not used | merges managed and relay agents locally |
| Profile popover / panel | `["user-profile", pk]` plus batch seed | `useAgentAvailability` (undefined unless loaded and connected) | yes | `ownerPubkey` |

---

## 8. Centralization vs duplication

**Centralized:**
- `["identity"]` for the current user.
- `useUsersBatchQuery` with its per-pubkey entry cache, which de-duplicates fetches across all surfaces.
- A single presence WS subscription.
- The user-status root context.
- The `useKnownAgentPubkeys` provider.
- A per-community QueryClient.

**Duplicate or divergent sources and transforms found:**

1. **User label helpers.** These use different fallbacks:
   - `resolveUserLabel` (identity.ts:91-132): "You", then name, then nip05, then fallback, then **truncated** pubkey.
   - `TopbarSearch.getUserDisplayName` (D/features/search/ui/TopbarSearch.tsx:133-139): name, then nip05, then truncated.
   - `useSearchResults.formatUserResultName` (useSearchResults.ts:35-37): name, then nip05, then the **full** pubkey.
   - `AppSidebar.resolvedDisplayName` (AppSidebar.tsx:461-464): falls back to "Current identity".
2. **DM conversation labels:**
   - `resolveChannelDisplayLabel` (D/features/sidebar/lib/channelLabels.ts:19-49)
   - `buildDirectMessageIntro` in `getChannelScopeLabel` (D/features/search/ui/SearchScopeControls.tsx:8-26)
   - its own derivation in `useActiveChannelHeader` (:45-50)
3. **Self-exclusion for DM participants:**
   - The same logic is written three times inside `useDmSidebarMetadata` (:32-47, 59-70, 107-117), matching on pubkey **and** your own display name.
   - `channelLabels.ts:32-37` excludes by pubkey only.
4. **Presence interpretation:**
   - Sidebar DM rows treat a missing entry as `"offline"` even before load or while disconnected (useDmSidebarMetadata.ts:72-78).
   - `resolveAgentAvailability` returns `undefined` unless the query is loaded **and** connected (D/features/agents/lib/useAgentAvailability.ts:10-18).
5. **Agent ownership:** there are two definitions.
   - `mergeOwnedAgentPubkeys` = managed ∪ NIP-OA owner (knownAgentPubkeys.ts:27-52)
   - `ownsAuthorAgent` = NIP-OA only (identity.ts:134-149)
6. **"Is agent" signals:**
   - kind-0 NIP-OA owner (T/nostr_convert.rs:362)
   - channel member role `bot` (:285)
   - the managed ∪ relay baseline (useKnownAgentPubkeys.tsx)
   - search's local merge (useSearchResults.ts:345-348), which re-derives eligibility instead of reading the context
7. **Membership:** two queries, `["myRelayMembership"]` and `["myRelayMembershipLookup"]`, for the current user's role (community-members/hooks.ts:14-42).
8. **Self-profile representations:**
   - `["profile"]`
   - the localStorage self cache (with avatarDataUrl)
   - `["user-profile", self]` seeded from batch data
   - self entries in `["users-batch", …]`, patched through `mergeCurrentProfileIntoLookup`

   The sidebar uses `profile.avatarUrl` together with `selfProfileCache.avatarDataUrl` (SidebarProfileCard.tsx:138-145).
9. **Channel display name inside search:**
   - `getChannelDisplayName` (TopbarSearch.tsx:114-119)
   - `getChannelScopeLabel` (SearchScopeControls.tsx:8-26)
   - inline `channelLabels?.[id] || name` (useSearchResults.ts:69, 279)
