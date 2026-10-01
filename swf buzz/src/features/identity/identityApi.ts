import { invoke } from "@tauri-apps/api/core";
import { AppError } from "@/services/errors";
import type { LocalIdentityInfo } from "@/features/signing/signingService.tauri";

/**
 * Identity operations beyond sign-in: import and NIP-49 backup. Every one of
 * these runs in Rust (`src-tauri/src/identity/`); this file only forwards user
 * input and returns public information.
 *
 * The one unavoidable exception to "the private key never enters the webview" is
 * what a user *types* into the import form (an nsec / hex key / backup password).
 * It is held in a local component ref only, handed to Rust, and cleared
 * immediately — never stored in Pinia, localStorage or logged.
 */

/** The backup passphrase minimum, enforced again in Rust. */
export const MIN_BACKUP_PASSPHRASE_LEN = 12;

export interface BackupVerification {
  pubkey: string;
  npub: string;
  matchesCurrentIdentity: boolean;
}

/** Rust returns user-safe plain-string errors (never key material). */
function rustError(err: unknown, fallback: string): AppError {
  return new AppError("auth_failed", typeof err === "string" && err ? err : fallback, err);
}

/**
 * Import an identity from an `nsec1…`, a 64-char hex key, or an `ncryptsec1…`
 * (with `password`). Rust refuses to replace a working identity.
 */
export async function importIdentity(
  input: string,
  password?: string,
  allowRawHex = false,
): Promise<LocalIdentityInfo> {
  try {
    return await invoke<LocalIdentityInfo>("import_identity", {
      input,
      password: password ? password : null,
      allowRawHex,
    });
  } catch (err) {
    throw rustError(err, "Couldn't import that identity.");
  }
}

/**
 * Replace the identity on this device with an imported one. Rust archives the old
 * private key first (never deletes it) and changes nothing if it can't.
 */
export async function replaceIdentity(
  input: string,
  password?: string,
  allowRawHex = false,
): Promise<LocalIdentityInfo> {
  try {
    return await invoke<LocalIdentityInfo>("replace_identity", {
      input,
      password: password ? password : null,
      allowRawHex,
    });
  } catch (err) {
    throw rustError(err, "Couldn't replace the identity.");
  }
}

/**
 * An `npub1…` is a PUBLIC key: it identifies, it never authenticates, and no
 * private key can be derived from it. Same wording as Rust's `backup::NPUB_REJECTED`.
 */
export const NPUB_REJECTED_MESSAGE =
  "This is a public identity key. A public key cannot be used to sign in. Import the matching nsec private key or ncryptsec encrypted backup.";

/**
 * Why a bare 64-character hex value is refused on the normal import path (same
 * wording as Rust's `backup::RAW_HEX_REJECTED`, which refuses it again).
 *
 * A private key is 64 hex characters — and so is a Nostr PUBLIC key. Nothing can
 * tell them apart by format, and guessing silently produced a wrong identity
 * twice on this project (docs/DEV_RESET_2026_09_22.md). The normal credential
 * contract is therefore nsec / ncryptsec only.
 */
export const RAW_HEX_REJECTED_MESSAGE =
  "Raw 64-character hex is ambiguous — a public key is the same length as a private key, so SWF Buzz cannot tell them apart. Import an nsec private key or an ncryptsec encrypted backup instead. (If you meant to paste a public key: public keys identify an identity, they can never sign in.)";

/** Which identity an import input would produce — public information, nothing stored. */
export interface IdentityPreview {
  pubkey: string;
  npub: string;
  /** The input was a bare 64-char hex value, indistinguishable in form from a PUBLIC key. */
  looksLikeBareHex: boolean;
}

/**
 * Resolve an import input to the identity it would actually produce, WITHOUT
 * storing anything, so the user can confirm it is the one they expect.
 *
 * This exists because of a real silent failure: a 64-character hex value is a
 * *private* key by definition, but a Nostr **public** key is also 64 hex
 * characters, so pasting a public key does not fail — it derives a different,
 * unrelated identity. (Observed on this project: pasting the operator's public
 * key `0f61e5e4…` produced identity `7e13d4f6…`, so sign-in landed on a member
 * view instead of the Operator dashboard.) Nothing can distinguish the two by
 * format; showing the resulting identity is the fix.
 */
export async function previewIdentityInput(
  input: string,
  password?: string,
  allowRawHex = false,
): Promise<IdentityPreview> {
  try {
    return await invoke<IdentityPreview>("preview_identity_input", {
      input,
      password: password ? password : null,
      allowRawHex,
    });
  } catch (err) {
    throw rustError(err, "Couldn't read that key.");
  }
}

/** What the user sees when Rust could not remove the identity — never a silent "signed out". */
export const IDENTITY_REMOVAL_FAILED_MESSAGE =
  "Couldn't remove this identity from this device. Please try again.";

/**
 * SWF shared-device sign-out: Rust removes the current identity (keyring /
 * `identity.key`, every archived copy this app made, metadata) and re-resolves;
 * it only resolves once nothing is left. Rejects — with Rust's reason — when
 * anything could not be removed, in which case the identity is still on the
 * device and the caller must say so.
 */
export async function deleteIdentity(): Promise<LocalIdentityInfo> {
  try {
    return await invoke<LocalIdentityInfo>("delete_identity");
  } catch (err) {
    throw rustError(err, IDENTITY_REMOVAL_FAILED_MESSAGE);
  }
}

/**
 * What the onboarding backup screen shows, returned ONCE by the call that
 * generated the key. `nsec` IS the private key: hold it in a component-local
 * value for that screen only, never in a store, and clear it on leaving
 * (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3c).
 */
export interface CreatedIdentityReveal {
  pubkey: string;
  npub: string;
  nsec: string;
  ncryptsec: string;
}

/**
 * Onboarding: generate the identity (only if none exists), encrypt it with the
 * chosen backup passphrase and return the one-time reveal. Rust refuses when an
 * identity already exists or the passphrase is too short, and changes nothing
 * in that case.
 */
export async function createIdentityWithBackup(password: string): Promise<CreatedIdentityReveal> {
  try {
    return await invoke<CreatedIdentityReveal>("create_identity_with_backup", { password });
  } catch (err) {
    throw rustError(err, "Couldn't create your identity. Please try again.");
  }
}

/** Encrypt the current identity with `password` (NIP-49) and return the `ncryptsec1…` blob. */
export async function createBackup(password: string): Promise<string> {
  try {
    return await invoke<string>("create_ncryptsec_backup", { password });
  } catch (err) {
    throw rustError(err, "Couldn't create the backup.");
  }
}

/** Save a backup blob to a new file in the Downloads folder; returns its path. */
export async function saveBackup(ncryptsec: string): Promise<string> {
  try {
    return await invoke<string>("save_ncryptsec_backup", { ncryptsec });
  } catch (err) {
    throw rustError(err, "Couldn't save the backup file.");
  }
}

/** Decrypt a backup in Rust and say which identity it belongs to (public info only). */
export async function verifyBackup(ncryptsec: string, password: string): Promise<BackupVerification> {
  try {
    return await invoke<BackupVerification>("verify_ncryptsec_backup", { ncryptsec, password });
  } catch (err) {
    throw rustError(err, "Couldn't check that backup.");
  }
}
