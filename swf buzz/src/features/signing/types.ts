/**
 * SigningService is the ONLY thing in this app allowed to produce a signed
 * Nostr event or perform NIP-44 encrypt/decrypt. No feature module, store,
 * or component may hold or touch a private key — see docs/SECURITY.md.
 *
 *   UI → application service → SigningService → NIP-46 bunker → remote signer
 *
 * `UnsignedEvent`/`SignedEvent` intentionally use a minimal shape here so this
 * file has no dependency on a specific Nostr library; the concrete
 * implementation adapts to/from whatever library it wraps (see
 * signingService.ndk.ts).
 */

export interface UnsignedEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at?: number;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
  created_at: number;
}

export type SigningMode = "production" | "development";

export interface SigningService {
  readonly mode: SigningMode;
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedEvent): Promise<SignedEvent>;
  nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string>;
}
