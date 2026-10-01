import { invoke } from "@tauri-apps/api/core";
import { AppError } from "@/services/errors";
import type { SignedEvent, SigningService, UnsignedEvent } from "./types";

/**
 * Public view of the local identity, as returned by the Rust identity module
 * (`src-tauri/src/identity/`). Deliberately contains **no secret material**:
 * the private key is generated, stored (OS keyring, service `swf-buzz`) and
 * used for signing entirely in Rust and never crosses the IPC boundary.
 */
export interface LocalIdentityInfo {
  /** Hex public key; `null` when no identity is loaded yet. */
  pubkey: string | null;
  /** Bech32 `npub1…` form of the same public key (safe to share). */
  npub?: string | null;
  storage: "none" | "system-keyring" | "local-file" | "environment";
  /**
   * Non-`none` means an identity may exist but could not be loaded, and
   * creating a new one is refused (so the user's real key is never orphaned).
   */
  recovery: "none" | "keyring-locked" | "lost" | "corrupt";
}

/** Rust returns plain-string errors written to be user-safe (no key material). */
function identityError(err: unknown, fallback: string): AppError {
  const message = typeof err === "string" && err.length > 0 ? err : fallback;
  return new AppError("auth_failed", message, err);
}

/** Current local identity state. Never generates a key. */
export async function getLocalIdentity(): Promise<LocalIdentityInfo> {
  try {
    return await invoke<LocalIdentityInfo>("get_identity");
  } catch (err) {
    throw identityError(err, "Couldn't read your identity.");
  }
}

/**
 * Asks Rust to generate the identity. Only succeeds when none exists and no
 * recovery state is active; otherwise it returns the existing identity or
 * rejects. Idempotent — it can never replace a key.
 */
export async function createLocalIdentity(): Promise<LocalIdentityInfo> {
  try {
    return await invoke<LocalIdentityInfo>("create_identity");
  } catch (err) {
    throw identityError(err, "Couldn't create your identity.");
  }
}

/**
 * Production signer for the OLD-BUZZ-style identity: every operation is a
 * Tauri command, so the webview only ever sees public keys and signed events.
 *
 * Implements the existing {@link SigningService} contract unchanged, so the
 * whole Nostr feature stack (`getActiveSigningService()`) is agnostic to it.
 */
export class TauriSigningService implements SigningService {
  readonly mode = "production" as const;

  async getPublicKey(): Promise<string> {
    const info = await getLocalIdentity();
    if (!info.pubkey) {
      throw new AppError("auth_required", "No identity is available yet — create one first.");
    }
    return info.pubkey;
  }

  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    try {
      return await invoke<SignedEvent>("sign_event", {
        kind: event.kind,
        content: event.content,
        createdAt: event.created_at ?? null,
        tags: event.tags,
      });
    } catch (err) {
      throw new AppError("signing_failed", "Couldn't sign that action. Please try again.", err);
    }
  }

  // NIP-44 needs the secret key, so it runs in Rust like `sign_event` — the key
  // never reaches the webview. Required by NIP-RS read state (kind:30078), whose
  // content is sealed to the author's own keypair.
  async nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string> {
    try {
      return await invoke<string>("nip44_encrypt", { recipientPubkey, plaintext });
    } catch (err) {
      throw new AppError("signing_failed", "Couldn't encrypt that payload.", err);
    }
  }

  // A decrypt failure is routine, not exceptional: a `kind:30078` from another
  // application shares the kind number and is not ours to read. Callers treat
  // the rejection as "not mine" rather than surfacing it.
  async nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
    try {
      return await invoke<string>("nip44_decrypt", { senderPubkey, ciphertext });
    } catch (err) {
      throw new AppError("signing_failed", "Couldn't decrypt that payload.", err);
    }
  }
}
