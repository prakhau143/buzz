import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InviteError,
  buildConnectLink,
  buildJoinLink,
  classifyInviteInput,
  inviteErrorFrom,
  normaliseRelayUrl,
  parseInviteInput,
  relayInviteService,
} from "@/features/communities/RelayInviteService";
import {
  decodeNip98,
  installFakeSigner,
  json,
  removeFakeSigner,
  SIGNER_PUBKEY,
  tagValue,
} from "../../helpers/fakeSigner";
import { sha256Hex } from "@/services/nip98";

const RELAY = "ws://localhost:3000";
const CODE = "v2." + "A".repeat(43);

function lastRequest() {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, init, headers, event: decodeNip98(headers.Authorization), body: init.body as string };
}

describe("relay invites — create", () => {
  beforeEach(() => {
    installFakeSigner();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    removeFakeSigner();
    vi.unstubAllGlobals();
  });

  it("POSTs /api/invites on the community host, NIP-98 signed with the payload hash", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ code: CODE, expires_at: 1_800_000_000, max_uses: 5, uses_remaining: 5, url: "http://localhost:3000/invite/x" }),
    );

    const invite = await relayInviteService.createInvite(RELAY, { ttlSecs: 3600, maxUses: 5 });

    const { url, init, event, body } = lastRequest();
    expect(url).toBe("http://localhost:3000/api/invites");
    expect(init.method).toBe("POST");
    expect(JSON.parse(body)).toEqual({ ttl_secs: 3600, max_uses: 5 });
    expect(tagValue(event, "u")).toBe(url); // the relay compares this to {scheme}://{host}{path}
    expect(tagValue(event, "method")).toBe("POST");
    expect(tagValue(event, "payload")).toBe(await sha256Hex(body));
    expect(event.pubkey).toBe(SIGNER_PUBKEY);
    expect(invite).toMatchObject({ code: CODE, expiresAt: 1_800_000_000, maxUses: 5, usesRemaining: 5 });
  });

  it("uses https for a wss relay, and keeps a non-default port in the signed url", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ code: CODE, expires_at: 1, max_uses: null, uses_remaining: null }));
    await relayInviteService.createInvite("wss://acme.example.com", {});
    expect(lastRequest().url).toBe("https://acme.example.com/api/invites");
    await relayInviteService.createInvite("ws://acme.localhost:3000", {});
    expect(tagValue(lastRequest().event, "u")).toBe("http://acme.localhost:3000/api/invites");
  });

  it("omits expiry and max uses when not given (relay defaults: 72 h, unlimited)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ code: CODE, expires_at: 1, max_uses: null, uses_remaining: null }));
    const invite = await relayInviteService.createInvite(RELAY);
    expect(JSON.parse(lastRequest().body)).toEqual({});
    expect(invite.maxUses).toBeNull();
    expect(invite.usesRemaining).toBeNull();
  });

  it("returns a swfbuzz:// link — never the relay's own buzz:// landing url", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ code: CODE, expires_at: 1, max_uses: null, uses_remaining: null, url: `http://localhost:3000/invite/${CODE}` }),
    );
    const { link } = await relayInviteService.createInvite(RELAY);
    expect(link).toBe(buildJoinLink(RELAY, CODE));
    expect(link.startsWith("swfbuzz://join/")).toBe(true); // swfbuzz://join/<code>?relay=…
    // `swfbuzz://` itself ends in "buzz://", so test the scheme boundary, not a substring.
    expect(link.startsWith("buzz://")).toBe(false);
    expect(link).not.toContain("localhost:3000/invite/"); // the relay's own landing-page url
    expect(link).not.toContain("/invite/");
    const url = new URL(link);
    expect(url.searchParams.get("relay")).toBe(RELAY);
    expect(url.pathname).toBe("/" + CODE); // the code is the path: swfbuzz://join/<code>
  });

  it("rejects out-of-range expiry and max uses before sending anything", async () => {
    for (const options of [
      { ttlSecs: 59 },
      { ttlSecs: 30 * 86_400 + 1 },
      { maxUses: 0 },
      { maxUses: 10_001 },
      { maxUses: 1.5 },
      { maxUses: -3 },
    ]) {
      await expect(relayInviteService.createInvite(RELAY, options)).rejects.toBeInstanceOf(InviteError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the boundary values (60 s, 30 d, 1 use, 10 000 uses)", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ code: CODE, expires_at: 1, max_uses: 1, uses_remaining: 1 }));
    for (const options of [{ ttlSecs: 60 }, { ttlSecs: 30 * 86_400 }, { maxUses: 1 }, { maxUses: 10_000 }]) {
      await expect(relayInviteService.createInvite(RELAY, options)).resolves.toBeTruthy();
    }
  });

  it("a member (not owner/admin) is refused by the relay with 403 → forbidden", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "only relay owners and admins can create invites" }, 403));
    await expect(relayInviteService.createInvite(RELAY)).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("cannot create without an identity (no signer) and never calls the network", async () => {
    removeFakeSigner();
    await expect(relayInviteService.createInvite(RELAY)).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an unreachable relay is a clear network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(relayInviteService.createInvite(RELAY)).rejects.toMatchObject({ kind: "network" });
  });
});

describe("relay invites — claim", () => {
  beforeEach(() => {
    installFakeSigner();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    removeFakeSigner();
    vi.unstubAllGlobals();
  });

  it("POSTs /api/invites/claim signed by the joining key, and reports role member", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ status: "joined", community_id: "c-1", host: "localhost:3000", role: "member" }),
    );

    const result = await relayInviteService.claimInvite(RELAY, CODE);

    const { url, event, body } = lastRequest();
    expect(url).toBe("http://localhost:3000/api/invites/claim");
    expect(JSON.parse(body)).toEqual({ code: CODE });
    expect(tagValue(event, "payload")).toBe(await sha256Hex(body));
    expect(event.pubkey, "the claim is signed by the local identity, not by anything the caller supplied").toBe(
      SIGNER_PUBKEY,
    );
    expect(result).toEqual({ status: "joined", communityId: "c-1", host: "localhost:3000", role: "member" });
  });

  it("no user id is ever sent — the body carries only the code", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "joined", community_id: "c", host: "h", role: "member" }));
    await relayInviteService.claimInvite(RELAY, CODE);
    expect(Object.keys(JSON.parse(lastRequest().body))).toEqual(["code"]);
  });

  it("already_member is a clean success (idempotent), not an error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ status: "already_member", community_id: "c-1", host: "localhost:3000", role: "member" }),
    );
    await expect(relayInviteService.claimInvite(RELAY, CODE)).resolves.toMatchObject({ status: "already_member" });
  });

  it("forwards a join-policy receipt only when given", async () => {
    vi.mocked(fetch).mockResolvedValue(json({ status: "joined", community_id: "c", host: "h", role: "member" }));
    await relayInviteService.claimInvite(RELAY, CODE, "receipt.abc");
    expect(JSON.parse(lastRequest().body)).toEqual({ code: CODE, policy_receipt: "receipt.abc" });
  });

  it.each([
    ["invite_invalid", 403, "invalid"],
    ["invite_expired", 403, "expired"],
    ["invite_exhausted", 403, "exhausted"],
    ["join_policy_required", 403, "policy_required"],
  ] as const)("relay error %s → kind %s with a clear message", async (relayError, status, kind) => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: relayError }, status));
    const error = await relayInviteService.claimInvite(RELAY, CODE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InviteError);
    expect((error as InviteError).kind).toBe(kind);
    expect((error as InviteError).message.length).toBeGreaterThan(10);
    expect((error as InviteError).message).not.toContain("invite_"); // raw relay codes never reach the UI
  });

  it("rate limiting (429) is reported as such", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "too many invite claim attempts, slow down" }, 429));
    await expect(relayInviteService.claimInvite(RELAY, CODE)).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("no identity: cannot claim, and nothing is sent", async () => {
    removeFakeSigner();
    await expect(relayInviteService.claimInvite(RELAY, CODE)).rejects.toMatchObject({ kind: "unauthenticated" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("inviteErrorFrom maps unknown statuses to a safe generic error", () => {
    expect(inviteErrorFrom(500, undefined).kind).toBe("unknown");
    expect(inviteErrorFrom(401, undefined).kind).toBe("unauthenticated");
    expect(inviteErrorFrom(403, "something_new").kind).toBe("forbidden");
  });
});

describe("invite / connect links", () => {
  it("builds swfbuzz://join/<code>?relay=… with optional, validated hints", () => {
    const by = "ab".repeat(32);
    const link = buildJoinLink("ws://acme.localhost:3000", CODE, { communityName: "SWF Developers", invitedBy: by });
    expect(link).toBe(
      `swfbuzz://join/${CODE}?relay=ws%3A%2F%2Facme.localhost%3A3000&name=SWF+Developers&by=${by}`,
    );
    expect(parseInviteInput(link, null)).toEqual({
      relay: "ws://acme.localhost:3000",
      code: CODE,
      communityName: "SWF Developers",
      invitedBy: by,
    });
    // a malformed inviter key is not written into the link at all
    expect(buildJoinLink("ws://a.localhost:3000", CODE, { invitedBy: "nothex" })).not.toContain("by=");
    // and one that arrives malformed in a pasted link is dropped, not trusted
    expect(parseInviteInput(`swfbuzz://join/${CODE}?relay=ws://a.localhost:3000&by=NOTHEX`, null)).toEqual({
      relay: "ws://a.localhost:3000",
      code: CODE,
    });
  });

  it("round-trips through the swfbuzz:// parser", () => {
    const link = buildJoinLink("ws://acme.localhost:3000", CODE);
    expect(parseInviteInput(link, null)).toEqual({ relay: "ws://acme.localhost:3000", code: CODE });
  });

  it("builds a connect link with the relay only", () => {
    const link = buildConnectLink("wss://acme.example.com");
    expect(link).toBe("swfbuzz://connect?relay=wss%3A%2F%2Facme.example.com");
    expect(link).not.toContain("code=");
  });
});

describe("parseInviteInput — what a person may paste", () => {
  it("accepts the query form, the path form, and a policy receipt", () => {
    expect(parseInviteInput(`swfbuzz://join?relay=ws://localhost:3000&code=${CODE}`, null)).toEqual({
      relay: "ws://localhost:3000",
      code: CODE,
    });
    expect(parseInviteInput(`swfbuzz://join/${CODE}?relay=ws://localhost:3000`, null)?.code).toBe(CODE);
    expect(parseInviteInput(`swfbuzz://join?relay=ws://localhost:3000&code=${CODE}&policy_receipt=r.1`, null)).toMatchObject({
      policyReceipt: "r.1",
    });
  });

  it("recovers relay + code from the relay's own /invite/<code> page URL", () => {
    expect(parseInviteInput(`http://localhost:3000/invite/${CODE}`, null)).toEqual({
      relay: "ws://localhost:3000",
      code: CODE,
    });
    expect(parseInviteInput(`https://acme.example.com/invite/${CODE}/`, null)).toEqual({
      relay: "wss://acme.example.com",
      code: CODE,
    });
  });

  it("takes a bare code only together with the community you are looking at", () => {
    expect(parseInviteInput(CODE, "ws://localhost:3000")).toEqual({ relay: "ws://localhost:3000", code: CODE });
    expect(parseInviteInput(CODE, null)).toBeNull();
  });

  it.each([
    "",
    "   ",
    "hello world",
    "swfbuzz://join?code=" + CODE, // no relay
    "swfbuzz://join?relay=ws://localhost:3000", // no code
    "swfbuzz://join?relay=http://localhost:3000&code=" + CODE, // not ws(s)
    "swfbuzz://join?relay=ws://u:p@localhost:3000&code=" + CODE,
    "swfbuzz://join?relay=ws://localhost:3000/x&code=" + CODE,
    "swfbuzz://steal?relay=ws://localhost:3000&code=" + CODE,
    "swfbuzz://join?relay=ws://localhost:3000&code=" + "a".repeat(300),
    "swfbuzz://join?relay=ws://localhost:3000&code=has space",
    "https://acme.example.com/other/path",
    "javascript:alert(1)",
    "buzz://join?relay=ws://localhost:3000&code=" + CODE, // the OLD Buzz scheme is not ours
  ])("rejects %j", (input) => {
    expect(parseInviteInput(input, "ws://localhost:3000")).toBeNull();
  });

  it("normaliseRelayUrl keeps only scheme+host+port", () => {
    expect(normaliseRelayUrl("ws://LOCALHOST:3000/")).toBe("ws://localhost:3000");
    expect(normaliseRelayUrl("wss://acme.example.com")).toBe("wss://acme.example.com");
    expect(normaliseRelayUrl("ws://localhost:3000?x=1")).toBeNull();
    expect(normaliseRelayUrl("nonsense")).toBeNull();
  });
});

/**
 * A connection link is an ADDRESS; a membership invite carries a secret code.
 * Pasting the first into "Join with invite" is the most likely wrong paste,
 * because that is the link an operator hands the owner at creation time.
 */
describe("classifyInviteInput — connection link vs membership invite", () => {
  const RELAY = "ws://localhost:3000";

  it("recognises a connection link as a connection link, not an invite", () => {
    const result = classifyInviteInput(buildConnectLink(RELAY), null);
    expect(result.kind).toBe("connection");
    if (result.kind !== "connection") throw new Error("unreachable");
    expect(result.relay).toBe(RELAY);
  });

  it("carries the community name from a connection link when present", () => {
    const result = classifyInviteInput(buildConnectLink(RELAY, { communityName: "kwikster" }), null);
    expect(result.kind).toBe("connection");
    if (result.kind !== "connection") throw new Error("unreachable");
    expect(result.communityName).toBe("kwikster");
  });

  it("still refuses to treat a connection link as an invite", () => {
    // The important half: recognising it must NOT make it claimable.
    expect(parseInviteInput(buildConnectLink(RELAY), RELAY)).toBeNull();
  });

  it("recognises a real invite link as an invite", () => {
    const result = classifyInviteInput(buildJoinLink(RELAY, CODE), null);
    expect(result.kind).toBe("invite");
    if (result.kind !== "invite") throw new Error("unreachable");
    expect(result.invite.code).toBe(CODE);
    expect(result.invite.relay).toBe(RELAY);
  });

  it("recognises a bare code as an invite against the current community", () => {
    expect(classifyInviteInput(CODE, RELAY).kind).toBe("invite");
  });

  it("reports anything that cannot be a code or a link as unrecognised", () => {
    for (const input of ["", "   ", "swfbuzz://connect", "ws://localhost:3000", "a b c"]) {
      expect(classifyInviteInput(input, RELAY).kind, input).toBe("unrecognised");
    }
  });

  it("treats a bare word as a candidate code — only the relay can say it is invalid", () => {
    // Pre-existing, deliberate: a code is an opaque secret, so the client
    // cannot distinguish a wrong one from a right one. The relay answers
    // `invite_invalid`, which maps to a proper user-facing error.
    expect(classifyInviteInput("hello", RELAY).kind).toBe("invite");
    // …but only when there is a community to claim against.
    expect(classifyInviteInput("hello", null).kind).toBe("unrecognised");
  });

  it("a connection link with no relay is unrecognised, not a connection", () => {
    expect(classifyInviteInput("swfbuzz://connect?relay=nonsense", RELAY).kind).toBe("unrecognised");
  });
});
