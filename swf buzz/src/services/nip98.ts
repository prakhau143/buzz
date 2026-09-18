/**
 * NIP-98 HTTP Auth — signs (but never publishes) a kind:27235 event to
 * authenticate a single HTTP request. Used for community moderation reads
 * (`/moderation/*`) and, later, the deployment admin console (`/api/admin/v1/*`).
 * Verified against ../buzz/desktop/src/shared/api/moderation.ts:222-234.
 */
import { getActiveSigningService } from "@/features/signing/signingServiceRegistry";

const NIP98_KIND = 27235;

export async function buildNip98AuthHeader(url: string, method = "GET"): Promise<string> {
  const signer = getActiveSigningService();
  const signed = await signer.signEvent({
    kind: NIP98_KIND,
    content: "",
    tags: [
      ["u", url],
      ["method", method],
      ["nonce", crypto.randomUUID()],
    ],
  });
  // NIP-98 events carry empty content and ASCII-only tags, so btoa is safe here.
  return `Nostr ${btoa(JSON.stringify(signed))}`;
}
