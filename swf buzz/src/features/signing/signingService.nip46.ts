import { generateSecretKey, verifyEvent } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { BunkerSigner, parseBunkerInput, type BunkerPointer } from "nostr-tools/nip46";
import { AbstractSimplePool } from "nostr-tools/abstract-pool";
import { invoke } from "@tauri-apps/api/core";
import type { SignedEvent, SigningService, UnsignedEvent } from "./types";
import { AppError } from "@/services/errors";

/**
 * Production signer: connects to a NIP-46 remote signer ("bunker"). The
 * local `clientSecretKey` here is an ephemeral TRANSPORT key used only to
 * encrypt the NIP-46 RPC channel to the bunker — it authorizes nothing by
 * itself and is never the user's Nostr identity key. See
 * docs/ARCHITECTURE.md §6 and docs/DECISIONS.md D2.
 *
 * A real bunker connection (D2) is a product/infra dependency that does not
 * exist yet anywhere in the Buzz stack — this class is wired and ready, but
 * `connectFromBunkerUri` must be called with a real `bunker://...` URI (or a
 * NIP-05 identifier) obtained through a pairing flow before it is usable.
 *
 * TIMEOUT NOTE: `nostr-tools`' own `BunkerSigner.sendRequest()` (used
 * internally by `connect()`/`getPublicKey()`/etc.) has NO timeout while
 * waiting for the remote signer's encrypted response event — only the
 * underlying relay connect (~3s) and publish-OK (~4.4s) steps are bounded.
 * If a relay accepts the publish but the remote signer never answers (it's
 * offline, unreachable, or the bunker URI is stale), that call hangs
 * forever. Confirmed by reading `node_modules/nostr-tools/lib/esm/nip46.js`
 * directly this session — not assumed. `withTimeout()` below wraps every
 * bunker RPC this app makes so the UI can never freeze indefinitely; never
 * modifies the library itself.
 */
const CONNECT_TIMEOUT_MS = 25_000;
const GET_PUBLIC_KEY_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError("auth_failed", timeoutMessage));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Extracts a safe, loggable hostname from a relay URL — never throws. */
function safeRelayHost(relayUrl: string): string {
  try {
    const withScheme = relayUrl.includes("://") ? relayUrl : `wss://${relayUrl}`;
    return new URL(withScheme).host;
  } catch {
    return "<unparseable-relay-url>";
  }
}

/**
 * Builds a relay pool wired to log per-relay connection outcomes using
 * `nostr-tools`' own public extension points (`onRelayConnectionSuccess`/
 * `onRelayConnectionFailure`) — never logs anything except the relay
 * hostname, never the bunker secret or any decrypted payload.
 *
 * Built on `AbstractSimplePool` directly (same class `SimplePool` extends,
 * with the same defaults it supplies) rather than `SimplePool` itself,
 * because `SimplePool`'s TypeScript constructor type only exposes
 * `enablePing`/`enableReconnect` even though its JS implementation forwards
 * every option — confirmed by reading `node_modules/nostr-tools/lib/esm/nip46.js`
 * and `pool.js` directly this session. This reaches the exact same runtime
 * behavior without a type-suppressing cast.
 */
function createDiagnosticPool(): AbstractSimplePool {
  return new AbstractSimplePool({
    verifyEvent,
    websocketImplementation: WebSocket,
    maxWaitForConnection: 3000,
    onRelayConnectionSuccess: (url: string) => {
      console.info(`[nostr] relay connected host=${safeRelayHost(url)}`);
    },
    onRelayConnectionFailure: (url: string) => {
      console.warn(`[nostr] relay failed host=${safeRelayHost(url)}`);
    },
  });
}

export class Nip46SigningService implements SigningService {
  readonly mode = "production" as const;
  private bunker: BunkerSigner | null = null;

  /** Loads a persisted transport key + bunker pointer from secure storage, if present. */
  async restore(): Promise<boolean> {
    const [secretHex, pointerJson] = await Promise.all([
      invoke<string | null>("secure_storage_get", { key: "nip46_transport_secret_key" }),
      invoke<string | null>("secure_storage_get", { key: "nip46_bunker_pointer" }),
    ]);
    if (!secretHex || !pointerJson) return false;

    const clientSecretKey = hexToBytes(secretHex);
    const bunkerPointer = JSON.parse(pointerJson) as BunkerPointer;
    this.bunker = BunkerSigner.fromBunker(clientSecretKey, bunkerPointer, {
      pool: createDiagnosticPool(),
    });
    console.info(
      `[nostr] restoring persisted bunker, relay_count=${bunkerPointer.relays.length}`,
    );
    await withTimeout(
      this.bunker.connect(),
      CONNECT_TIMEOUT_MS,
      "Unable to reconnect to your Nostr signer. Please verify that the signer is online.",
    );
    console.info("[nostr] signer initialization complete (restored)");
    return true;
  }

  /** Pairs with a bunker using a `bunker://...` URI or NIP-05 identifier, then persists the connection. */
  async connectFromBunkerUri(uriOrNip05: string): Promise<void> {
    const bunkerPointer = await parseBunkerInput(uriOrNip05);
    if (!bunkerPointer) {
      throw new AppError("auth_failed", "That bunker link doesn't look valid.");
    }
    console.info(
      "[nostr] bunker parsed",
      `remote_signer_pubkey=${bunkerPointer.pubkey.slice(0, 8)}...`,
      `relay_count=${bunkerPointer.relays.length}`,
      `relay_hosts=${bunkerPointer.relays.map(safeRelayHost).join(",")}`,
      `secret_present=${Boolean(bunkerPointer.secret)}`,
    );

    const clientSecretKey = generateSecretKey();
    this.bunker = BunkerSigner.fromBunker(clientSecretKey, bunkerPointer, {
      pool: createDiagnosticPool(),
    });

    console.info("[nostr] sending NIP-46 connect request");
    try {
      await withTimeout(
        this.bunker.connect(),
        CONNECT_TIMEOUT_MS,
        "Unable to connect to Nostr signer. Please verify that the signer is online and the bunker URL is valid.",
      );
    } catch (err) {
      this.bunker = null;
      throw err;
    }
    console.info("[nostr] signer connection acknowledged");

    await Promise.all([
      invoke("secure_storage_set", {
        key: "nip46_transport_secret_key",
        value: bytesToHex(clientSecretKey),
      }),
      invoke("secure_storage_set", {
        key: "nip46_bunker_pointer",
        value: JSON.stringify(bunkerPointer),
      }),
    ]);
  }

  async disconnect(): Promise<void> {
    await this.bunker?.close();
    this.bunker = null;
    await Promise.all([
      invoke("secure_storage_delete", { key: "nip46_transport_secret_key" }),
      invoke("secure_storage_delete", { key: "nip46_bunker_pointer" }),
    ]);
  }

  private requireBunker(): BunkerSigner {
    if (!this.bunker) {
      throw new AppError(
        "signing_failed",
        "No signer connected yet — pair with a bunker before signing.",
      );
    }
    return this.bunker;
  }

  async getPublicKey(): Promise<string> {
    console.info("[nostr] requesting public key");
    const pubkey = await withTimeout(
      this.requireBunker().getPublicKey(),
      GET_PUBLIC_KEY_TIMEOUT_MS,
      "Unable to reach your Nostr signer to retrieve its public key. Please verify that the signer is online.",
    );
    console.info("[nostr] public key received");
    return pubkey;
  }

  async signEvent(event: UnsignedEvent): Promise<SignedEvent> {
    const signed = await this.requireBunker().signEvent({
      kind: event.kind,
      content: event.content,
      tags: event.tags,
      created_at: event.created_at ?? Math.floor(Date.now() / 1000),
    });
    return signed;
  }

  async nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string> {
    return this.requireBunker().nip44Encrypt(recipientPubkey, plaintext);
  }

  async nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
    return this.requireBunker().nip44Decrypt(senderPubkey, ciphertext);
  }
}
