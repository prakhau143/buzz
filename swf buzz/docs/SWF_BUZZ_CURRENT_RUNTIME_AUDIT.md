# SWF BUZZ — Current Runtime Path Audit (Phase 2)

| | |
|---|---|
| **Type** | Read-only source audit — no source, config, dependency, database or Okta change |
| **Date** | 2026-09-21 |
| **Subject** | `buzz/swf buzz` (frontend `src/`, Tauri `src-tauri/`, backend `backend/`) |
| **Question** | What is *actually executed at runtime* — Okta, Nostr, signer, relay, or the new HTTP/Application-User path? |
| **Companion** | `docs/OLD_BUZZ_AUTH_AND_COMMUNITY_FLOW_AUDIT.md` (OLD BUZZ reference) |

**Labels:** `CONFIRMED` = read in source (file:line given). `INFERRED` = follows from confirmed code, last hop not read. `UNCLEAR` = not confirmed. All paths are relative to `buzz/swf buzz/`.

---

## 0. Headline (read this first)

1. **Login is still a Nostr login with an Okta front door.** After Okta succeeds, the app derives a Nostr keypair from the Okta `sub`, connects to the **Buzz relay**, and resolves the user's role from the relay's `relay_members` list. Only then does `session.authStatus` become `ready`. If the relay is down, login fails.
2. **The new Application-User session is an optional extra, not the gate.** It is created only if the Rust process has `SWF_BUZZ_BACKEND_URL` set (a variable **not documented in `.env.example`**). Its failure never blocks login. It exists only in the **Tauri** build; the plain-browser Okta flow never creates one.
3. **The app is really two UIs in one shell.** Legacy Nostr screens (`/channels`, `/dm`, and the sidebar lists) and new HTTP screens (`/community`, `/community-dm`, the invite flow, the Community modal). They are wired side by side; the sidebar's channel and DM lists are still Nostr.
4. **The HTTP migration covers:** community create/members/roles, invites, channels, channel members, channel messages, threads, DMs, realtime message push. **Not migrated (no backend code exists):** reactions, presence, typing, profiles, moderation, platform admin, agents.
5. **Okta cannot be safely disabled today.** Nothing else establishes `ready`, creates the Application User, or obtains the bearer token.
6. **Security finding:** the derived Nostr private key is `SHA-256("swf-buzz-local-dev-identity:" + okta_sub)`, computed in the webview. Anyone who learns a user's Okta `sub` can recompute their Nostr key. The code comments say this is "dev-only… never reachable in a production build", but **no `import.meta.env.DEV` guard protects it** (grep of `src/` finds the guard only on the login button and config defaults).
7. **GitHub / project features: none.** Zero code references in frontend, Tauri, backend or migrations.

---

## 1. Authentication Trace (LoginView → backend)

### 1.1 What happens on "Sign in with Okta" (Tauri build)

```
LoginView.vue  (button visible only if VITE_OKTA_ISSUER + VITE_OKTA_CLIENT_ID set)      views/LoginView.vue:8-16,45
 └► useAuth().loginWithOkta()                                                             features/auth/useAuth.ts:235
     ├─ not Tauri → oktaAuthServiceBrowser.beginLogin()  (redirect to Okta; see 1.3)      :239-250
     └─ Tauri     → oktaAuthService.login()                                               :252
          └► invoke("start_okta_login")                    features/auth/authService.okta.ts:~62
               └► Rust oidc::login()   PKCE, system browser, deep link, token exchange    src-tauri/src/auth/oidc.rs:350-477
                    ├─ verify_id_token (JWKS: sig, iss, aud, exp, nonce)                  oidc.rs:440
                    ├─ IF env SWF_BUZZ_BACKEND_URL set:
                    │     POST {backend}/api/session/bootstrap {id_token}                 oidc.rs:443-465
                    │     → session token stored in OS keychain ("swf_session_token")     oidc.rs:447-452
                    │     (failure = logged, NON-FATAL)
                    └─ returns {subject, employeeEmail, backend_session_token?}           oidc.rs:471-476
          └► restore() a previously paired NIP-46 bunker (if any)                         authService.okta.ts:~66
     ├─ result.pubkey present (bunker restored) → use Nip46SigningService                  useAuth.ts:253-256
     └─ else, subject present → resolveLocalIdentitySigningService(sub)                   useAuth.ts:257-259
           = DevSigningService.forLocalIdentity(sub)   SHA-256 → secp256k1 secret key      signing/signingService.dev.ts (forLocalIdentity)
 └► resolveIdentityAndRole(result)                                                        useAuth.ts:194
     ├─ applyIdentityAndResolveRole:                                                       :88-118
     │    session.setIdentity({... pubkey})                                                :92
     │    relayConnectionService.connect(config.relayUrl)   ← signs NIP-42 AUTH            :99   (fails ⇒ authError, return false)
     │    relayMembersService.fetchMembershipList() → resolveMyRole(members, pubkey)       :110-111
     │    session.setCommunityRole(role)  ⇒ authStatus = "ready"                           :116; stores/session.ts (setCommunityRole)
     ├─ bootstrapApplicationUserFromStoredToken()  (best-effort, additive)                 :201  → GET /api/session with keychain token
     └─ router.push("home")                                                                :205
```

### 1.2 Direct answers

| Question | Answer | Evidence | Conf. |
|---|---|---|---|
| Does Okta open? | Yes: system browser via Rust PKCE (Tauri); browser redirect (web) | `oidc.rs:350+`; `oktaBrowserFlow.ts` | CONFIRMED |
| Where is the ID token handled? | **Only in Rust.** Verified via JWKS, forwarded once to the backend `/api/session/bootstrap`, held Rust-side for logout `id_token_hint`, never returned to JS | `oidc.rs:440-469` | CONFIRMED |
| Where is the app session created? | Backend `POST /api/session/bootstrap` (verifies the ID token itself via `jwks.rs`, upserts user, mints session) — **only if `SWF_BUZZ_BACKEND_URL` is set** | `oidc.rs:128-133,443`; `backend/src/routes/session.rs` | CONFIRMED |
| Where is the Application User created/loaded? | Backend `users` upsert by `okta_sub` at bootstrap; frontend loads it via `GET /api/session` into `session.applicationUser` | `session.rs:45+`; `useAuth.ts:67-78` | CONFIRMED |
| Where is the session stored? | OS keychain via `secure_storage_*` (key `swf_session_token`); nothing in localStorage. **Non-Tauri build: never stored** | `oidc.rs:447`; `ApiClient.ts` (`getStoredSessionToken`: `if (!isTauri()) return null`) | CONFIRMED |
| Does the frontend still create/use a pubkey? | **Yes, always.** `session.pubkey` is set on every login path | `useAuth.ts:92-97`; `stores/session.ts` | CONFIRMED |
| Nostr signer initialised? | **Yes.** `DevSigningService.forLocalIdentity(sub)` on the default Okta path; `setActiveSigningService()` | `useAuth.ts:221-225,257-259` | CONFIRMED |
| signingService.dev used? | **Yes, in production Okta login** (derived-key mode), and Development Mode (shared fixed key `…01`) | `useAuth.ts:258`; `signingService.dev.ts` | CONFIRMED |
| NIP-46 used? | Only if `Nip46SigningService.restore()` finds a previously stored bunker pointer. **No reachable UI can create one** (see 1.4) | `authService.okta.ts:~66`; `useAuth.ts:253` | CONFIRMED (path exists) / practically dead |
| RelayConnectionService initialised during login? | **Yes**, and its success is a hard gate for `ready` | `useAuth.ts:99-105` | CONFIRMED |

### 1.3 Browser (non-Tauri) Okta flow

`oktaAuthServiceBrowser` / `oktaBrowserFlow.ts` / `OktaCallbackView.vue` contain **no call to the backend** (grep for `bootstrap|backendUrl|session_token|apiRequest|/api/session` finds nothing). `ApiClient` returns `null` for the token outside Tauri. Consequence: in a plain browser, `session.applicationUser` is never set and **every HTTP screen fails with `auth_required`**. `ApiClient.ts`'s own comment calls the browser flow "still Nostr-based". CONFIRMED.

### 1.4 Dead login UI: bunker pairing

`LoginView.vue` renders a "Connect your Nostr signer / Bunker URI" step when `pendingBunkerPairing` is non-null. Every assignment to `pendingBunkerPairing.value` in the codebase is `= null` (`useAuth.ts:322,369,379`). **The step is unreachable.** `completeBunkerPairing` is exported but nothing can trigger it. CONFIRMED.

### 1.5 Development Mode

`loginWithDevelopmentMode` → `DevAuthService` + shared fixed dev key (`…0001`) → same `resolveIdentityAndRole`. Never creates an Application User (no Okta token). Button shown only when `import.meta.env.DEV` (`LoginView.vue:15`). CONFIRMED.

---

## 2. Session Trace

```
Tauri: oidc::login → POST /api/session/bootstrap → {session_token, expires_at}
  → secure_store::set("swf_session_token")   (OS keychain)              oidc.rs:447
Frontend: apiRequest(path)                                              services/ApiClient.ts
  → token = options.token ?? invoke("secure_storage_get","swf_session_token")
  → fetch(`${config.backendUrl}${path}`, { Authorization: "Bearer <token>" })
Backend: AuthUser extractor: strip "Bearer ", sha256(token), look up sessions.token_hash   backend/src/auth.rs:9-45
  → User (users.id, okta_sub)  → handler uses caller.id
WebSocket /ws: token in ?token= query param (browsers can't set WS headers)   RealtimeService.ts:124; routes/realtime.rs:3-9
401 → ApiClient clears the stored token                                       ApiClient.ts
```

**Re-verified from current code: `Authorization: Bearer <token>`. There is no cookie anywhere** (no `Set-Cookie`, no `credentials`/`withCredentials`, no `swf_session` cookie read). The D10 text "swf_session (httpOnly cookie)" is documentation drift. CONFIRMED.

Additional session facts (all CONFIRMED):
- Server stores only `sha256(token)` (`sessions.token_hash`, migration 0001); raw token never stored.
- **The `/ws` token appears in the URL** (query string), so it can end up in proxy/access logs. The backend's own comment acknowledges the tradeoff.
- **Silent resume can destroy a valid session:** `attemptSilentResume` restores the backend session, then runs the relay-connect step; on *any* failure its `catch` calls `clearStoredSessionToken()` (`useAuth.ts:157-160`). If the Buzz relay is unreachable at app start, a perfectly valid backend session token is deleted.
- **Two different env var names for the backend URL:** frontend `VITE_SWF_BACKEND_URL` (in `.env.example`/`.env.local`) vs. Rust `SWF_BUZZ_BACKEND_URL` (**absent from `.env.example`**, `.env.local`). Without the Rust one, no session is ever minted at login, and the HTTP UI stays unauthenticated. CONFIRMED (`grep` across `src`, `src-tauri/src`, `.env*`).
- Backend `SWF_BACKEND_INVITE_BASE_URL` defaults to `http://localhost:5173`, but the Vite dev server uses **port 1420** with `strictPort` (`vite.config.ts:33-34`), so default invite URLs point at a port nothing serves. CONFIRMED.

---

## 3. Community Trace

| Screen / service | Transport | Files | Conf. |
|---|---|---|---|
| Community **create** | HTTP `POST /api/communities` (any authenticated user; creator becomes `owner`) | `communities/CommunityService.ts:44`; `backend repo/postgres.rs:~120-140` | CONFIRMED |
| Community **list** | **No endpoint.** Current community is `localStorage["swf_current_community_id"]` or `VITE_SWF_COMMUNITY_ID` | `communities/currentCommunity.ts`; `routes/mod.rs` (no list route) | CONFIRMED |
| Community **details** | None (no `GET /api/communities/{id}` route) | `routes/mod.rs` | CONFIRMED |
| Community **members / roles** | HTTP: list/add/change-role/remove | `CommunityService.ts:47-69`; `ui/CommunityMembersPanelHttp.vue` | CONFIRMED |
| Community **role for gating the app** | **Legacy Nostr**: `relayMembersService.fetchMembershipList()` → `resolveMyRole(members, pubkey)` from the relay's `relay_members` | `useAuth.ts:110-111` | CONFIRMED |
| Community role for HTTP UI panels | HTTP: `communities/useCommunity.ts`, `permissions.ts` (userId-keyed) | `communities/permissions.ts:23` | CONFIRMED |
| **Channels** (list/create/join) | HTTP in `/community`; **Nostr in sidebar and `/channels`** | `useChannelsHttp.ts` / `ChannelServiceHttp.ts` vs `useChannels.ts` / `ChannelService.ts` | CONFIRMED |
| Channel **members** | HTTP `GET/POST/PATCH/DELETE /api/channels/{id}/members` returns only `{user_id, role, joined_at}` | `channels.rs:124-135` | CONFIRMED |
| Channel **messages** | HTTP + realtime push in `/community`; Nostr in `/channels` | `MessageServiceHttp.ts`; `MessageService.ts` | CONFIRMED |
| Realtime | `RealtimeService` → backend `/ws` (`message.created`, `dm_message.created` only). Legacy relay socket (`RelayConnectionService`) is separate | `services/RealtimeService.ts`; `services/RelayConnectionService.ts` | CONFIRMED |

**Routing shape** (`app/router/index.ts`): `/` Home (HTTP), `/channels` (legacy Nostr), `/dm` (legacy Nostr), `/community` (HTTP), `/community-dm` (HTTP), `/invite/:token` (public), `/platform-admin`. The guard requires `session.isReady`, which is set **only** by the legacy `setCommunityRole` (`stores/session.ts`).

**Sidebar (`layouts/AppSidebar.vue:21-35`)** uses `useChannels()` and `useDmList()` (Nostr) for its lists, but its "Community" button opens the HTTP `CommunityManagementModal` (members + invites), and it links to `/community` and `/community-dm`. CONFIRMED.

---

## 4. Invite Trace

```
Owner/admin: sidebar "Community" → CommunityManagementModal → CreateInvitePanel            features/community-members/ui/CommunityManagementModal.vue:13,44
  → useCreateInvite → inviteHttpService.createInvite(communityId)                          communities/useInvites.ts, InviteService.ts
  → POST /api/communities/{id}/invites  (Bearer)                                           InviteService.ts:createInvite
Backend create_invite                                                                      backend/src/routes/invites.rs
  → AuthUser(caller) → require role → can_manage_invites (owner|admin) else 403
  → ttl 1h..30d (default 72h), max_uses ≥ 1
  → raw = 32 random bytes b64url; store sha256(raw); created_by_user_id = caller.id
  → { id, code, url: "{SWF_BACKEND_INVITE_BASE_URL}/invite/{code}", expires_at, max_uses }
Invitee opens {base}/invite/<token>  →  route /invite/:token (public)                       router/index.ts
InviteLandingView                                                                         views/InviteLandingView.vue
  → onMounted: setPendingInviteToken(token)   (sessionStorage)                            :~44
  → GET /api/invites/{token}/preview  (PUBLIC; returns only community_name; 404/410/409)  routes/invites.rs:185-206
  → if !session.applicationUser: "Continue with Okta" → loginWithOkta()                   :handleContinueWithOkta
        (login lands on `home`; guard reads pending token → redirects back to /invite)    router/index.ts (to.name==="home")
  → else "Join Community" → POST /api/invites/claim {code} (Bearer)                       InviteService.ts:claimInvite
Backend claim_invite  → AuthUser(caller.id) (never a client-supplied user id)              routes/invites.rs
  → row lock; expired/revoked/exhausted → 410/410/409; already member → {status:"already_member"} (no use consumed)
  → else INSERT community_members (community_id, caller.id, 'member') ; used_count += 1   repo/postgres.rs ~776-840
  → {status:"joined", community:{id,name}, membership:{user_id, role}}
Frontend: clearPendingInviteToken(); setCurrentCommunityId(id)                            InviteLandingView.vue:handleJoin
  → "Open Community" → router.push({ name: "channels" })     ← LEGACY NOSTR VIEW           InviteLandingView.vue:61
```

### Verified points
| Item | Result | Conf. |
|---|---|---|
| Create endpoint | `POST /api/communities/{id}/invites` (not `/api/invites`) | CONFIRMED |
| Claim endpoint | `POST /api/invites/claim` | CONFIRMED |
| Session required | Yes for create/claim/revoke; **preview is public** | CONFIRMED |
| Application User | derived from bearer session server-side; no client-supplied user id | CONFIRMED |
| community_id | in the create URL; claim resolves it from the token hash | CONFIRMED |
| Role assigned | `'member'` literal in the claim SQL | CONFIRMED |
| `already_member` | returned before the use counter increments | CONFIRMED |
| Any Nostr dependency in the invite service layer? | **No.** `InviteService.ts` uses only `apiRequest`. Legacy `features/invites/*`, `components/InvitesPanel.vue`, `protocol/invites.ts` have **no importers** (dead) | CONFIRMED |
| Any Nostr dependency at runtime around the invite flow? | **Yes, indirectly.** (a) `loginWithOkta()` runs the full Nostr/relay login, so an invite cannot be claimed while the Buzz relay is unreachable *only if the user isn't already signed in*; (b) after claiming, "Open Community" goes to the legacy `channels` view; (c) the landing page is only usable where a backend session exists (Tauri + `SWF_BUZZ_BACKEND_URL`) | CONFIRMED |
| Can an invite URL open the desktop app? | **No mechanism found.** The only registered deep-link scheme is the Okta callback `com.okta.trial-7050986` (`tauri.conf.json`); no `/invite` handler. A link opened in a normal browser runs the browser build, where no backend session can exist (§1.3). | CONFIRMED (no handler found) |
| Stale doc in code | `InviteLandingView.vue`/`pendingInvite.ts` comments say login "lands on `channels`"; code lands on `home` | CONFIRMED |

**Net:** the invite *services and backend* are fully Application-User based; the *end-to-end user journey* is not usable as designed because (i) there is no way to deliver the invite URL into the Tauri window, (ii) the browser build has no session, and (iii) post-claim navigation leaves the HTTP world.

---

## 5. Message Trace (send one text message)

**HTTP path** (`/community`, `views/CommunityChannelsView.vue`):
```
type → CommunityChannelsView → useChannelMessagesHttp().send({content, parentMessageId?})   messages/useChannelMessagesHttp.ts
  → messageServiceHttp.send → POST /api/channels/{id}/messages {content, parent_message_id}   MessageServiceHttp.ts
  → backend send_message: AuthUser(caller) → require_channel_membership (community member AND channel member)
        → trim/empty/length checks → create_message(channel_id, caller.id, content, parent)   routes/messages.rs:104-133
        → realtime.publish(NewMessage)   (in-process tokio broadcast)
  → other clients: backend /ws → filter by connect-time channel membership snapshot → "message.created"
        → RealtimeService.onEvent → cache update                                              routes/realtime.rs; useChannelMessagesHttp.ts
```
No Nostr event, no signer, no pubkey. Sender = `caller.id` from the session. Stored in `messages` with `sender_user_id`. CONFIRMED.

**Nostr path** (`/channels`): `useSendMessage` → `MessageService` → `publish.ts` → `getActiveSigningService().signEvent(kind:9)` → `RelayConnectionService` → Buzz relay. Requires signer + pubkey. CONFIRMED.

**Caveats (HTTP path), all CONFIRMED:**
- Non-self senders render as the **raw `senderUserId` UUID** (`CommunityChannelsView.vue:204`): no human names because no user-directory endpoint exists.
- **Realtime membership is snapshotted at connect** (`routes/realtime.rs`): joining a channel after connecting yields no live events until reconnect.
- **Open channels require explicit self-join** for read/write (`require_channel_membership`, `messages.rs:73-87`); `list_visible_channels` shows open channels to everyone but access needs a `channel_members` row. Self-join is allowed for open channels (`channel_authz.rs:23-29`). No default channel is created on community creation or join.

## 6. Thread Trace

| Action | Implementation | Conf. |
|---|---|---|
| Create thread / reply | `POST /api/channels/{id}/messages` with `parent_message_id`; `root_message_id`, `depth` computed **server-side** | CONFIRMED (`messages.rs:90-95`; migration 0006) |
| Read thread | `GET /api/messages/{root_id}/thread` | CONFIRMED (`routes/mod.rs:72`) |
| Thread count | `reply_count`, `descendant_count`, `last_reply_at` columns; `GET /api/messages/thread-summaries` | CONFIRMED (migration 0006) |
| Model | **Application message IDs** (parent/root/depth), not Nostr NIP-10 `e` tags | CONFIRMED |
| Legacy | `threads/ThreadService.ts` uses `protocol/threads`, `protocol/nip10` on the relay; used by `/channels` and `/dm` | CONFIRMED |

## 7. Reaction Trace

**Nostr only.** `reactions/ReactionService.ts` imports `RelayConnectionService`, `protocol/reactions` (kind 7), `publish` (signer) and `stores/session` (pubkey). **The backend contains no reaction code, table or route** (grep of `backend/src` and `backend/migrations` finds none). `CommunityChannelsView.vue:7-12` itself lists reactions as not migrated. Requires: signer, pubkey; no Application User involvement. CONFIRMED.

## 8. DM Trace

| Path | Files | Mechanism |
|---|---|---|
| **HTTP** (`/community-dm`) | `dm/DmServiceHttp.ts`, `dm/useDmHttp.ts`, `views/CommunityDmView.vue`; backend `routes/dm.rs`, migration 0007 | `POST /api/dm/open {user_ids}` (idempotent by participant set; caller must be a participant; each id must exist), `POST /api/dm/{id}/messages`; realtime `dm_message.created`. Identity = `users.id`. **Starting a DM requires typing a raw user UUID** (`CommunityDmView.vue:11-18,37,43-46`) |
| **Nostr** (`/dm`, sidebar) | `dm/DmService.ts`, `Kind41010Transport.ts`, `DmTransport.ts`, `useDmList/useDmMessages/useSendDm/useHideDm/useOpenDm` | kind:41010 open + kind:9 messages on the relay; pubkey participants; signer required |
| **Profile → Message** | `UserProfilePanel.vue:31` → `router.push({name:"dm", …})` = **Nostr** DM | CONFIRMED |

**Mixed.** Both exist; the profile→DM entry uses Nostr. There is **no user directory or userId-keyed profile panel** for the HTTP DM (the view's own comment says so). CONFIRMED.

## 9. Profile Trace

| Aspect | Current state | Conf. |
|---|---|---|
| Legacy profile | keyed by **pubkey** (`services/ProfileService.ts` → kind:0 + agent kind:30177); `composables/useProfile.ts`; `MessageItem.vue:23-25`; `UserProfilePanel.vue` | CONFIRMED |
| HTTP profile | **None.** No `/api/users` or profile route. `users` has `okta_sub`, `email`, `display_name` but nothing exposes another user's profile | CONFIRMED |
| Self identity in HTTP UI | `session.applicationUser` → `displayName ?? email` | CONFIRMED (`CommunityDmView.vue:81`) |
| Human profile key today | pubkey (legacy) / `user_id` (HTTP), with **no bridge between the two** | CONFIRMED |
| Remaining pubkey assumptions | `MessageItem` `isOwnMessage`, member rows, mention candidates, typing/presence, moderation, `AppSidebar` role display | CONFIRMED (90 of 157 non-test source files reference Nostr terms; §10) |

---

## 10. Frontend Nostr Dependency Inventory

Search terms: `pubkey|npub|nsec|nostr-tools|RelayConnectionService|signingService|SigningService|nip46|bunker|NIP-42|NIP-98|signEvent|signer|relayQuery|publish(`.
**Result: 90 of 157 non-test `.ts/.vue` files under `src/` match.** `nostr-tools` is imported directly in only 4 files (`signingService.dev.ts`, `signingService.nip46.ts`, `protocol/types.ts`, `services/RelayConnectionService.ts`).

| Class | Meaning | Files / groups |
|---|---|---|
| **A. Human authentication** | Login needs it | `features/signing/*` (dev, nip46, registry, types); `features/auth/useAuth.ts` (derived key, relay connect); `authService.okta*.ts` (bunker restore); `stores/session.ts` (`pubkey`); `LoginView.vue` (bunker UI) |
| **B. Human authorization** | Roles/membership from Nostr | `community-members/RelayMembersService.ts`, `permissions.ts`, `protocol/relayMembers.ts`, `protocol/membership.ts`; `channels/ChannelService.ts`, `useChannelMembers.ts`, `useChannelMemberActions.ts`, `useJoinChannel.ts`, `useCreateChannel.ts`; `features/moderation/*`, `protocol/moderation.ts` (NIP-98 via `services/nip98.ts`) |
| **C. Messaging** | Text/threads/reactions/presence/typing | `messages/MessageService.ts`, `useSendMessage.ts`, `useChannelMessages.ts`; `threads/ThreadService.ts`, `useThread*.ts`; `reactions/*`; `presence/*`; `protocol/{messages,threads,nip10,reactions,presence,typing,kinds}.ts` |
| **D. DM** | kind:41010 DMs | `dm/{DmService,Kind41010Transport,DmTransport,useDmList,useDmMessages,useSendDm,useHideDm,useOpenDm}.ts`, `protocol/dm.ts`, `DmView.vue`, `layouts/DmParticipantLabel.vue` |
| **E. Agent-only** | Agents on Nostr | `features/agents/*`, `protocol/agents.ts`, `stores/agentActivity.ts`, `components/AgentActivityBar.vue`. Observer-frame decryption uses **the human's signer** (`AgentActivityService.ts` `nip44Decrypt`) |
| **F. Legacy / dead** | Unreachable or unused | LoginView bunker step (`pendingBunkerPairing` never non-null); `completeBunkerPairing`; `features/invites/*`, `components/InvitesPanel.vue`, `protocol/invites.ts` (no importers); `signingService.nip46` (only via a pre-existing stored bunker pointer) |
| **G. Required infrastructure** | Needed while the legacy path lives | `services/RelayConnectionService.ts`, `services/publish.ts`, `services/relayQuery.ts`, `protocol/types.ts`, `nostr-tools` dependency |
| **H. Unknown** | Not traced to runtime | `features/platform-admin/*` (`AdminConsoleService`, optional admin host); `ChannelsView.vue` sub-panels |

**Where the Nostr path is *required* for humans today (blocking):** the login gate (`useAuth.ts:99-118`), the router guard (`isReady`), the sidebar lists, `/channels`, `/dm`, reactions, presence, typing, profiles, moderation, agent activity.

---

## 11. Okta Dependency Inventory

```
Frontend                                        Tauri (Rust)                         Backend                          Database
─────────────────────────────────────────       ─────────────────────────────────   ───────────────────────────      ─────────────────
views/LoginView.vue (button, oktaConfigured)    auth/oidc.rs  (PKCE, verify ID tok)  config.rs (issuer, client id)    users.okta_sub UNIQUE
views/OktaCallbackView.vue (browser only)       commands/auth.rs (start/logout)      jwks.rs   (ID-token verify)      sessions.token_hash
features/auth/authService.okta.ts               commands/secure_storage.rs           routes/session.rs (bootstrap)
features/auth/authService.okta.browser.ts       storage/secure_store.rs (keychain)   models.rs, repo/* (okta_sub)
features/auth/oktaBrowserFlow.ts                tauri.conf.json (deep-link scheme    auth.rs / token.rs (session)
features/auth/useAuth.ts, types.ts               com.okta.trial-7050986)
stores/session.ts (employeeEmail, oktaSub)      lib.rs (deep-link plugin)
services/ApiClient.ts, services/errors.ts
views/InviteLandingView.vue ("Continue with Okta")
app/config.ts (VITE_OKTA_*)
Env: VITE_OKTA_ISSUER/CLIENT_ID (frontend) · SWF_BUZZ_OKTA_ISSUER/CLIENT_ID (Rust + backend, shell env) · SWF_BUZZ_BACKEND_URL (Rust, undocumented)
```
CONFIRMED (file list from `grep -il okta` plus reading each hop).

## 12. Agent Boundary

| Belongs to | Items | Conf. |
|---|---|---|
| **Agents (keep untouched)** | `features/agents/*`, `protocol/agents.ts`, `stores/agentActivity.ts`, `AgentActivityBar.vue`, agent detection (kind:30177) in `ProfileService.ts`, `useMentionCandidates.ts`; rendered only in **legacy** `ChannelsView`/`DmView` | CONFIRMED |
| **Coupling to flag** | Agent observer frames are NIP-44 encrypted **to the human's Nostr pubkey**; decrypting them uses the *human's* signer (`AgentActivityService.ts`). Removing the human key breaks this unless agent frames are redelivered another way | CONFIRMED |
| **New HTTP UI** | `CommunityChannelsView.vue` shows **no agent activity**, mentions, or agent badges (only a comment) | CONFIRMED |
| Backend | No agent code | CONFIRMED |

## 13. GitHub Boundary

| Layer | Result |
|---|---|
| Frontend `src/` | **None.** `grep -i github` empty; the words "project/repository" appear only in comments |
| Tauri `src-tauri/src` | **None.** Registered commands are exactly: `start_okta_login`, `okta_logout`, `secure_storage_get/set/delete` (`lib.rs:81-87`) |
| Backend routes / models / migrations | **None.** (`repo/` is the repository-pattern data layer, not Git) |
| Services | **None** |
CONFIRMED. There is nothing to exclude in SWF; the exclusion applies to OLD BUZZ code that must not be brought over.

---

## 14. Final Architecture Map

### 14.1 CURRENT SWF BUZZ

```
                       Human
                         │  "Sign in with Okta"
                         ▼
        Okta OIDC + PKCE  (Rust, system browser)                      ← Okta
                         │  id_token stays in Rust
        ┌────────────────┴───────────────────────────────┐
        │ (only if SWF_BUZZ_BACKEND_URL set)             │ always
        ▼                                                ▼
 POST /api/session/bootstrap                  derive Nostr key = SHA-256(okta_sub)     ← Nostr identity
        │                                                │
        ▼                                                ▼
 Application User + Bearer session            RelayConnectionService.connect() → NIP-42 AUTH → Buzz relay
 (OS keychain; optional, additive)            relay_members list → role  ⇒ authStatus = "ready"   ← THE GATE
        │                                                │
        │                                                ▼
        │                                     Router guard (needs "ready")
        │                                                │
        ├───────────────────────┬────────────────────────┤
        ▼                       ▼                        ▼
   HTTP screens             Sidebar lists            Legacy Nostr screens
   /community               (Nostr: useChannels,     /channels  /dm
   /community-dm             useDmList)              reactions · presence · typing
   Community modal                                   profiles · moderation · agents
   Invite flow                    │
        │                         │
        ▼                         ▼
 Community (users.id)      Channel (relay channels)
   → Channel (channel_members) → Message (kind:9 event, pubkey sender)
     → Message (sender_user_id)
```

### 14.2 TARGET SWF BUZZ

```
Human
  ↓
Application Authentication      Okta (PKCE, Rust) → backend verifies ID token → Bearer session
  ↓
Application User                users(id, okta_sub)  — the ONLY human identity; no pubkey
  ↓
Community Membership            community_members(community_id, user_id)
  ↓
Community Role                  owner | admin | member
  ↓
Channel Membership              channel_members(channel_id, user_id)  (+ open-channel self-join)
  ↓
Messages / Threads / Reactions / DMs   all over HTTP + backend /ws; sender = session user
                                       (agents remain Nostr participants on the relay, separately)
```

---

## 15. HTTP Migration Status

| Capability | HTTP backend exists | Frontend on HTTP | Status |
|---|---|---|---|
| Session / Application User | Yes | Partial (optional, Tauri-only) | **Partial** |
| Community create / members / roles | Yes | Yes (modal, panel) | **Done** |
| Community list / details / directory | **No route** | n/a | **Missing** |
| Invites (create/preview/claim/revoke) | Yes | Yes (services); journey broken at edges | **Done (service), gaps (journey)** |
| Channels + channel members | Yes | `/community` only; sidebar still Nostr | **Partial** |
| Channel messages | Yes | `/community` only | **Partial** |
| Threads | Yes | `/community` only | **Partial** |
| DMs | Yes | `/community-dm` only; profile→DM still Nostr | **Partial** |
| Realtime | Yes (messages + DMs only) | Yes | **Partial** |
| Reactions | **No** | No | **Not started** |
| Presence / typing | **No** | No | **Not started** |
| Profiles / user directory | **No** | No | **Not started** |
| Moderation | **No** | No | **Not started** |
| Platform admin | No | No | **Out of scope / unknown** |
| Auth gate (`ready`) | n/a | **No, legacy relay role** | **Not migrated** |

## 16. Legacy / Dead Paths

1. LoginView bunker step + `completeBunkerPairing` + `pendingBunkerPairing` (unreachable).
2. `features/invites/*`, `components/InvitesPanel.vue`, `protocol/invites.ts` (no importers).
3. `signingService.nip46.ts` (reachable only via a stored bunker pointer nothing can create).
4. Stale comments: `InviteLandingView.vue`, `pendingInvite.ts` ("lands on channels"); D10 "httpOnly cookie".
5. Development Mode login (`DevAuthService`, fixed shared key) — intentional dev tool, dev-only button.
CONFIRMED.

## 17. Unknown / Unverified Paths

1. Runtime behaviour of `ChannelsView.vue` sub-panels and moderation UI (`features/moderation/*`) — read at import level only.
2. `features/platform-admin/*` and its optional admin host.
3. Whether the deployed Buzz relay accepts a key derived from Okta `sub` for real users (depends on relay `relay_members` seeding; not testable read-only).
4. Whether any external process delivers `/invite/<token>` links into the desktop app (no in-repo mechanism found).
5. Backend production hardening (rate limiting absent; CORS layer `Any`-style at `routes/mod.rs` header) — noted, not audited in depth.

---

## 18. CRITICAL DECISION REPORT

**1. Can Okta currently be safely disabled/commented out?**
**No.** Okta is the only source of the identity that the derived key, the relay login, the role lookup, the Application User and the bearer token all hang from. Removing it leaves only the fixed dev key ("Development Mode"), no backend session, and no way to reach the HTTP screens.

**2. Exactly which pieces depend on it?**
- *Frontend:* `LoginView.vue`, `OktaCallbackView.vue`, `features/auth/{useAuth,authService.okta,authService.okta.browser,oktaBrowserFlow,types}.ts`, `stores/session.ts`, `InviteLandingView.vue`, `services/ApiClient.ts`, `app/config.ts`.
- *Tauri:* `auth/oidc.rs`, `commands/{auth,secure_storage}.rs`, `storage/secure_store.rs`, `tauri.conf.json` deep-link scheme, `lib.rs`.
- *Backend:* `jwks.rs`, `config.rs`, `routes/session.rs`, `models.rs`, `repo/*` (`okta_sub`), `auth.rs`/`token.rs`.
- *DB:* `users.okta_sub`, `sessions`.
- *Env:* `VITE_OKTA_*`, `SWF_BUZZ_OKTA_*`, `SWF_BUZZ_BACKEND_URL`.

**3. Which Nostr code is still required for human users?**
Everything in classes A, B, C, D, G of §10 as long as the legacy screens and the login gate remain: the derived-key signer, `RelayConnectionService` (NIP-42), `RelayMembersService`/`resolveMyRole` (gate), `ChannelService`, `MessageService`, `ThreadService`, `ReactionService`, `PresenceService`, `TypingService`, `DmService`/`Kind41010Transport`, `ProfileService`, moderation + `nip98.ts`, `publish.ts`, `relayQuery.ts`. The three items that **block login** are: the derived signer, the relay connect, and the relay role lookup.

**4. Which Nostr code is only required for agents?**
`features/agents/*`, `protocol/agents.ts`, `stores/agentActivity.ts`, `AgentActivityBar.vue`, agent detection in `ProfileService`, mention candidates — **plus** the human key's NIP-44 decrypt of observer frames (the one human↔agent coupling).

**5. Which screens are already fully HTTP / Application-User based?**
`/community` (channels, messages, threads, channel members), `/community-dm`, the Community modal (members/roles, invites), `InviteLandingView` (service layer), Home's channel list. *Caveat:* all of them still sit behind the Nostr-based router guard and login gate, and none work in a plain browser.

**6. Which screens still use the old Nostr path?**
`/channels`, `/dm`, the sidebar channel and DM lists, `UserProfilePanel` (profile→DM), reactions, presence, typing, agent activity, moderation, member/role display in legacy panels, and the login gate.

**7. Smallest sequence of changes to make human users fully Application-User based** *(recommendation only; nothing implemented)*
1. **Make the backend session the gate:** set `ready` from `GET /api/session` (+ HTTP community role) instead of the relay; stop calling `relayConnectionService.connect()` and `resolveLocalIdentitySigningService` during login; fix silent-resume so it no longer deletes the token on relay failure. *(Removes the derived-key security issue and the relay dependency at once.)*
2. **Guarantee a session exists:** document/require `SWF_BUZZ_BACKEND_URL` (or move bootstrap into the frontend-visible config), and add a bootstrap to the browser Okta flow or declare browser mode unsupported for HTTP features.
3. **Point navigation at HTTP:** make `/community` the landing target (Home, post-claim "Open Community", sidebar lists via `useChannelsHttp`/`useConversationsHttp`).
4. **Fill the HTTP gaps humans still need:** user directory/profile endpoint (so names replace UUIDs and profile→DM works), community list/details, then reactions; presence/typing if required.
5. **Fix the invite journey edges:** a way to open `/invite/<token>` in the desktop app (deep link or paste box), correct `SWF_BACKEND_INVITE_BASE_URL` default, session-aware realtime reconnect on membership change.
6. **Only then** remove dead legacy code (bunker UI, `features/invites`, NIP-46, dev signer from human paths, `pubkey` in `session`), verified feature by feature (D10's own sequencing).

**8. What must remain untouched because it belongs to agents?**
The agent feature set in §12 (and `protocol/agents.ts` kinds), and the relay-side agent participants. Preserve the observer-frame delivery mechanism, or replace it deliberately (it currently relies on the human key).

**9. What must remain untouched because it belongs to the Buzz Relay?**
Everything in `buzz/buzz` (reference and infrastructure only), the relay's own tenancy/membership/NIP-42/NIP-98 machinery, and the running relay process. SWF only *connects* to it; agents keep using it.

**10. Which GitHub / local-agent features can be excluded from SWF BUZZ?**
- **GitHub / projects / git hosting:** nothing exists in SWF; simply never port it (OLD BUZZ `features/projects`, `git-*` crates, relay `api/git`).
- **Local/managed agents & runtime, huddles, workflows, terminal, canvas, mesh, pairing, push:** none present in SWF; exclude from any future port.
- **Remote/server-side agents:** stay as Nostr participants under D10; only their *display* features (`features/agents/*`) exist in SWF and should be kept.

---

## 19. Additional findings worth a decision

| # | Finding | Severity | Conf. |
|---|---|---|---|
| 1 | Derived Nostr key from `okta_sub` is recomputable by anyone who knows the `sub`; no runtime dev-only guard | **High** if the relay is trusted for real access | CONFIRMED |
| 2 | Login hard-depends on the Buzz relay; silent resume deletes a valid backend token when the relay is down | Medium (availability/UX) | CONFIRMED |
| 3 | `SWF_BUZZ_BACKEND_URL` undocumented; without it the whole HTTP UI is unauthenticated | Medium (setup trap) | CONFIRMED |
| 4 | Browser build: no backend session → HTTP screens unusable | Medium | CONFIRMED |
| 5 | Invite URLs not deliverable into the desktop app; default invite base URL uses the wrong port (5173 vs 1420) | Medium | CONFIRMED |
| 6 | Post-claim navigation goes to legacy `channels` | Low–Medium | CONFIRMED |
| 7 | `/ws` bearer token in URL query | Low–Medium | CONFIRMED |
| 8 | Realtime uses a connect-time membership snapshot; new channels/DMs need reconnect | Low | CONFIRMED |
| 9 | HTTP UI shows raw UUIDs for other users; DM start requires typing a UUID | Low (UX) | CONFIRMED |
| 10 | Open channels need explicit self-join (differs from OLD BUZZ where any member may read/write an open channel) | Behavioural difference | CONFIRMED |
| 11 | No claim rate limiting in the backend | Low–Medium | CONFIRMED |

---

*Audit scope note: no application source, package, Cargo, environment, Okta, database or API file was modified. The only file created is this report.*
