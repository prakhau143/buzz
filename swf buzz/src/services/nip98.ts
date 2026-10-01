/**
 * NIP-98 HTTP Auth — signs (but never publishes) a kind:27235 event to
 * authenticate a single HTTP request. Used for community moderation reads
 * (`/moderation/*`), the deployment admin console (`/api/admin/v1/*`), relay
 * invites (`/api/invites`, `/api/invites/claim`) and operator community
 * provisioning (`/operator/communities`).
 * Verified against ../buzz/desktop/src/shared/api/invites.ts:47-62 and
 * crates/buzz-relay/src/api/invites.rs (`require_payload: true` for POSTs).
 *
 * The signature is made by the active signing service — for the local identity
 * that is Rust, so the private key never reaches this code.
 */
import { getActiveSigningService } from "@/features/signing/signingServiceRegistry";

const NIP98_KIND = 27235;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * `Authorization` header value for one request.
 *
 * - `url` must be the exact request URL: the relay compares the `u` tag with
 *   `{http|https}://{tenant host}{path}` (or, for operator routes, its configured
 *   operator origin), including any query string.
 * - `body` is the exact request body string for a POST. The relay *requires* a
 *   `payload` tag (sha256 of the body) on signed POSTs; a GET passes no body and
 *   gets no payload tag.
 */
export async function buildNip98AuthHeader(
  url: string,
  method = "GET",
  body?: string,
): Promise<string> {
  return (await buildNip98Auth(url, method, body)).header;
}

export interface Nip98Auth {
  header: string;
  /** The pubkey on the SIGNED kind:27235 event — i.e. who actually signed this request. */
  signerPubkey: string;
}

/**
 * Same as `buildNip98AuthHeader`, but also returns the pubkey the signed event
 * carries. Callers that establish or verify a session use it to check that the
 * active signer really is the identity being signed in (an identity/signer
 * mismatch must surface as an error, never as a silent "not an operator").
 */
export async function buildNip98Auth(url: string, method = "GET", body?: string): Promise<Nip98Auth> {
  const signer = getActiveSigningService();
  const tags: string[][] = [
    ["u", url],
    ["method", method],
  ];
  if (body !== undefined) tags.push(["payload", await sha256Hex(body)]);
  tags.push(["nonce", crypto.randomUUID()]);

  const signed = await signer.signEvent({ kind: NIP98_KIND, content: "", tags });
  // NIP-98 events carry empty content and ASCII-only tags, so btoa is safe here.
  return { header: `Nostr ${btoa(JSON.stringify(signed))}`, signerPubkey: signed.pubkey };
}
