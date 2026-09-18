# SWF Buzz — Security

## No raw private keys, ever

SWF Buzz never generates, stores, transmits, logs, or renders a raw Nostr private key. Concretely:

- No feature module, Pinia store, composable, or Vue component may import or hold a private key.
- The only place a private key concept exists at all is inside `SigningService` implementations
  (`src/features/signing/`), and even there:
  - **`Nip46SigningService`** (production) never touches the account's actual Nostr identity key.
    It holds an ephemeral _transport_ keypair (`BunkerSigner`'s `clientSecretKey`), generated
    locally and persisted only via Tauri secure storage (`secure_storage_set`, see
    `src-tauri/src/storage/secure_store.rs`). That transport key encrypts the NIP-46 RPC channel
    to the bunker; it authorizes nothing by itself — the bunker holds the real signing key and
    performs the actual `sign_event`/`nip44_encrypt`/`nip44_decrypt` operations remotely.
  - **`DevSigningService`** (development-only) generates an ephemeral in-memory keypair per app
    session. It is never persisted to disk, never synced, and is discarded when the app closes.
- `UI → application service → SigningService → NIP-46 bunker → remote signer` is the only signing
  path. There is no `UI → private key` path anywhere in this codebase.

## Development Mode is not production auth

`DevAuthService` + `DevSigningService` exist so the UI is exercisable before real Okta/NIP-46
bunker infrastructure exists (see `docs/DECISIONS.md` D2). Rules:

- The "Continue in Development Mode" button only renders when `import.meta.env.DEV` is true
  (`src/views/LoginView.vue`) — it is compiled out of production builds entirely, not just hidden.
- `DevSigningService` throws if `useDevSigningService()`-style access were attempted outside a dev
  build (defense in depth, even though the UI entry point is already gated).
- Development Mode must never be presented to, or mistaken by, a user as a real signed-in identity.
  Any log, error message, or UI copy referencing it must say "Development Mode" explicitly.

## Okta authentication — implemented, with one known gap

`src-tauri/src/auth/oidc.rs` runs the real Authorization Code + PKCE flow: system-browser launch,
a `127.0.0.1:0` loopback listener bound before the browser opens (so the exact redirect URI is
known), a random `state` value checked on the callback, and a PKCE `S256` challenge/verifier —
the client never handles a client secret (PKCE exists specifically so a public desktop client
doesn't need one).

**Known gap, tracked in `docs/DECISIONS.md` D9**: the returned ID token's signature is decoded for
its payload (subject/email, for display) but **not verified** against Okta's JWKS. This must be
fixed (fetch `{issuer}/v1/keys`, verify RS256) before this flow is used against real production
employee identities — PKCE + `state` + a loopback-only redirect mitigate most realistic attacks for
a local desktop flow, but skipping signature verification is still a real gap versus a fully
spec-compliant OIDC relying party. This is stated plainly here rather than left for someone to
discover later.

## Secure storage

- Rust (`src-tauri/src/storage/secure_store.rs`, exposed via `src-tauri/src/commands/secure_storage.rs`)
  is the only layer allowed to persist session material to disk, via the OS keychain/credential
  store (never a plaintext file).
- What is stored: the NIP-46 transport secret key and bunker pointer (see above) — never the
  account's real signing key, since the client never receives it in the first place.
- Tauri commands are narrowly scoped (`secure_storage_get`/`set`/`delete`, keyed by string) — no
  generic filesystem read/write command exists.

## IPC security

- `tauri.conf.json` / `src-tauri/capabilities/default.json` grant only the specific capabilities
  the app's narrow command set needs — no blanket `fs`, `shell`, or `http` permission.
- No Tauri command accepts an arbitrary command string, file path, or shell invocation
  (`execute_anything`/`run_shell_command`/`read_any_file` patterns are explicitly disallowed —
  see `docs/ARCHITECTURE.md` §5).
- Every Tauri command's input is a typed struct on the Rust side; there is no raw JSON passthrough.

## Logging rules

- `src/services/errors.ts` is the single normalization boundary for errors shown to the user.
  Raw Rust/Tauri error strings and relay protocol errors are converted to a small
  `AppErrorCode` → user-facing-message map before ever reaching the UI.
- `logError()` (developer-facing console diagnostics) may include the `AppError` code, message,
  and `cause`, but must never be passed a private key, a NIP-46 transport secret, a bunker URI
  containing a secret component, or an Okta token. When adding new error paths, check what
  `cause` actually contains before logging it.
- Do not `console.log` a `SignedEvent`'s surrounding request context if it could carry secrets in
  transit (it shouldn't, by construction — `UnsignedEvent`/`SignedEvent` never carry key material —
  but this is called out explicitly because it's the kind of thing that's easy to add carelessly
  later, e.g. while debugging a signing failure).

## Secrets handling / environment configuration

- `.env.example` lists every environment variable this app reads; it contains only placeholders.
  Real values go in `.env.local` (git-ignored via `*.local` in `.gitignore`) — never in source,
  never in a committed `.env` file.
- No secret is ever compiled into the frontend bundle. `VITE_OKTA_CLIENT_ID`/`SWF_BUZZ_OKTA_CLIENT_ID`
  are a public OAuth client identifier (not a secret) per the Authorization Code + PKCE flow's
  design — PKCE exists specifically so a public client needs no client secret.
- `SWF_BUZZ_OKTA_*` (read by Rust directly via `std::env::var`, not by Vite) must be real exported
  shell environment variables, not just written into `.env.local` — see `.env.example`.

## Open security questions (see `docs/DECISIONS.md` for full context)

- Which NIP-46 bunker implementation SWF Buzz targets, and how an Okta identity selects a specific
  bunker/Nostr identity (D2, D3) — infrastructure that does not exist yet in the Buzz stack.
- Whether `kind:41010` DMs (plaintext to the relay operator, same trust model as channel messages)
  are an acceptable default for all intended DM use cases, or whether NIP-17 gift-wrap-level
  privacy is needed for some conversations (D1.G).
- Whether SWF Buzz needs a Windows code-signing certificate before distribution (D7) — no signing
  step exists anywhere in the reference repo's CI today.
- ID token signature verification for the Okta flow is not yet implemented (D9) — must be added
  before this is used against real production employee identities.
