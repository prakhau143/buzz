import { vi } from "vitest";
import {
  clearActiveSigningService,
  setActiveSigningService,
} from "@/features/signing/signingServiceRegistry";
import type { SignedEvent, SigningService, UnsignedEvent } from "@/features/signing/types";

/** A pubkey that is deliberately NOT any owner/admin pubkey used in the tests. */
export const SIGNER_PUBKEY = "5".repeat(64);

export const signedEvents: SignedEvent[] = [];

/** Installs a signer that records every event it signs (no real crypto). */
export function installFakeSigner(pubkey = SIGNER_PUBKEY) {
  signedEvents.length = 0;
  const signer: SigningService = {
    mode: "production",
    getPublicKey: async () => pubkey,
    signEvent: vi.fn(async (event: UnsignedEvent) => {
      const signed = { ...event, id: "e".repeat(64), pubkey, sig: "s".repeat(128), created_at: event.created_at ?? 1 };
      signedEvents.push(signed);
      return signed;
    }),
    nip44Encrypt: async () => "",
    nip44Decrypt: async () => "",
  };
  setActiveSigningService(signer);
  return signer;
}

export function removeFakeSigner() {
  clearActiveSigningService();
  signedEvents.length = 0;
}

/** Decodes the `Authorization: Nostr <base64 event>` header the app builds. */
export function decodeNip98(header: string): SignedEvent {
  expectPrefix(header);
  return JSON.parse(atob(header.slice("Nostr ".length))) as SignedEvent;
}

function expectPrefix(header: string) {
  if (!header.startsWith("Nostr ")) throw new Error(`not a NIP-98 header: ${header.slice(0, 20)}`);
}

export const tagValue = (event: { tags: string[][] }, name: string) =>
  event.tags.find((tag) => tag[0] === name)?.[1];

/** JSON `Response` helper. */
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
