import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNip98AuthHeader, sha256Hex } from "@/services/nip98";
import { decodeNip98, installFakeSigner, removeFakeSigner, SIGNER_PUBKEY, tagValue } from "../helpers/fakeSigner";

describe("NIP-98 auth header", () => {
  beforeEach(() => installFakeSigner());
  afterEach(() => removeFakeSigner());

  it("signs a kind:27235 with the exact url, method and a fresh nonce", async () => {
    const event = decodeNip98(await buildNip98AuthHeader("http://localhost:3000/api/invites", "POST", "{}"));
    expect(event.kind).toBe(27235);
    expect(event.content).toBe("");
    expect(tagValue(event, "u")).toBe("http://localhost:3000/api/invites");
    expect(tagValue(event, "method")).toBe("POST");
    expect(tagValue(event, "nonce")).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.pubkey).toBe(SIGNER_PUBKEY);
  });

  it("adds the payload tag = sha256(body) for a POST body — the relay requires it", async () => {
    const body = JSON.stringify({ code: "v2.abc" });
    const event = decodeNip98(await buildNip98AuthHeader("http://x/api/invites/claim", "POST", body));
    expect(tagValue(event, "payload")).toBe(await sha256Hex(body));
    expect(tagValue(event, "payload")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("covers an empty-object body too (the payload tag is present whenever a body exists)", async () => {
    const event = decodeNip98(await buildNip98AuthHeader("http://x/api/invites", "POST", "{}"));
    expect(tagValue(event, "payload")).toBe(await sha256Hex("{}"));
  });

  it("a GET carries no payload tag (unchanged behaviour for moderation/admin reads)", async () => {
    const event = decodeNip98(await buildNip98AuthHeader("http://x/moderation/reports", "GET"));
    expect(tagValue(event, "payload")).toBeUndefined();
    expect(tagValue(event, "method")).toBe("GET");
    const defaulted = decodeNip98(await buildNip98AuthHeader("http://x/y"));
    expect(tagValue(defaulted, "method")).toBe("GET");
  });

  it("uses a different nonce every time (replay protection)", async () => {
    const a = decodeNip98(await buildNip98AuthHeader("http://x", "GET"));
    const b = decodeNip98(await buildNip98AuthHeader("http://x", "GET"));
    expect(tagValue(a, "nonce")).not.toBe(tagValue(b, "nonce"));
  });

  it("sha256Hex matches a known vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("cannot sign without an identity (no signer active)", async () => {
    removeFakeSigner();
    await expect(buildNip98AuthHeader("http://x", "GET")).rejects.toThrow();
  });
});
