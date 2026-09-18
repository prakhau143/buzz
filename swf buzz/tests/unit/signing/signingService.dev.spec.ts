import { describe, expect, it } from "vitest";
import { DevSigningService } from "@/features/signing/signingService.dev";

describe("DevSigningService", () => {
  it("produces a stable public key for the session", async () => {
    const service = new DevSigningService();
    const first = await service.getPublicKey();
    const second = await service.getPublicKey();
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("defaults to the same deterministic identity across separate instances", async () => {
    // See signingService.dev.ts's DEFAULT_DEV_SECRET_KEY_HEX doc comment —
    // this is intentional: it's what lets a role seeded once in
    // relay_members (docs/ROLE_PERMISSION_MATRIX.md §2) survive a dev-server
    // restart, which regenerates a fresh useAuth.ts module (and thus a
    // fresh DevSigningService instance) but must resolve the same identity.
    const a = new DevSigningService();
    const b = new DevSigningService();
    expect(await a.getPublicKey()).toBe(await b.getPublicKey());
  });

  it("produces a distinct identity per instance when seeded 'ephemeral'", async () => {
    const a = new DevSigningService("ephemeral");
    const b = new DevSigningService("ephemeral");
    expect(await a.getPublicKey()).not.toBe(await b.getPublicKey());
  });

  it("signs an event, producing a valid id/pubkey/sig", async () => {
    const service = new DevSigningService();
    const signed = await service.signEvent({ kind: 1, content: "hello", tags: [] });
    expect(signed.pubkey).toBe(await service.getPublicKey());
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.sig).toBeTruthy();
    expect(signed.created_at).toBeGreaterThan(0);
  });

  it("round-trips nip44 encrypt/decrypt between two distinct identities", async () => {
    const alice = new DevSigningService("ephemeral");
    const bob = new DevSigningService("ephemeral");
    const alicePubkey = await alice.getPublicKey();
    const bobPubkey = await bob.getPublicKey();

    const ciphertext = await alice.nip44Encrypt(bobPubkey, "secret payload");
    const plaintext = await bob.nip44Decrypt(alicePubkey, ciphertext);
    expect(plaintext).toBe("secret payload");
  });
});

describe("DevSigningService.forLocalIdentity", () => {
  it("derives the same pubkey for the same seed, across separate instances", async () => {
    const a = await DevSigningService.forLocalIdentity("okta-subject-abc123");
    const b = await DevSigningService.forLocalIdentity("okta-subject-abc123");
    expect(await a.getPublicKey()).toBe(await b.getPublicKey());
  });

  it("derives distinct, non-colliding pubkeys for different seeds", async () => {
    const a = await DevSigningService.forLocalIdentity("okta-subject-abc123");
    const b = await DevSigningService.forLocalIdentity("okta-subject-xyz789");
    expect(await a.getPublicKey()).not.toBe(await b.getPublicKey());
  });

  it("does not collide with the shared default dev identity", async () => {
    const derived = await DevSigningService.forLocalIdentity("okta-subject-abc123");
    const sharedDefault = new DevSigningService();
    expect(await derived.getPublicKey()).not.toBe(await sharedDefault.getPublicKey());
  });

  it("produces a service that can sign a valid event", async () => {
    const service = await DevSigningService.forLocalIdentity("okta-subject-abc123");
    const signed = await service.signEvent({ kind: 1, content: "hello", tags: [] });
    expect(signed.pubkey).toBe(await service.getPublicKey());
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/);
  });
});
