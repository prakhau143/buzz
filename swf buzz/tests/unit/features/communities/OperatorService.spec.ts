import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nip19 } from "nostr-tools";
import {
  OperatorError,
  normaliseCommunityHost,
  operatorOrigin,
  operatorService,
  parseOwnerPubkey,
  relayUrlForHost,
} from "@/features/communities/OperatorService";
import { sha256Hex } from "@/services/nip98";
import {
  decodeNip98,
  installFakeSigner,
  json,
  removeFakeSigner,
  SIGNER_PUBKEY,
  tagValue,
} from "../../helpers/fakeSigner";

const RELAY = "ws://localhost:3000";
const OWNER = "a".repeat(64); // someone else's public key
const NPUB = nip19.npubEncode(OWNER);

function lastRequest() {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, init, event: decodeNip98(headers.Authorization), body: init.body as string | undefined };
}

describe("owner pubkey / host parsing", () => {
  it("accepts hex (any case) and npub, and rejects everything else", () => {
    expect(parseOwnerPubkey(OWNER)).toBe(OWNER);
    expect(parseOwnerPubkey(OWNER.toUpperCase())).toBe(OWNER);
    expect(parseOwnerPubkey(`  ${OWNER}  `)).toBe(OWNER);
    expect(parseOwnerPubkey(NPUB)).toBe(OWNER);
    for (const bad of ["", "abc", "z".repeat(64), OWNER + "0", "npub1notvalid", "nsec1" + "q".repeat(58)]) {
      expect(parseOwnerPubkey(bad), bad).toBeNull();
    }
  });

  it("normalises a community address the way the relay expects (bare, lowercase authority)", () => {
    expect(normaliseCommunityHost("Acme.Example.COM")).toBe("acme.example.com");
    expect(normaliseCommunityHost("https://acme.example.com/")).toBe("acme.example.com");
    expect(normaliseCommunityHost("ws://acme.localhost:3000")).toBe("acme.localhost:3000");
    for (const bad of ["", "has space.com", "acme..com", "-acme.com", "acme.com/path", "acme.com?x=1", "user@acme.com", "a".repeat(300)]) {
      expect(normaliseCommunityHost(bad), bad).toBeNull();
    }
  });

  it("maps a host to the relay url with the right scheme", () => {
    expect(relayUrlForHost("acme.localhost:3000", "http://localhost:3000")).toBe("ws://acme.localhost:3000");
    expect(relayUrlForHost("acme.example.com", "https://ops.example.com")).toBe("wss://acme.example.com");
  });

  it("the operator origin defaults to the relay's http origin and can be overridden", () => {
    expect(operatorOrigin("ws://localhost:3000")).toBe("http://localhost:3000");
    expect(operatorOrigin("wss://relay.example.com/")).toBe("https://relay.example.com");
    vi.stubEnv("VITE_OPERATOR_API_ORIGIN", "https://ops.example.com/");
    expect(operatorOrigin("ws://localhost:3000")).toBe("https://ops.example.com");
    vi.unstubAllEnvs();
  });
});

describe("Operator probe — the RELAY decides", () => {
  beforeEach(() => {
    installFakeSigner();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    removeFakeSigner();
    vi.unstubAllGlobals();
  });

  it("is an operator only when the relay answers 200 to a NIP-98-signed probe", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ available: true, normalized_host: "operator-probe.invalid" }));
    await expect(operatorService.isOperator(RELAY)).resolves.toBe(true);

    const { url, event, init } = lastRequest();
    expect(url).toBe("http://localhost:3000/operator/communities/availability?host=operator-probe.invalid");
    expect(init.method).toBe("GET");
    expect(tagValue(event, "u")).toBe(url); // including the query string
    expect(tagValue(event, "payload")).toBeUndefined();
    expect(event.pubkey).toBe(SIGNER_PUBKEY);
  });

  it("a non-operator (403), a server without operator support (500) or a network failure → not an operator", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "actor not authorized: not a relay operator" }, 403));
    await expect(operatorService.isOperator(RELAY)).resolves.toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "operator API origin is not configured" }, 500));
    await expect(operatorService.isOperator(RELAY)).resolves.toBe(false);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(operatorService.isOperator(RELAY)).resolves.toBe(false);
  });

  it("without an identity it is simply 'no' (nothing sent)", async () => {
    removeFakeSigner();
    await expect(operatorService.isOperator(RELAY)).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("probeOperator returns the relay's status AND the pubkey that signed the probe — the evidence the sign-in path verifies", async () => {
    const { createPinia, setActivePinia } = await import("pinia");
    setActivePinia(createPinia());
    const { useDiagnosticsStore } = await import("@/stores/diagnostics");

    vi.mocked(fetch).mockResolvedValueOnce(json({ available: true }));
    const ok = await operatorService.probeOperator(RELAY, SIGNER_PUBKEY);
    expect(ok).toEqual({ status: 200, signerPubkey: SIGNER_PUBKEY, error: null, origin: "http://localhost:3000" });
    expect(useDiagnosticsStore().lastOperatorProbe).toMatchObject({ status: 200, signerPubkey: SIGNER_PUBKEY, forPubkey: SIGNER_PUBKEY });

    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "not a relay operator" }, 403));
    expect(await operatorService.probeOperator(RELAY)).toMatchObject({ status: 403, signerPubkey: SIGNER_PUBKEY, error: null });

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await operatorService.probeOperator(RELAY)).toMatchObject({ status: null, signerPubkey: SIGNER_PUBKEY, error: "network" });

    removeFakeSigner();
    expect(await operatorService.probeOperator(RELAY)).toMatchObject({ status: null, signerPubkey: null, error: "unauthenticated" });
  });
});

describe("Create community", () => {
  beforeEach(() => {
    installFakeSigner();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    removeFakeSigner();
    vi.unstubAllGlobals();
  });

  const created = (owner = OWNER) =>
    json({ community_id: "c-9", host: "acme.localhost:3000", status: "created", owner_pubkey: owner });

  it("POSTs create_only with the owner's public key, signed by the operator's own key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(created());

    const result = await operatorService.createCommunity(RELAY, { host: "Acme.localhost:3000", ownerPubkey: NPUB });

    const { url, body, event } = lastRequest();
    expect(url).toBe("http://localhost:3000/operator/communities");
    expect(JSON.parse(body as string)).toEqual({
      host: "acme.localhost:3000",
      initial_owner_pubkey: OWNER, // npub decoded to hex
      create_only: true,
    });
    expect(tagValue(event, "payload")).toBe(await sha256Hex(body as string));
    expect(tagValue(event, "u")).toBe(url);
    expect(result).toEqual({
      communityId: "c-9",
      host: "acme.localhost:3000",
      ownerPubkey: OWNER,
      relayUrl: "ws://acme.localhost:3000",
      connectLink: "swfbuzz://connect?relay=ws%3A%2F%2Facme.localhost%3A3000",
    });
  });

  it("SECURITY: naming an owner never signs anything as that owner — the request is signed by the operator's key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(created());
    await operatorService.createCommunity(RELAY, { host: "acme.localhost:3000", ownerPubkey: OWNER });
    const { event } = lastRequest();
    expect(event.pubkey).toBe(SIGNER_PUBKEY);
    expect(event.pubkey).not.toBe(OWNER);
    // …and the owner's key appears only as data in the body, never as an auth header.
    expect(Object.values(event.tags).flat()).not.toContain(OWNER);
  });

  it("the connect link grants nothing by itself — it carries no owner key or secret", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(created());
    const { connectLink } = await operatorService.createCommunity(RELAY, { host: "acme.localhost:3000", ownerPubkey: OWNER });
    expect(connectLink).not.toContain(OWNER);
    expect(connectLink).not.toContain("code=");
    expect(connectLink.startsWith("swfbuzz://connect?")).toBe(true);
  });

  it("refuses a bad host or owner before sending anything", async () => {
    await expect(
      operatorService.createCommunity(RELAY, { host: "not a host", ownerPubkey: OWNER }),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      operatorService.createCommunity(RELAY, { host: "acme.localhost:3000", ownerPubkey: "abc" }),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [403, { error: "actor not authorized: not a relay operator" }, "forbidden"],
    [409, { error: "community already exists" }, "exists"],
    [409, { error: "limit_reached: owner already owns the maximum number of communities" }, "limit"],
    [400, { error: "host is not normalized: expected \"x\"" }, "invalid"],
    [500, { error: "operator API origin is not configured" }, "not_enabled"],
    [401, { error: "NIP-98: replay detected" }, "unauthenticated"],
    [502, {}, "unknown"],
  ] as const)("relay %i %j → %s", async (status, body, kind) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body, status));
    const error = await operatorService
      .createCommunity(RELAY, { host: "acme.localhost:3000", ownerPubkey: OWNER })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OperatorError);
    expect((error as OperatorError).kind).toBe(kind);
  });

  it("network failure and missing identity are distinct, clear errors", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      operatorService.createCommunity(RELAY, { host: "acme.localhost:3000", ownerPubkey: OWNER }),
    ).rejects.toMatchObject({ kind: "network" });
    removeFakeSigner();
    await expect(
      operatorService.createCommunity(RELAY, { host: "acme.localhost:3000", ownerPubkey: OWNER }),
    ).rejects.toMatchObject({ kind: "unauthenticated" });
  });
});
