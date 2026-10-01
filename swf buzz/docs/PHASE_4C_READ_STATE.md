# Phase 4C — read state (NIP-RS, `kind:30078`)

Read state moves from a localStorage-only convenience to the **relay-hosted**
NIP-RS frontier that OLD BUZZ implements. Source of truth for every rule here is
`../buzz/docs/nips/NIP-RS.md` and `crates/buzz-core/src/kind.rs:71-75`, read
directly rather than inferred from the desktop client — where the two differ,
this notes it.

Search and Inbox are the remaining two thirds of 4C and are **not** in this
document; they are not implemented yet.

## 1. What the relay does and does not do

The relay **hosts** read state; it never **interprets** it. Content is NIP-44
sealed to the author's own keypair and stored structurally as an addressable
(NIP-33) event. There is no relay-computed read receipt — the unread verdict is
always the client's.

What that buys over the previous store is **convergence**: the same account on a
second device, or after a reinstall, starts from the real read position instead
of "everything is unread". That, not privacy, is the reason to do this.

## 2. The blocker that had to be removed first

NIP-RS requires NIP-44. The production Tauri signer did not implement it —
`nip44Encrypt`/`nip44Decrypt` both threw
("Encrypted messages aren't supported by the local signer yet"), a deliberate
phase-1 deferral. Read state was therefore impossible in production regardless
of any frontend work.

Fixed the architecture-consistent way, mirroring `sign_event`: the key stays in
Rust and the webview calls a command.

| Added | Where |
|---|---|
| `nip44` crate feature | `src-tauri/Cargo.toml` |
| `signing::nip44_encrypt` / `nip44_decrypt` | `src-tauri/src/identity/signing.rs` |
| `nip44_encrypt` / `nip44_decrypt` commands | `src-tauri/src/identity/commands.rs`, registered in `lib.rs` |
| real implementations replacing the throwing stubs | `src/features/signing/signingService.tauri.ts` |

Two deliberate properties of the Rust side:

- **The egress guard applies to the plaintext.** `ensure_no_key_material` runs
  before sealing, because a NIP-44 payload is published like any other content
  and a ciphertext cannot be scanned after the fact. A sealed `nsec` is still an
  exfiltrated `nsec`.
- **Decrypt failures never echo the payload.** A failure is routine (a foreign
  `kind:30078` — NIP-78 shares the kind), so the error is the constant
  `"decrypt failed"` rather than attacker-supplied bytes in a log or UI string.

## 3. Wire format as implemented

```
kind    30078
tags    ["d", "read-state:<32 lowercase hex>"]
        ["t", "read-state"]            exactly one of each
content NIP-44 seal of {"v":1,"client_id":"…","contexts":{"<ctx>":<unix-ts>}}
```

Context identifiers use Buzz's own shapes, which the spec names at NIP-RS.md:130:
a **channel UUID**, `thread:<hex64>`, `msg:<hex64>`.

**One place the spec and the OLD BUZZ desktop client disagree**, and we followed
the spec: the desktop client's `isValidReadStateDTag` accepts a 1–64 character
ASCII slot id, while NIP-RS.md:55 and :68 require *exactly* 32 lowercase hex and
say non-conforming events MUST be ignored. The fixed shape is what lets a relay
recognise a read-state coordinate without decrypting it and apply per-coordinate
protections; a looser id silently forfeits them. `readState.spec.ts` pins the
strict rule.

## 4. Merge rule, and why "mark unread" is local-only

The merge is **grow-only**: per context, the newest marker wins. It is therefore
commutative and convergent across devices, which is the whole point.

The direct consequence is that a manual **"mark unread" is a rewind and cannot
be expressed in the frontier at all** — publishing a lower value is a no-op on
every peer, and our own next hydrate would restore the higher mark and undo it.
NIP-RS adds the `ov_*` manual-unread override layer for exactly this case.

**We have not implemented `ov_*`.** So `markUnreadFrom` stays on the device that
performed it, by design and documented in the code, rather than appearing to
sync and silently not doing so. Implementing the override layer is the honest
way to make mark-unread cross-device, and it is a self-contained follow-up.

Reserved-prefix escaping **is** implemented even though the override layer is
not: a raw context ID beginning `ov_` or `esc:` is escaped on publish and
unescaped once on receive. Without that, a future override-aware client reading
our blob would mis-parse such a key as an override counter. Received `ov_*`
groups are dropped rather than interpreted, which preserves the corresponding
frontier entry — the conservative reading of the spec's group-validation rule.

## 5. Lifecycle

| Moment | Behaviour |
|---|---|
| Sign-in (`beginIdentitySession`, after READY) | `hydrateFromRelay()` — **not awaited**. Local state already rendered from localStorage and the merge only ever advances it, so a slow or unreachable relay delays nothing visible. |
| Channel marked seen | Publishes **only if the frontier advanced**, or a previous publish failed. Re-opening an already-read channel costs no round trip. |
| Publish fails | Silent. `publishPending` makes the next change retry. Read state is a convenience; a toast per relay blip would be worse than the missed sync. |
| Identity removed from device | `forgetReadStateIdentifiers` clears the local slot/client ids. Without the key their blobs can no longer be decrypted or rewritten, and leaving them would hand the next person on a shared machine a coordinate naming the previous identity. |

Hydration is guarded against a late result: if the identity changed while the
fetch was in flight the result is discarded, so one identity's read state can
never be applied under another's.

## 6. Scope — implemented vs. deliberately not

**Implemented:** single primary coordinate; fetch-and-merge across *all* of the
identity's own coordinates (so a second device's frontier is picked up); full
blob validation per spec; escaping; grow-only merge; publish-on-advance;
hydrate-on-sign-in; identity-scoped local ids.

**Not implemented, and why:**

| Not done | Reason |
|---|---|
| `ov_*` manual-unread override layer | Self-contained optional layer; its absence is visible only as mark-unread being device-local, which is documented rather than faked. |
| Multi-slot splitting (`READ_STATE_MAX_SLOTS`) | Only needed past ~32 KB of contexts (~650+ channels). We *read* every coordinate, so a device that does split is still merged correctly; we simply never split when publishing. |
| `client_id` conflict detection and rotation | Requires the override layer's coordinate-ownership semantics to be meaningful. |
| Thread/message-level read contexts (`thread:` / `msg:`) | Key builders and validators exist and are tested, but nothing writes them yet — channel-level frontier only. Wiring them is the natural follow-up when thread unread lands. |

## 7. Tests

| File | Covers |
|---|---|
| `src-tauri/src/identity/signing.rs` (5 new) | self-encryption round trip, non-deterministic ciphertext, key-material refusal, foreign/malformed payload rejection without echoing, invalid pubkey |
| `tests/unit/protocol/readState.spec.ts` (28) | d/t tag rules, 32-hex slot id, context shapes, escape bijection, every documented validation rule, merge rule incl. grow-only and commutativity |
| `tests/unit/features/readStateSync.spec.ts` (19) | filter shape, multi-coordinate merge, foreign kind:30078 ignored, structural filter runs *before* decrypt, sealed publish, stable slot id, hydration merge/no-rewind/badge-clear/offline/identity-change race, publish-on-advance, retry, mark-unread stays local |

The structural-filter test asserts `nip44Decrypt` is called exactly once for
three events — i.e. that malformed events are rejected *before* the costly
decrypt, not after.

## 8. Known limitations

1. **Mark-unread is device-local** (§4). Needs the `ov_*` layer.
2. **No real-relay E2E yet for read state.** The unit suite proves the merge,
   validation and publish shapes; it does not prove a real relay accepts
   `kind:30078` with these tags and returns it to a second identity. That E2E
   belongs with the rest of 4C.
3. **Channel-level only** — thread and message contexts are defined and tested
   but unwritten (§6).
4. Publishing is immediate on advance rather than debounced. OLD BUZZ debounces
   at 5 s (`readStateManager.ts:31`). Ours is bounded by "only when the frontier
   moved", so an idle channel is free, but a fast scroll through many channels
   will publish more often than the reference client.
