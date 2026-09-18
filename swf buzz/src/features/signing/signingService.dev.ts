import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { hexToBytes } from "nostr-tools/utils";
import { nip44 } from "nostr-tools";
import type { SignedEvent, SigningService, UnsignedEvent } from "./types";

/**
 * A fixed, publicly-known, dev-only test private key (the smallest valid
 * secp256k1 scalar) — deliberately NOT random. This is never a secret and
 * must never be treated as one; its only purpose is a stable, reproducible
 * pubkey across dev-server restarts, so a role seeded for it once in
 * `relay_members` (see docs/ROLE_PERMISSION_MATRIX.md §2) stays valid
 * instead of needing to be re-seeded every session. Passing an explicit
 * seed (see `DevSigningService`'s constructor) opts out of this shared
 * default in favor of a caller-chosen deterministic identity instead.
 */
const DEFAULT_DEV_SECRET_KEY_HEX = "00".repeat(31) + "01";

/**
 * DEVELOPMENT-ONLY signer. Deterministic by default (see above) — never a
 * real secret, never a stand-in for a real account. This exists purely so
 * the UI is exercisable before a real NIP-46 bunker is available (see
 * docs/DECISIONS.md D2). Must never be reachable in a production build —
 * see docs/SECURITY.md for the guard.
 */
export class DevSigningService implements SigningService {
  readonly mode = "development" as const;
  private readonly secretKey: Uint8Array;

  /**
   * Pass `"ephemeral"` to opt back into a fresh random keypair per instance
   * (the original behavior) instead of the shared deterministic default.
   * Pass a raw 32-byte key directly (see `forLocalIdentity` below) for a
   * seed deterministic by something OTHER than "the shared dev default."
   */
  constructor(seed: "default" | "ephemeral" | Uint8Array = "default") {
    if (seed instanceof Uint8Array) {
      this.secretKey = seed;
    } else {
      this.secretKey = seed === "ephemeral" ? generateSecretKey() : hexToBytes(DEFAULT_DEV_SECRET_KEY_HEX);
    }
  }

  /**
   * Derives a deterministic, per-identity local keypair from an arbitrary
   * stable string (an Okta `subject`, in practice) — SHA-256 of a
   * namespaced string, used directly as the secp256k1 secret key. The same
   * input always yields the same keypair; different inputs yield
   * (practically certainly) different, non-colliding keypairs — unlike the
   * single shared `DEFAULT_DEV_SECRET_KEY_HEX`, this must never be reused
   * across two different real identities. See `useAuth.ts`'s
   * `resolveLocalIdentitySigningService` for why this exists: local-only
   * testing needs a real Nostr identity without a NIP-46 bunker, per-Okta-user,
   * not the literal same key for everyone.
   */
  static async forLocalIdentity(stableSeed: string): Promise<DevSigningService> {
    const data = new TextEncoder().encode(`swf-buzz-local-dev-identity:${stableSeed}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return new DevSigningService(new Uint8Array(digest));
  }

  async getPublicKey(): Promise<string> {
    return getPublicKey(this.secretKey);
  }

  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    const finalized = finalizeEvent(
      {
        kind: event.kind,
        content: event.content,
        tags: event.tags,
        created_at: event.created_at ?? Math.floor(Date.now() / 1000),
      },
      this.secretKey,
    );
    return finalized;
  }

  async nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string> {
    const key = nip44.v2.utils.getConversationKey(this.secretKey, recipientPubkey);
    return nip44.v2.encrypt(plaintext, key);
  }

  async nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
    const key = nip44.v2.utils.getConversationKey(this.secretKey, senderPubkey);
    return nip44.v2.decrypt(ciphertext, key);
  }
}
