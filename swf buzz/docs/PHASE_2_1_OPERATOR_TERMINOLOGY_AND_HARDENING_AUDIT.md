# Phase 2.1 — Operator Terminology & Hardening Audit

Scope: remove the term "Super Admin" from SWF Buzz, adopt the OLD BUZZ role vocabulary (**Operator / Owner / Admin / Member**), and harden/verify that Operator authority comes only from the relay. Follows `OLD_BUZZ_BOOTSTRAP_AND_SWF_DEPENDENCY_AUDIT.md`; role definitions are in `SWF_ROLE_MODEL.md`.

Nothing was committed or pushed. OLD BUZZ was not modified. No Okta, no application-user layer, no identity-architecture change, no database reset, no keyring deletion of user data.

## 1. Old terminology → new terminology

| Kind | Old | New |
|---|---|---|
| UI heading | Super Admin Dashboard | **Operator Dashboard** |
| UI (sidebar button) | Super Admin | **Operator Dashboard** |
| Route path / name | `/super-admin`, `super-admin` | **`/operator`**, `operator` |
| `AccessDestination` value | `"super-admin"` | **`"operator"`** |
| Component | `SuperAdminDashboardView.vue` | **`OperatorDashboardView.vue`** |
| Test file | `superAdminAndPicker.spec.ts` | **`operatorDashboardAndPicker.spec.ts`** |
| Test selectors | `admin-*` (dashboard) | **`operator-*`** (avoids confusion with the community *Admin* role) |
| Comments / docs | "Super Admin…" | "Operator…" |

Deliberately **not** renamed (already correct, or relay contracts): `OperatorService`, `isOperator()`, `access.isOperator`, the relay paths `/operator/communities*`, the env vars `RELAY_OPERATOR_PUBKEYS` / `RELAY_OPERATOR_API_ORIGIN`, and the community roles owner/admin/member (they are community-level, not operator terminology).

### Classification of the occurrences found (before)

| Category | Count | Action |
|---|---|---|
| UI text | 3 | renamed |
| Route name / path | 2 (+ guard/destination value) | renamed |
| Component name / file | 1 (+ imports) | renamed |
| Variable / function | 0 (`isSuperAdmin` etc. never existed) | — |
| Test names / selectors | ~15 | renamed |
| Comments (code) | ~10 | renamed |
| Documentation written by this project (Phase 2 docs) | 12 | renamed, with a note |
| Historical OLD BUZZ audits saying "no Super Admin exists" | ~20 | kept (correct statements) |
| Backend / API contract | 0 | — |

## 2. Operator architecture

- **Operator = deployment-level authority**, configured only as relay env `RELAY_OPERATOR_PUBKEYS` (+ `RELAY_OPERATOR_API_ORIGIN` for provisioning).
- Verified by a **NIP-98** signed request to `/operator/*`. SWF's single source is `OperatorService.isOperator()` → `GET /operator/communities/availability` (`200` operator / `403` not).
- Never derived from localStorage, Pinia state, a role label, a hostname, a selected community, or a public key. `access.isOperator` is an in-memory cache of the relay's last answer and is **re-verified on arrival** at the Operator Dashboard (a forged flag with a refusing relay redirects to sign-in — tested).
- Operator ≠ Owner is stated in the UI ("Deployment-level access. It does not make you a member or owner of any community.") and in the create dialog ("As an operator you are not automatically a member or owner of the new community…").

## 3. Owner architecture

Owner is community-scoped: `relay_members.role='owner'`, NIP-42. Created by the operator with `initial_owner_pubkey` (`create_only:true`). The owner field defaults to the operator's own key as a convenience but is explicit and editable; the operator is **not** added when someone else is named (tested).

## 4. Authentication flow

```
Operator:  local key → NIP-98 GET /operator/communities/availability → 200 → Operator Dashboard
Owner/Admin/Member:  local key → NIP-42 (community host) → ban gate → relay_members → role
Public key alone: never authenticates (no field, no header, no query parameter)
```

## 5. Community creation flow

Operator Dashboard → Create Community → name / address / **first owner (public key)** → `POST /operator/communities {host, initial_owner_pubkey, create_only:true}` → relay: `communities` + `relay_members(role='owner', added_by NULL)`. `create_only` is **always** sent; the legacy convergence mode (which can rotate an existing owner) has no call site (static test).

## 6. Login flow

Identity-first, unchanged: no community URL, no dropdown, no "Create Community", no "Super Admin". Existing identity → *Continue with existing identity* / *Import existing identity*; none → *Create your identity* / *Import existing identity*; "Development only" section only in dev builds. Import replaces the identity safely (old key archived) and then runs the same access resolution.

## 7. Routing flow (unchanged behaviour, renamed destination)

Operator → `/operator`; exactly one known community → opened; several → `/communities` picker; none → `/welcome`; pending invite/connect link → `/join`; relay unreachable → stay on login with an error.

## 8. Security checks (all automated)

| Check | Where |
|---|---|
| Every writer of operator status obtains it from `operatorService.isOperator(` | `identitySecurity.spec.ts` |
| Operator status never touches browser storage | same |
| No operator derivation from role label / hostname / pubkey comparison | same |
| `initial_owner_pubkey` appears only in `OperatorService`, next to `create_only: true`; never `create_only: false` | same |
| No call site for archive/unarchive/transfer or non-create-only provisioning | same |
| No "Super Admin" string anywhere under `src/` | same |
| Forged `access.isOperator` + refusing relay → redirected to login | `operatorDashboardAndPicker.spec.ts` |
| Operator probe is a signed GET to `/operator/…` on the configured relay | same |
| Non-operator cannot open the dashboard | same |
| Operator with no owned/joined communities sees none (no implicit membership) | same |
| Community created for someone else is not the operator's; body has `create_only:true` and the named owner | same |
| Dashboard / Welcome text has no "Super Admin" | same, `welcomeView.spec.ts` |
| Login has no community URL/dropdown; existing identity resumes; import works | `loginView.spec.ts`, `useAuth.spec.ts`, `onboardingUi.spec.ts` |

## 9. Test results

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings 0`) | pass |
| `npm run build` | pass |
| `npm test` (Vitest) | **54 files, 529 tests, all pass** (+12 new this phase) |
| `cargo fmt --check` | pass (exit 0, whole crate) |
| `cargo check` | pass |
| `cargo clippy --all-targets -- -D warnings` | pass |
| `cargo test --lib` | **57 passed** |

**Node environment (reported, repository not modified).** This machine has Node 20.19.4; the repo's jsdom 30 needs Node ≥ 22.22, so Vitest does not start unmodified. It was run through a shim kept outside the repo (`NODE_OPTIONS="--require …/node20-jsdom-shim.cjs"`). No shim is needed on Node ≥ 22.22.

**Live check (real app, isolated profile, real relay):** importing the operator key led to route `/operator`, heading "Operator Dashboard", the deployment-scope line, three communities with **Open**, **Create Community** and **Join with invite**, and no "Super Admin" text anywhere. The isolated profile's credential and folders were deleted afterwards. The create dialog's new owner hint was covered by unit tests only (the live page had moved on when I tried to open it).

## 10. Remaining occurrences of "Super Admin" (final repository search)

Search: `super[ _-]?admin`, case-insensitive, whole `swf buzz/` (excluding `node_modules`, `target`, `dist`, `.git`). Variants `isSuperAdmin`, `superAdmin`, `super_admin`, `super-admin`: **none remain in `src/`, `src-tauri/`, or route/component names.**

| File | Why retained |
|---|---|
| `tests/unit/security/identitySecurity.spec.ts:170` | The guard test that *asserts* the term is absent (contains the regex) |
| `tests/unit/onboarding/operatorDashboardAndPicker.spec.ts:148` | Negative assertion (`not.toMatch(/super[ _-]?admin/i)`) |
| `tests/unit/protocol/relayMembers.spec.ts:77` | Test data: an *unknown role string* `"superadmin"` in a roster to prove it degrades to `member`. Not terminology |
| `docs/SWF_ROLE_MODEL.md:3` | States "There is **no** Super Admin" |
| `docs/PHASE_2_FINAL_AUDIT.md:3` | Terminology-update note explaining the rename |
| `docs/OLD_BUZZ_BOOTSTRAP_AND_SWF_DEPENDENCY_AUDIT.md` (5) | Explains OLD BUZZ has no such role and maps SWF's earlier wording to *Operator* |
| `docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md` (2), `BUZZ_BUSINESS_WORKFLOW_BLUEPRINT.md` (1), `OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md` (2), `OLD_BUZZ_COMMUNITY_CHANNEL_DM_BEHAVIOR_AUDIT.md` (1), `ROLE_PERMISSION_AUDIT.md` (9), `ROLE_PERMISSION_MATRIX.md` (1) | Earlier OLD BUZZ audits recording, correctly, that "no Super Admin exists". Historical evidence; left as written. (`OLD_BUZZ_BUSINESS_LOGIC_AUDIT.md:10` mentions a "super-admin bootstrap" as a planned reuse — historical planning wording, superseded by `SWF_ROLE_MODEL.md`.) |

## 11. Remaining limitations

Unchanged from `PHASE_2_FINAL_AUDIT.md`: no relay endpoint to discover a key's communities on a brand-new device (L1); relay dev mode accepts a bare `X-Pubkey` on the community REST bridge unless `BUZZ_REQUIRE_AUTH_TOKEN=true` (L2); community names are client labels; operator key custody is an open decision (single organisation vs. control plane — see the bootstrap audit §15). The operator dashboard lists communities the identity **owns or belongs to**; the relay has no "list every community" call.

## 12. Observation: the real identity on this machine changed (not caused by this work)

When the app was restarted at the end of this task it resolved identity **`7e13d4f6…`** (system keyring), whereas the previous restarts resolved **`0f61e5e4…`**. The previous identity is **not lost**: it is archived in the Windows credential store as `identity_previous_0f61e5e4.swf-buzz`, which is what the "Import existing identity" replace flow does (archive first, never delete), and the `identity.keyring` marker was last written at 5:20 PM.

Why this was not me: every test launch in this and earlier tasks ran under the debug-only `SWF_BUZZ_PROFILE`, which uses separate keyring entries (`identity_nsec.<profile>`) and a separate folder — those were all deleted afterwards. Nothing I ran touches `identity_nsec.swf-buzz` or `identity_previous_*.swf-buzz`. A replacement in the real namespace requires the in-app "Import existing identity" flow plus its explicit confirmation tick, i.e. it was done in the app window that was open. I did not verify who did it.

Consequences: `7e13d4f6…` is not in the relay's `RELAY_OPERATOR_PUBKEYS` and is not owner of any community, so this identity lands on **Welcome** (join with invite), not on the Operator Dashboard. To get back to the earlier identity, import its NIP-49 backup (`swf-buzz-identity-0f61e5e4.ncryptsec` in Downloads, with its passphrase) through *Import existing identity* — that archives `7e13d4f6…` the same way. Alternatively add `7e13d4f6…` to the relay's operator list (a relay configuration change, needs a restart). No data was changed by me.

## 13. Status

**PHASE 2: COMPLETE**
**PHASE 2.1 OPERATOR HARDENING: COMPLETE**
**PHASE 3: READY**

Recommended next implementation step: **Phase 3, step 1 — "Open community → list channels"**: from the opened community (`/channels`), load the channel list for the signed-in identity over the existing NIP-42 connection, render the sidebar's channel list (public/private) per the Chat UI design spec, and open a channel with its message history read-only. Send, threads, reactions, unread and pagination follow in that order.
