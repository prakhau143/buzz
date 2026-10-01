# Connecting SWF Buzz to an existing Buzz community

SWF Buzz is a client for existing Buzz relays. A person who already uses a community from the
OLD BUZZ desktop app can use the **same community, with the same identity**, from SWF Buzz.
Nothing is migrated, copied, or created on the server.

## The flow

```text
1. Identity   Existing Nostr key (nsec1… or ncryptsec1… + password), imported once.
              Rust validates it, derives the public key, and stores the secret in the OS keyring
              (service "swf-buzz"). The webview never holds it after import. Signing happens in Rust.
2. Relay      The community address, e.g. wss://buzz.lmdconsulting.com, from a
              swfbuzz://connect?relay=… link, a recent community, or the URL field on
              "Choose a community" (shown after every sign-in and app start; the
              selected community is session state in sessionStorage, never re-opened
              on its own).
              It must be wss:// (ws:// only for localhost). Links are parsed and validated in
              Rust (src-tauri/src/deeplink.rs).
3. NIP-42     The relay sends ["AUTH", <challenge>]. SWF signs kind 22242
              {relay, challenge} with the identity and sends it (RelayConnectionService).
4. Membership The relay checks the authenticated pubkey against relay_members.
              A non-member gets OK false "restricted: not a relay member". SWF shows
              "not a member of this community" and never retries or adds the person.
5. Role       owner / admin / member, from the relay-signed kind 13534 roster (and the NIP-98
              POST /query membership probe). The operator plane (deployment) is separate.
6. Community  NIP-29 channel discovery (kind 39000/39001/39002).
7. Messages   Channel history = the relay's channel window: POST /query with top_level:true,
              include_aux:true (NIP-98), exactly as OLD BUZZ does. The live stream = WS REQ #h.
              DMs = kind 41010 find-or-create, then the same kind 9 message path.
```

## Relays used in validation (examples, not configuration)

| Relay | Identity `8e428c1c…555f954a` | Result (verified live, Phase 5) |
|---|---|---|
| `wss://buzz.lmdconsulting.com` | member | NIP-42 accepted · NIP-98 /query 200 · role **member** (29 members, 1 owner) · 9 channels · messages load |
| `wss://buzzdev.lmdconsulting.com` | not a member | NIP-42 processed, then `restricted: not a relay member` · /query 403 `relay_membership_required` · access denied, nothing mutated |

The default relay for a build is `VITE_RELAY_URL`. Other communities are kept in this device's
address book (`localStorage` `swf_relay_communities.v1`). It is a list of addresses only and
grants nothing.

## What the client never does

- Send a private key to a relay, an HTTP endpoint, a URL, or a log.
- Add a member, claim an invite, or change a role without an explicit user action. The relay
  enforces all of these anyway.
- Treat a relay address or a link as permission. Access always comes from the relay's answer to
  a signed request.
- Reuse a socket authenticated by a previous identity. Switching identity or community closes
  the socket and clears the session before the next NIP-42 handshake
  (`identitySession.ts` teardown).

## Leaving and switching

- **Switch community:** the picker (`/communities`) re-asks each known relay with a signed
  membership probe.
- **Leave community:** NIP-43 kind 28936 `[["-"]]`, identical to OLD BUZZ. The local address
  book is updated only after the relay accepts. Rejoining needs an invite.
- **Sign out** removes the key from this device (SWF shared-device policy). Keep an `ncryptsec`
  backup.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| "This identity isn't a member of this community yet" | NIP-42 worked; the relay's `relay_members` has no row for this pubkey. Ask an owner/admin to add the public key, or use an invite. |
| Import says "not a valid private key" | The pasted text is not a valid `nsec`/`ncryptsec`: a typo or missing character (the checksum catches it). `nostr:` prefixes, quotes, line breaks and invisible characters are removed automatically. |
| A public key (`npub…`, 64-hex) is refused | By design. A public key can't sign, so it can never log in. |
