# Community Onboarding & Invites — Audit

**Date:** 2026-09-23
**Verdict:** the invite protocol is **not ambiguous and not missing**. SWF already
implements OLD BUZZ's real invite flow faithfully. The defects are narrower than
the symptom suggested, and the biggest one is a **relay configuration flag**, not
client code.

---

## 1. Connection-link flow

```
OPERATOR  ──POST /operator/communities──►  community created, initial_owner_pubkey = OWNER
                                              │
                                              ▼
                              swfbuzz://connect?relay=<ws url>[&name=…]
                                              │  carries NO secret, NO code
                                              ▼
OWNER opens it ──► pending relay ──► sign in ──► NIP-42 ──► relay_members ──► role
```

Built by `buildConnectLink` (`RelayInviteService.ts:131-136`), surfaced after
creation by `OperatorService.ts:170`. It **identifies a community and grants
nothing** — the relay still demands NIP-42 proof and consults its own member
list. OLD BUZZ has the identical concept as `buzz://connect?relay=…`
(`desktop/src-tauri/src/deep_link.rs:620-629`), which likewise performs no claim.

## 2. Invite-link flow

```
OWNER/ADMIN ──POST /api/invites (NIP-98)──► { code, expires_at, max_uses, uses_remaining }
                                              │
                                              ▼
                         swfbuzz://join/<code>?relay=<ws url>[&name=…][&by=…]
                                              │
RECIPIENT ──► own identity ──► POST /api/invites/claim (NIP-98) ──► relay_members role=member
```

`buildJoinLink` (`RelayInviteService.ts:117-123`), `createInvite` (`:171-199`),
`claimInvite` (`:205-214`).

## 3. The actual bug

**A connection link pasted into "Join with invite" is rejected with a generic
message.**

`parseInviteInput` (`RelayInviteService.ts:253-297`) accepts `swfbuzz://join…`
and returns `null` for everything else. A connect link has
`url.hostname === "connect"`, so line 264 returns `null`, and
`JoinInvitePanel.vue:46` prints:

> That doesn't look like an invite. Paste the full swfbuzz:// link you were sent.

The parser is right to refuse it — a connect link is not an invite. What is
wrong is that it cannot *tell the user what they actually pasted*, so a correct
link looks broken. The two link types are also not labelled distinctly at the
point of creation, which is what leads people to paste the wrong one.

## 4. Actual OLD BUZZ invite protocol (source-verified)

| Aspect | OLD BUZZ | Source |
|---|---|---|
| Mint | `POST /api/invites`, NIP-98 | `api/invites.rs:284-353`, `router.rs:108` |
| Mint authz | `owner` or `admin` in `relay_members`, else **403** `"only relay owners and admins can create invites"` | `invites.rs:291-304` |
| Mint body | `ttl_secs?` (60 s – 30 d, default 72 h), `max_uses?` (1–10000, null = unlimited) | `invites.rs:49-61`, `buzz-core/src/invite.rs:11-18` |
| Mint response | `code`, `expires_at`, `max_uses`, `uses_remaining`, `url` | `invites.rs:346-352` |
| Token | `"v2." + base64url_nopad(32 random bytes)` — unguessable secret, **not** signed | `buzz-core/src/invite.rs:23-36` |
| Storage | **only `SHA-256(code)`** as `token_hash bytea CHECK(length = 32)` | `migrations/0025_relay_invites.sql:18-31` |
| Role | `CHECK (role = 'member')` — an invite can **never** grant admin/owner | same |
| Claim | `POST /api/invites/claim`, NIP-98 by the **joining** key | `invites.rs:361-515`, `router.rs:124` |
| Membership-gate exemption | structural: the claim handler never calls the membership check | `invites.rs:6-10` |
| Claim result | `status: "joined" \| "already_member"`, `community_id`, `host`, `role` (always `member`) | `invites.rs:432-445` |
| Idempotency | existing member → `already_member`, `use_count` **not** incremented | `relay_invite.rs:277-310` |
| Errors | 403 `invite_invalid` / `invite_expired` / `invite_exhausted` / `join_policy_required`; 429 rate limit; 401 NIP-98 failures | `invites.rs:387-477`, `:368-373` |
| Revocation | **does not exist** — no endpoint, no column | NOT FOUND repo-wide |
| Canonical share URL | `https://<relay-host>/invite/<code>` | `invites.rs:326-332` |
| App deep links | `buzz://join?relay=…&code=…`, `buzz://connect?relay=…` | `deep_link.rs:340-365`, `:620-629` |

**Live confirmation:** `relay_invites` on the dev relay holds 5 real invites,
all `role=member`, one with `use_count = 1` — the flow works today.

## 5. SWF vs OLD BUZZ differences

| Area | Status |
|---|---|
| Mint/claim endpoints, bodies, responses | **Identical** (`RelayInviteService.ts:182-214`) |
| TTL bounds & default, max-uses bounds | **Identical constants** (`:26-29`) |
| Error mapping | **Complete** — all four relay error codes plus 401/403/429 (`:68-80`) |
| Token handling | Correct — SWF never stores or logs the code |
| Invite URL scheme | `swfbuzz://join/<code>?relay=…` vs OLD BUZZ `buzz://join?relay=&code=` — **correct divergence**: SWF is a separate app with its own registered scheme. SWF also parses OLD BUZZ's canonical `https://host/invite/<code>` (`:280-290`) |
| Connect link | `swfbuzz://connect?relay=…` mirrors `buzz://connect?relay=…` |
| Revocation | Neither has it |
| **Connect-link rejection message** | **GAP** — generic instead of specific |
| **Link labelling at creation** | **GAP** — connect link not clearly named |

**There is no missing invite system and nothing to rebuild.**

## 6. The real root cause — a relay config flag

`BUZZ_REQUIRE_RELAY_MEMBERSHIP` is **not set** in `../buzz/.env` and defaults to
`false` (`config.rs:670-672`). One flag gates four behaviors:

| Gated code | Consequence when false |
|---|---|
| `community_provisioning.rs:215` | a new community gets **no kind:13534 roster snapshot** |
| `operator.rs:438` | ownership transfer does not republish the roster |
| `main.rs:625-666` | startup reconciliation **and** the 60 s repair job never run |
| membership enforcement | any authenticated key may query any community |

Observed effects right now:

- **`kwikster.localhost:3000`** (`7f7ddd59…`) was created correctly — owner is
  `07227e7a…` in `relay_members` — but has **0 roster snapshots**, so the client
  resolves the owner's role as `null`. The owner will not see owner UI there.
- The earlier ownership transfer needed a manual roster republish for the same
  reason.
- **`localhost:3000` in the community picker is real, not stale.** `communities`
  contains bare bootstrap rows — `localhost`, `localhost:3000`, `127.0.0.1`,
  `127.0.0.1:3000` — each with **0 members and 0 channels**. `candidateRelays()`
  (`communityDiscovery.ts:113`) always probes `config.relayUrl`
  (`ws://localhost:3000`), and with membership unenforced the relay does not
  refuse, so the probe reports membership. **Do not delete these rows**; the fix
  is either the flag or a client-side filter.

## 7. Security boundaries

| Rule | Where enforced |
|---|---|
| A connection link grants nothing | no claim call on that path; role always from `relay_members` |
| An invite can only grant `member` | DB `CHECK (role = 'member')` |
| Only owner/admin may mint | relay 403 (`invites.rs:291-304`); UI gating is UX only |
| The claimer is the signer | claim is NIP-98-signed by the joining key; the inviter's key is never used |
| No key material in links | invite carries an opaque random code; connect carries only an address |
| The relay never stores the code | only `SHA-256(code)` |
| Role is never inferred from a URL | `identitySession.ts:318-324` resolves from the roster after NIP-42 |

## 8. Permission matrix

| Capability | Operator | Owner | Admin | Member |
|---|---|---|---|---|
| Create/provision community | ✅ | ❌ | ❌ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ | ❌ |
| Operator dashboard | ✅ | ❌ | ❌ | ❌ |
| **Mint invite** | ❌* | ✅ | ✅ | ❌ |
| Manage community members | ❌* | ✅ | ✅ | ❌ |
| Add to private channel | ❌* | ✅ | ✅ | ❌ |
| Chat / public channels / DMs | ❌* | ✅ | ✅ | ✅ |

\* An operator has no community powers unless they also hold a `relay_members`
row — the two planes are independent (`capabilities.ts:49-64`). Verified live:
after the transfer, `38eb252a…` retained operator access (HTTP 200) while being
demoted to `member`.

## 9. Files to change

| File | Change |
|---|---|
| `src/features/communities/RelayInviteService.ts` | classify input: invite / connection-link / unrecognised |
| `src/features/onboarding/ui/JoinInvitePanel.vue` | specific message for a pasted connection link |
| `src/features/communities/ui/CreateCommunityDialog.vue` | label the result "Owner connection link" |
| `src/views/CommunityPickerView.vue` | show name + role + host |
| `src/features/access/communityDiscovery.ts` | consider filtering memberless bootstrap hosts |

**Not to be changed:** the mint/claim service calls, the token handling, the
relay, `relay_members`, `capabilities.ts`, `identitySession.ts`, or the private
channel picker.

## 10. Open decision

**Should `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true` be set on the dev relay?**

- **For:** roster snapshots get published automatically on provisioning and
  transfer; the 60 s reconciler repairs drift; bare bootstrap communities stop
  appearing; owner role resolves without manual repair.
- **Against:** it enforces membership relay-wide, which changes access behavior
  for every existing client, and needs a relay restart.

This is a deployment decision, not a code change, and is left to the user.
