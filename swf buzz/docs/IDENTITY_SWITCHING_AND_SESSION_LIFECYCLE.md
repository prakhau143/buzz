# Identity Switching & Session Lifecycle (P0)

Scope: how SWF Buzz decides *who it is acting as*, how that changes (sign-in, sign-out, import/switch,
silent resume), and what is guaranteed to be gone when it does. Written after the P0 hardening pass
(2026-09-22) and updated the same day for the **shared-device sign-out policy** (§3a, §4, §16, D13);
the code it describes is `src/features/auth/identitySession.ts`, `useAuth.ts`, `useSignOut.ts`,
`ui/SignOutDialog.vue`, `RelayConnectionService.ts`, the session/connection/ui/readState stores,
`queryKeys.ts`, `LoginView.vue`, and in Rust `src-tauri/src/identity/{storage,commands,backup}.rs`.
OLD BUZZ (`../buzz`) was not modified. No Okta, no application-user layer.

**Policy, in one line: SWF Buzz sign-out securely removes the current local identity from the
device.** This is a deliberate SWF product/security decision for shared and work machines and is
**not** OLD BUZZ parity — OLD BUZZ keeps the key on sign-out (§16).

Related: `SWF_ROLE_MODEL.md` (Operator ≠ Owner), `PHASE_2_1_OPERATOR_TERMINOLOGY_AND_HARDENING_AUDIT.md`
(operator probe), `PHASE_3_IMPLEMENTATION_AUDIT.md` §19–§20 (results), `DECISIONS.md` D12/D13,
`SECURITY.md`.

## 0. The bug this pass fixed (runtime trace, Phase A)

Reported: sign in as member A → sign out → login screen still "found" A → import operator B → app
still behaved as A ("stuck on one identity/role"). Traced, not guessed:

| Question | Finding |
|---|---|
| A. "Continue" | `useAuth.loginWithLocalIdentity("continue")` → `get_identity` (Rust) → `TauriSigningService` active → `resolveAccess` (NIP-98 operator probe + membership probes) → `openRelay` → NIP-42 → `relay_members` role → `ready`. |
| B. "Import" with an identity present | `replaceIdentityLocal` → Rust `replace_identity` (archives the old key under `identity_previous_<pubkey8>`, stores the new one — never deletes) → LoginView `refreshIdentity` → "continue" as above. |
| C/D. What "Sign out" cleared | Signer registry, `relayConnectionService.disconnect()`, `access` store, `session` store. **Not** the identity in secure storage (OLD BUZZ semantics at the time; **changed the same day** — see §3a: SWF sign-out now removes it). |
| E/F. Socket / signer | Both cleared on sign-out. `disconnect()` also cleared the subscription registry. |
| G. Stale signer in a registry | The local signer (`TauriSigningService`) is a stateless proxy to Rust: `sign_event` signs with whatever `IdentityState` holds *now*. Rust's `replace_identity` swaps that atomically. No stale signer object exists to leak. |
| H. Old pubkey in Pinia | `session.clearSession()` nulled it. |
| **I/J. Old role / cached data** | **ROOT CAUSE 1.** Vue Query keys were global (`["channels"]`, `["relay-members"]`, `["channel-messages", id]`, `["reactions", id]`, `["dm-list"]`, `["profile", pk]`…) and `queryClient.clear()` was never called. After A→B, every view rendered A's cached roster/channels/messages as B's (gcTime 5 min), and `ChannelsView`'s `myRole` was computed from A's cached roster. Also uncleared: `ui.selectedChannelId/contextPanel`, `readState.unreadCounts/hasMention`, `dmReadState.lastReadAt` (not pubkey-scoped), `agentActivity.byPubkey`, `connection.authDenial`. |
| **K. Import = save only, or switch?** | Rust made it the active key. **ROOT CAUSE 2 (JS):** `replaceIdentityLocal`'s teardown was gated on `previous = session.pubkey`, which is `null` after a sign-out — so on the exact reported path (sign out → import) no teardown ran at all, leaving reconnect timers/registry state from any earlier attempt alive. |
| L/M. Fresh NIP-42 with the new pubkey | Yes by construction (Rust signs), but **never verified**: the app only checked `status === "connected"`, which is identity-blind. |
| N. Old socket closed before the new connects | `openRelay` called `disconnect()` first — but `disconnect()` did not invalidate an in-flight `attemptConnect`, so a slow handshake started by A could still become "the" socket after B began (generation race). |
| O. Operator vs community | Resolved separately (`operatorService.isOperator` vs `relay_members`) but stored in different places (`access.isOperator` vs `session.communityRole`), and `AppSidebar` re-probed into a component-local ref with no pubkey guard. |
| **UI** | `LoginView` said "An identity was found on this device / Continue with existing identity / Import existing identity" — accurate (the key *is* still there) but read as "you're still signed in". Wording, not storage. |

## 1. Identity storage

Rust only (`src-tauri/src/identity/`): secp256k1 key generated/imported in Rust. `get_identity`
returns public info only. The webview never receives a private key; the only secret it ever holds is
what the user *types* into the import form, cleared on submit.

**Storage matrix** (audited for the sign-out policy — every place a secret can live):

| Storage location | Contains identity? | How to delete | Used in production? |
|---|---|---|---|
| OS keyring, service `swf-buzz`, entry `identity_nsec` (`identity_nsec.<profile>` under the debug `SWF_BUZZ_PROFILE`) | Yes — the live identity | `secure_store::delete(live_entry())` via `KeyStore::delete` | Yes — primary |
| `identity.key` in the app data dir (`profiles/<name>/` under a debug profile) | Yes — fallback written only when the keyring is unusable | Overwritten with zeros, then unlinked (`shred_file`); only if it holds the identity being removed | Yes — fallback only |
| `identity.keyring` marker file | No key material — "a key was stored in the keyring once" | Unlinked; otherwise the next launch reports recovery state `lost` | Yes |
| OS keyring `identity_previous_<pubkey8>[.<profile>]` — archive written by `replace_identity` ("Switch / Import another identity") | Yes — the switched-away identity | `KeyStore::delete_archive(label)`; the keyring cannot be listed, so labels come from the manifest below plus the identity being removed | Yes |
| `identity.archives` manifest — one `<pubkey8>` label per keyring archive made by this version of the app | No key material (first 8 hex chars of *public* keys) | Unlinked | Yes |
| `identity.previous-<pubkey8>.key` — file archive written by `replace_identity` when the identity lived in `identity.key` | Yes | All of them shredded + unlinked (enumerable by name) | Yes |
| `identity.key.corrupt-<ts>` — an unreadable file moved aside by `import_identity` | Not a usable key | Left alone | Rare |
| `SWF_BUZZ_PRIVATE_KEY` (debug-build environment override) | Yes | Cannot be deleted from the app — `delete_identity` **refuses** with an explanation | Debug only |
| In-memory `IdentityState` (Tauri managed state) | Yes | Replaced with `Resolved::default()` after the on-disk removal succeeds | Yes |

`replace_identity` archives the current key and refuses to proceed if the archive cannot be read
back; it now also records the archive's label in the manifest so a later sign-out can remove it.

## 2. Active identity

"Active" = the pubkey in `session.pubkey` **and** the signer in `signingServiceRegistry` **and** the
pubkey that signed the current socket's NIP-42 AUTH (`connection.authenticatedPubkey`). All three
are set by `beginIdentitySession` and all three are cleared by `endIdentitySession`. A pubkey alone
never authenticates anything (no field, no header, no query parameter).

## 3. Sign-in

```
LoginView "Continue with this identity" / IdentitySetup create|import / attemptSilentResume
  → useAuth.loginWithLocalIdentity
      endIdentitySession()                       ← always; a sign-in is a fresh session
      get_identity (Rust) → pubkey
      setActiveSigningService(TauriSigningService)   phase SIGNER_READY
      resolveAccess(pubkey)                          phase ROLE_RESOLVED ("Resolving permissions…")
          operatorService.probeOperator → {status, signerPubkey}   (NIP-98, deployment plane)
              signerPubkey ≠ pubkey  →  decision "mismatch": explicit error, signer cleared, NOTHING routed  (§3d)
              status 200             →  session.platformRole = "operator"
          discoverMemberships         → access.memberships     (NIP-98 per community)
          diagnostics store           ← probe status + signer + decision (public info, §17)
      route: operator / communities / welcome → READY (NIP-98-authenticated, no socket yet)
      open:  openRelay(pubkey, relayUrl) → beginIdentitySession(...)   (§7–§9)
```

The decision table (hardening pass, Part A), applied literally by the code:

| Evidence | Meaning | What the app does |
|---|---|---|
| probe signer = pubkey, **200** | this identity IS a configured operator | `platformRole=operator`, route `/operator` (regardless of community role) |
| probe signer = pubkey, **403** | not in `RELAY_OPERATOR_PUBKEYS` | `platformRole=null`; community routing only |
| probe signer **≠** pubkey | a leaked/other signer answered | `mismatch` — auth error "Identity mismatch: …", signer cleared, no route |
| probe never answered (`network`) | relay unreachable | not an operator this attempt; if memberships also unreachable → "unreachable" |

**Operator ≠ community member.** An operator may have `communityRole === null` and still land on
`/operator`; an owner is never an operator by virtue of owning (§10, `capabilities.ts`).

## 3c. Create identity — the explicit backup checkpoint (`CreateIdentityFlow.vue`)

```
CREATE_START ("Create new identity")
  → BACKUP_PASSWORD        backup password + confirm (≥ 12 chars, validated before Rust is asked)
  → GENERATE_IDENTITY      Rust `create_identity_with_backup(password)`: generates ONLY if none exists,
                           persists (keyring → identity.key fallback), encrypts NIP-49, returns ONCE
                           { pubkey, npub, nsec, ncryptsec }
  → IDENTITY_BACKUP_REVEAL "Your identity is ready": npub [Copy], nsec [Show][Copy] (hidden by default),
                           ncryptsec [Copy backup][Download backup]
  → BACKUP_CONFIRMATION    "⚠ Save your identity backup" + two required checkboxes
                           ☐ I have securely stored my identity backup.
                           ☐ I understand that losing it may prevent me from signing in again.
                           [Continue to Communities] (disabled until both)
  → (LoginView) onContinue → loginWithLocalIdentity → resolveAccess → community selection / operator / welcome
```

Rules: **no relay authentication and no routing before the confirmation** (Part L). The `nsec` exists
in the webview only as `CreateIdentityFlow`'s local `reveal` value, on that screen, and is cleared on
confirm, on leave and on unmount; it never enters Pinia, Vue Query, localStorage, a URL, a log or a
request (`loginView.spec.ts` asserts the session store and the DOM contain no `nsec1` afterwards).
Leaving the reveal without confirming warns once ("You haven't confirmed your identity backup…" —
[Stay] / [Leave anyway]) and never traps: the key is on the device, the login screen shows STATE 2.
`create_identity_with_backup` refuses when an identity exists or the passphrase is short, changing
nothing. Import continues to accept nsec / 64-hex / ncryptsec and to refuse `npub1…` with the exact
message in `identityApi.NPUB_REJECTED_MESSAGE`.

## 3d. Identity mismatch guard (Part A3)

`buildNip98Auth` returns the pubkey on the signed kind:27235 event. `resolveAccess` compares it with
the identity being signed in. Any difference is an error surfaced as such — never a silent
"member" fallback — because routing on that answer would sign someone else in. `resolvePlatformRole`
applies the same rule for the E2E/tool path. `beginIdentitySession` already applies it to NIP-42
(§9). Verified live: `liveRelay.e2e.spec.ts` "resolveAccess" block, the `mismatch` step.

## 3a. Sign-out — SWF shared-device policy (removes the identity)

"Sign out" on SWF Buzz means **end the session AND remove the current identity from this device**.
`useSignOut.requestSignOut()` → `SignOutDialog` (§3b) → `useAuth.logout()` →
`endIdentitySessionAndRemoveIdentity()`:

```
disable UI actions (button busy)
  → relayConnectionService.disconnect()      socket closed, subscriptions dropped,
                                             connectGeneration bumped (reconnect cannot revive), url nulled
  → clearActiveSigningService()              nothing may sign
  → connection.resetForSignOut()             authenticatedPubkey / authDenial null
  → ui.resetForSignOut()                     selected channel / DM / thread gone
  → readState.$reset(), dmReadState.$reset(), agentActivity.$reset()
  → queryClient.clear()                      every identity-scoped cache freed
  → session.clearSession(), access.clear()   pubkey, communityRole, platformRole, routing decision null
  → Rust delete_identity                     keyring entry, identity.key (if this key), every archive
                                             (this key's + manifest + file archives), marker, manifest
  → Rust re-resolves: get_identity() == none, recovery == none   ← REQUIRED for success
  → session.identityRemovalError = null
  → /login  → STATE 1 "No identity is stored on this device."
```

Sign-out is **complete only after the verified removal**. `endIdentitySession()` (session-only
teardown, idempotent) is still the first half and is what `beginIdentitySession`, `switchCommunity`
and the switch/replace path use — those are not sign-outs.

**Failure path** (Rust could not remove something — keyring backend refused, a different valid key
sits in `identity.key`, an environment identity): the session is already gone (no signer, no
socket, no roles, no caches — a safe logged-out state), the identity is **still stored**, and the
app never pretends otherwise: `session.identityRemovalError` carries Rust's reason (default text
"Couldn't remove this identity from this device. Please try again."), the user is taken to `/login`,
which shows the identity fingerprint, the error, "You are signed out, but this identity is still
stored on this device. Remove it before handing the device to someone else." and a
**[Remove identity from this device]** retry (`useAuth.removeStoredIdentity()` → same Rust call).
"Continue with this identity" stays available (it is still the user's key). The notice clears on a
successful removal or a successful sign-in.

**Archive policy.** Sign-out removes the active identity **and every archived copy this app made**
("Switch / Import another identity" archives the previous key; on a shared device that copy must
not outlive the next sign-out). Archives are found through the `identity.archives` manifest plus the
`identity.previous-*.key` file names; an archive made by an older app version (before the manifest
existed) is not listed and is therefore left alone — documented limitation, never a silent deletion
of something unrecorded. The switch screen tells the user their current key is archived *until the
next sign-out*.

## 3b. Backup warning before sign-out

`SignOutDialog.vue` (role `alertdialog`, focus-trapped, Escape closes) shows, verbatim:

> Signing out will remove this identity's private key from this device. Make sure you have your
> nsec, hex private key, or ncryptsec backup if you want to use this identity again.

plus "Without a backup you will not be able to use this identity again. Any identities previously
switched away on this device are removed as well." Buttons **[Cancel]** / **[Sign out & remove
identity]**. It informs; it never blocks. Every "Sign out" button (`AppSidebar`, `AppHeader`,
`PlatformAdminView`) goes through `useSignOut`; the legacy Okta/dev modes keep their direct logout
(they have no local identity to remove).

## 4. Sign-out — what the login screen shows afterwards

STATE 1, always (the identity is gone): **"No identity is stored on this device." — [Import existing
identity] [Create new identity] — Development only: [Continue in Development Mode]**. There is no
"Continue with this identity" after a sign-out. STATE 2 ("Identity found on this device." +
fingerprint + [Continue with this identity] / [Switch / Import another identity]) appears only for
a stored identity that has **not** been signed out — an app relaunch before any sign-out. One
active identity per device; no multi-identity picker (deliberately not built).

## 5. Import / switch

```
LoginView "Switch / Import another identity" → ☑ "I understand this will switch the active identity" → [Switch identity]
  → useAuth.replaceIdentityLocal(input, password)
      endIdentitySession()               ← unconditional, BEFORE Rust touches the key (fixes root cause 2)
      replace_identity (Rust)            ← archive old, store new, become the signing key
  → LoginView.refreshIdentity()          ← screen now shows the IMPORTED identity ("Identity switched successfully")
  → loginWithLocalIdentity("continue")   ← §3, as the imported identity; progress: Authenticating… → NIP-42/NIP-98 ✓ → Resolving permissions… → Operator ✓ / Member ✓ → Ready
```
The imported key is never left as "just a stored backup" while the old one stays active: the old
session is gone before Rust swaps keys, and the new session is established from the swapped key.
A device with **no** identity (the normal case after an SWF sign-out) uses `import_identity` (refuses
to replace a working key) via `importAndLogin` — same sign-in afterwards. The imported identity is
then the only identity on the device.

**Accepted input: `nsec1…`, a 64-character hex private key, `ncryptsec1…` (+ its password).
Refused: `npub1…`.** An npub is a *public* key — it identifies, it can never authenticate, and
nothing is derived from it. Both the form (`IdentityImportForm.vue`, submit disabled, `role=alert`
message) and Rust (`backup::recover_keys_from_input`, refused before any parsing) say, verbatim:
"This is an npub public key. It cannot be used to authenticate. Import the matching private-key
backup (nsec, hex key, or ncryptsec)." If only an operator's npub is at hand, the operator's original
private-key backup is required — there is no other way in.

## 6. Reset / recovery

The Rust identity commands are `create_identity` (only when nothing exists), `import_identity`
(into an empty/`lost`/`corrupt` device; moves an unreadable file aside), `replace_identity` (switch:
archives then swaps) and — added for the sign-out policy — **`delete_identity`** (§3a: removes the
current identity and its archives, refuses an environment identity or an empty device, verifies by
re-resolving). No other reset/wipe path exists; the JS-callable `secure_storage_*` commands cannot
reach the identity entries by construction. Recovery after a sign-out is only by the user's own
backup (NIP-49 `ncryptsec`, nsec or hex) → import.

## 7. Signer lifecycle

`signingServiceRegistry` holds exactly one `SigningService`. `endIdentitySession` clears it (any
sign attempt then throws "No signing service is active yet"). `beginIdentitySession` sets the one
it was given. For the local identity that is the stateless `TauriSigningService`; the *key* it
signs with is whatever Rust holds, which `replace_identity` swaps atomically — so "destroy signer A
/ create signer B" is realised as *registry cleared → Rust key replaced → registry set*, verified
afterwards by the AUTH pubkey (§9).

## 8. RelayConnection lifecycle

`relayConnectionService` is a singleton and is **session-resettable**: `disconnect()` closes
subscriptions and the socket, clears the registry, bumps `connectGeneration` (any in-flight
`attemptConnect` from the previous identity discards its socket on arrival), nulls `url` (a stale
reconnect timer can no longer reconnect as the old identity) and nulls
`connection.authenticatedPubkey`. Two identities can therefore never share a socket.

## 9. NIP-42 — verified, not assumed

`RelayConnectionService.signAuthEvent` records the **signed AUTH event's own `pubkey`** in
`connection.authenticatedPubkey` (nulled on disconnect/close). `beginIdentitySession` refuses the
session — tears down, `authError` — if that pubkey differs from the one being established. A relay
that sends no challenge leaves it `null` (reported as "not authenticated", never as a mismatch).
`RelayConnectionService.isAuthenticatedAs(pubkey)` is the strict check for callers.

## 10. Operator vs community roles — two planes, never collapsed

| Plane | Source | Store | Cleared by |
|---|---|---|---|
| Platform: `operator` | `operatorService.isOperator` → relay's answer to NIP-98 on the operator routes (`RELAY_OPERATOR_PUBKEYS` / `relay_operators`) | `session.platformRole`, getter `session.isPlatformOperator`; `access.isOperator` (routing cache) | `clearSession` / `endIdentitySession`; also nulled whenever `setIdentity` gets a *different* pubkey |
| Community: `owner`/`admin`/`member`/`null` | `relay_members` (kind:13534 snapshot) for the connected community, after NIP-42 | `session.communityRole` | same |

Guarded by tests: `identitySecurity.spec.ts` asserts `setPlatformRole(` is written only next to an
`operatorService.isOperator(`/`probeOperator(` call, that the operator probe URL is built in exactly
one place, that `resolveAccess` refuses a probe signed by another identity, and that nothing
derives one plane from the other. The UI shows both badges separately (`AppSidebar` footer:
`active-identity`, `platform-role`, `community-role`). An operator who is not in `relay_members`
gets `communityRole: null` and is refused by NIP-42 like anyone else; an owner who is not in
`RELAY_OPERATOR_PUBKEYS` gets `platformRole: null`.

**Capability model (hardening pass, Part E) — `src/features/access/capabilities.ts`.** The one place
that turns the two planes into UI capabilities; components read `useCapabilities()` instead of
comparing role strings:

| Capability | operator, no community | owner (not operator) | member | none |
|---|---|---|---|---|
| canAccessOperatorDashboard / canManageDeployment / canCreateCommunity | ✓ | ✗ | ✗ | ✗ |
| canOpenCommunity / canCreateChannel | ✗ | ✓ | ✓ | ✗ |
| canManageCommunityMembers / canInviteToCommunity / canModerateCommunity | ✗ | ✓ (admin too) | ✗ | ✗ |

Message edit/delete/admin-delete are deliberately not capabilities yet (no receive-side protocol
support) — nothing fake is shown. `AppSidebar` gates "Create channel", "Create community" and the
"Operator Dashboard" link on these; `OperatorDashboardView` still re-probes the relay on arrival.

**Community selection is per identity (Part D).** `endIdentitySession` (and `beginIdentitySession`
for a different pubkey) clears the persisted "last opened community" (`clearActiveRelay`), so the
next person's community is decided again by `resolveAccess` for their own pubkey; a session re-sets
it for the community it actually opened. The address book (`swf_relay_communities.v1`) stays — it is
a list of addresses, re-probed with the current signer, never a grant.

## 11. Cache isolation

- **Vue Query**: every key is prefixed `["identity", <pubkey|"anonymous">, …]` (`queryKeys.ts`) —
  B can never *read* A's entries — and `endIdentitySession` calls `queryClient.clear()` so they are
  also *freed*. Keys are identity-scoped, not relay-scoped, so `beginIdentitySession` clears the
  cache even for the same identity opening another community.
- **Pinia**: `session` (identity, both roles), `access` (routing decision), `connection`
  (verdicts, authenticated pubkey), `ui` (selected channel/DM/thread), `readState`, `dmReadState`,
  `agentActivity` — all reset on sign-out/switch. `readState` persistence in localStorage was already
  namespaced by pubkey (`swf-buzz:read-state:<pubkey>`) and stays so; it holds timestamps only.
- **localStorage otherwise**: `swf_relay_communities.v1` (address book — addresses grant nothing,
  every entry is re-probed with the current signer), `profile-setup skipped` (per pubkey). No key
  material anywhere.

## 12. Identity switching — the state machine

```
NO_IDENTITY → IDENTITY_LOADED → SIGNER_READY → RELAY_CONNECTING → NIP42_AUTHENTICATED → ROLE_RESOLVED → READY
READY → endIdentitySessionAndRemoveIdentity():
        disconnect → cancel reconnect (generation) → clear signer → clear session → clear platform role
      → clear community role → clear access → clear connection verdicts → clear selected channel/DM/thread
      → clear read/unread + DM read state → clear agent activity → clear Vue Query
      → DELETE identity from OS keyring → DELETE identity.key fallback (if this key)
      → DELETE archived copies → clear identity metadata (marker, manifest)
      → verify get_identity() == none → NO_IDENTITY → /login (STATE 1)
```
`useIdentitySessionStore` exposes `phase`/`failedAt` for the login screen's progress list; it is
display state, not authority.

## 13. Recovery

Sign-out **removes the key from this device**, so the only way back for that identity is the user's
own backup (§3b warns before it happens). A switched-away key is archived until the next sign-out
(§3a). Unreachable relay during sign-in leaves the signer active so the background reconnect can
answer the challenge (unchanged contract, still tested). A failed removal keeps the key (and says
so) rather than losing it (§3a failure path).

## 14. Security rules (unchanged, now enforced at more points)

Private keys never enter Vue, Pinia, Vue Query, localStorage, logs, tests or docs; `sign_event` is a
Tauri command; NIP-98/NIP-42 are signed in Rust; operator status is only ever the relay's answer;
"connected" is never treated as "authenticated as X" — `authenticatedPubkey` is. **Deletion happens
only in Rust** (`delete_identity`, through the same `KeyStore`/`secure_store` abstraction that
stores the key) — there is no frontend-side secret deletion of any kind, and the identity is never
reported removed unless Rust re-resolved to "none". Files that held a key are overwritten with zeros
before unlinking. An `npub` is never accepted as a way in. The throwaway operator keys used for the
E2E runs were generated outside the repository, passed via `SWF_E2E_OPERATOR_SK` for the test
process only, appended to `RELAY_OPERATOR_PUBKEYS` (never replacing the real key) for the run only,
reverted, and the relay restarted and verified to refuse a throwaway key (403 through the app's own
NIP-98 path) afterwards.

## 15. Test matrix

**Real relay** (`tests/integration/liveRelay.e2e.spec.ts`, "P0 identity switching A → B → A → B → A,
no restart" — drives `beginIdentitySession`/`endIdentitySession`, the app's own lifecycle, on the
singleton connection; run 2026-09-22, **PASS**):

| # | Identity | Expected | Result |
|---|---|---|---|
| 1 | Member A | Login | PASS — `relayAuthenticatedPubkey === A` |
| 2 | Member A | Community = member | PASS — `communityRole: "member"`, `platformRole: null` |
| 3 | Sign out | A inactive | PASS — pubkey/roles null, socket disconnected, signer throws, selection cleared, A's caches gone, publish rejected |
| 4 | Operator B | Import | PASS — session pubkey B |
| 5 | Operator B | NIP-42 with B | PASS — AUTH event pubkey B (from the signed event) |
| 6 | Operator B | Operator permission | PASS — `platformRole: "operator"`, live operator endpoint 200 |
| 7 | Operator B | Correct community role | PASS — `owner` from `relay_members` (B named itself owner); A still `member` in the roster |
| 8 | Sign out | B inactive | PASS — `isPlatformOperator` false, authenticated pubkey null |
| 9 | Member A | Import | PASS |
| 10 | Member A | NIP-42 with A | PASS |
| 11 | Member A | member role | PASS — and A's earlier message is in the channel history; operator probe 403 for A |
| 12 | Operator B | switch again (no explicit sign-out) | PASS — begin tears A down itself |
| 13 | Member A | switch again | PASS |

After each switch the test logs only: `Active identity: npub…`, `Community role`, `Platform role`,
`Relay auth: authenticated as <pubkey8>…`. **Unit** (`tests/unit/auth/identitySession.spec.ts`,
mocked relay): same shape plus the mismatched-AUTH refusal, unreachable-relay contract, same-person
community switch keeping the routing decision, and the key-scoping of `queryKeys`.
**LoginView** (`loginView.spec.ts`): STATE 1/2/3 wording, switch tick + "Switch identity" button,
"Identity switched successfully" with the imported key, and the teardown-before-replace ordering.

### 15a. Shared-device sign-out — real relay (`liveRelay.e2e.spec.ts`, "shared-device sign-out removes the identity: A → delete → B → delete → A ×3"; run 2026-09-22 with a temporary throwaway operator, **PASS**, ~12 s)

Drives the app's own `endIdentitySessionAndRemoveIdentity` on the singleton connection against the
real relay, real NIP-42, real role answers, no application restart. The Rust `delete_identity`
command needs a desktop process, so the *device* is a fake store injected through the function's
`remove` parameter: it records every removal and answers `get_identity() = none` exactly as Rust
does after a verified removal (Rust's own removal is covered by `cargo test`, below). Three full
cycles, each asserting every step:

| Step | Identity | Verified (npub / roles / auth only — never a key) |
|---|---|---|
| 1 | Member A imports onto the clean device, signs in | `session.pubkey = A`, AUTH event pubkey `= A`, `communityRole = member`, `platformRole = null`, active signer is A; cycle 1 sends a message, cycles 2–3 find it in history (sign-out removed the *key*, not A's data) |
| 2 | A: Sign out & remove | `{removed: true}`; device `get_identity() = none`; `session.pubkey/authMode/communityRole/platformRole = null`, `isPlatformOperator = false`, `identityRemovalError = null`; `access` empty; `connection.status = disconnected`, `authenticatedPubkey = null`; `ui` selection/panel cleared; `readState`, `dmReadState`, `agentActivity` empty; Vue Query cache has 0 entries; signer throws; `publish` rejects; still disconnected 1.5 s later (no reconnect revives A) |
| 3 | Operator B imports onto the clean device, signs in | `session.pubkey = B`, AUTH pubkey `= B`, `platformRole = operator` (live NIP-98 answer, operator endpoint reachable), `communityRole = owner` (from `relay_members`, separately); nothing of A in any cache or badge |
| 4 | B: Sign out & remove | same 17 assertions as step 2; `get_identity() = none` |
| 5–12 | repeat 1–4 twice more | PASS each time |
| — | Removal ledger | exactly `[B, A, B, A, B, A, B]` — every sign-out removed precisely the identity that was on the device |

**Rust** (`cargo test --lib`, `src-tauri/src/identity/storage.rs` + `backup.rs`, 65 passed): keyring
identity removed and a relaunch finds *nothing* (not `lost`, not `corrupt`) and can import again;
fallback `identity.key` removed; archived copies made by `replace_identity` (keyring, via the
manifest, and file archives) removed on the *next* identity's sign-out; environment identity and an
empty device refused; a `corrupt` entry is not wiped; a failed keyring delete leaves the key loaded
and fails loudly; a lingering copy of the *same* key in `identity.key` is removed too, a *different*
key there is left alone and the call fails "still present"; files are zero-filled before unlinking;
`npub1…` refused with the exact message (upper/lower/whitespace, with or without password).

**Unit — the §17 list** (`useAuth.spec.ts`, `identitySession.spec.ts`, `loginView.spec.ts`,
`signOutDialog.spec.ts`, `identityApi.spec.ts`, `onboardingUi.spec.ts`; 566 passed): logout deletes
identity · clears signer · clears session · clears roles · clears cache · disconnects relay ·
teardown before Rust delete · `get_identity` none after logout · login screen shows STATE 1 after
logout, never "Continue with this identity" · removal failure keeps the identity, shows the error
and retry, never a fake "signed out" · a removal that still reports a pubkey is a failure · npub
rejection (exact text, submit disabled, Rust never called) · nsec / hex / ncryptsec import · import
after logout lands on a clean device with no `replace_identity` · A → logout → B · B → logout → A ·
A → B → A · stale AUTH from A rejected after B · platform/community roles separate · dialog copy,
Cancel/confirm/Escape, local-only gating.

## 16. DIFFERENCE FROM OLD BUZZ — deliberate, not parity

| | OLD BUZZ (`../buzz` desktop) | SWF Buzz |
|---|---|---|
| Sign out | Ends the session; **the identity stays on the device** ("Continue" resumes it) | Ends the session **and removes the identity from the device** (§3a) |
| Login after sign-out | Offers the previous identity | "No identity is stored on this device." — import or create |
| Archived (switched-away) keys | Kept | Removed on the next sign-out (manifest-tracked) |
| Why | Single-user machine assumption | Shared/work machines: the next person must never see, continue with, or recover the previous person's key |

The earlier P0 pass implemented OLD BUZZ semantics and documented them as such; this policy
supersedes that for the local identity only. Nothing else in the lifecycle changed
(`beginIdentitySession`, the three consistency checks, `connectGeneration`, identity-scoped query
keys, `queryClient.clear()`, separate `platformRole`/`communityRole`). Recorded as `DECISIONS.md` D13.

## 17. Identity diagnostics (development builds only) — hardening pass, Part A1

The "operator key imports but member UI appears" report could not be diagnosed from outside the
process: nothing recorded which key signed the NIP-98 probe or what the relay answered. Now:

- **Rust audit trail** (`src-tauri/src/identity/commands.rs::log_identity`): every state change
  prints `swf-buzz: identity created|imported|replaced|removed — storage=…, pubkey=<hex>` to the
  `tauri dev` stderr. Public key only, never the secret. `delete_identity` logs the removed key's
  first 8 chars.
- **Diagnostics store** (`src/stores/diagnostics.ts`, public information only): `lastOperatorProbe`
  {forPubkey, signerPubkey, status, error, origin}, `lastAccessDecision` {kind, destination,
  membershipCount}, `lastIdentityMismatch`. Written by `OperatorService.probeOperator` and
  `resolveAccess`; cleared with the session.
- **Panel** (`src/features/identity/ui/IdentityDiagnosticsPanel.vue`, mounted by `App.vue` only when
  `import.meta.env.DEV`, tree-shaken from production): bottom-right toggle showing Rust identity
  (`get_identity`), `session.pubkey`, Rust = session, signer pubkey, NIP-42 AUTH pubkey, the last
  NIP-98 probe (status, signer), platformRole, communityRole, access decision, identity mismatch,
  route, which identities the query cache holds, and **"Stale previous identity: YES/NO"** (any
  signer/socket/cache holder that disagrees with `session.pubkey`).
- **Console trail** (dev only) after `resolveAccess` and `beginIdentitySession`, in the
  user-verified shape: `Active identity / Relay auth / NIP-98 probe / Platform role / Community role
  / Decision`. Fingerprints only.

How to read it after importing a key (the user's decision table): Rust = session **NO** → the app
signed in a different key than the one imported (lifecycle bug); probe **200** + platformRole
`operator` + route not `/operator` → routing bug; probe **403** → the imported key is not in
`RELAY_OPERATOR_PUBKEYS` (key/config, not UI); Identity mismatch **YES** → signer lifecycle bug
(the app now stops with an error instead of falling through); Stale **YES** → isolation bug.
