import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  candidateRelays,
  discoverMemberships,
  probeMembership,
} from "@/features/access/communityDiscovery";
import {
  addCommunity,
  clearCommunitiesForTests,
  communities,
} from "@/features/communities/relayCommunities";
import { decodeNip98, installFakeSigner, json, removeFakeSigner } from "../helpers/fakeSigner";

const ME = "5".repeat(64);
const OTHER = "ab".repeat(32);
const ACME = "ws://acme.localhost:3000";

/** A kind:13534 roster snapshot, as the relay publishes it. */
const roster = (...members: [string, string][]) => ({
  id: "r".repeat(64),
  pubkey: "0".repeat(64),
  kind: 13534,
  created_at: 100,
  content: "",
  tags: members.map(([pk, role]) => ["member", pk, role]),
  sig: "s".repeat(128),
});

beforeEach(() => {
  localStorage.clear();
  clearCommunitiesForTests();
  installFakeSigner(ME);
  vi.unstubAllGlobals();
});
afterEach(() => removeFakeSigner());

describe("probeMembership — the relay answers 'is this identity a member?'", () => {
  it("MEMBER: 200 with the roster → the role from the roster", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([roster([OTHER, "owner"], [ME, "admin"])])));
    expect(await probeMembership(ACME, ME)).toEqual({ status: "member", role: "admin" });
  });

  it("OWNER is read from the roster too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([roster([ME, "owner"])])));
    expect(await probeMembership(ACME, ME)).toEqual({ status: "member", role: "owner" });
  });

  /**
   * REGRESSION: this used to return `role: "member"` for an unresolved role.
   * The relay publishes a kind:13534 roster only after a community's first
   * membership change, so on a freshly provisioned community that fallback
   * labelled the actual OWNER "member" — the exact symptom we spent a session
   * chasing. An unknown role must stay unknown; the authoritative role is
   * resolved per community by identitySession.ts after NIP-42.
   */
  it("an open relay (200, no roster) means allowed in with an UNRESOLVED role, not 'member'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));
    expect(await probeMembership(ACME, ME)).toEqual({ status: "member", role: null });
  });

  it("a roster that does not name this identity also leaves the role unresolved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([roster([OTHER, "owner"])])));
    expect(await probeMembership(ACME, ME)).toEqual({ status: "member", role: null });
  });

  it("an unresolved role is never reported as any concrete role", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));
    const outcome = await probeMembership(ACME, ME);
    expect(outcome.status).toBe("member");
    const role = (outcome as { role: string | null }).role;
    expect(role).not.toBe("member");
    expect(role).not.toBe("admin");
    expect(role).not.toBe("owner");
    expect(role).toBeNull();
  });

  it("NON-MEMBER: 401/403 mean the community exists but refuses this identity", async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal("fetch", vi.fn(async () => json({ error: "restricted" }, status)));
      expect(await probeMembership(ACME, ME), String(status)).toEqual({ status: "not_member" });
    }
  });

  /**
   * 404 is different from 403: the relay answers 404 to an unknown Host (so
   * communities cannot be enumerated), which means this address-book entry is
   * stale — the community was deleted or never existed here. Reported as
   * "gone" so `discoverMemberships` can forget it instead of re-probing it on
   * every sign-in (which is what produced a 404 per stale host in the console
   * after the development reset).
   */
  it("GONE: 404 means there is no community at that address at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "not found" }, 404)));
    expect(await probeMembership(ACME, ME)).toEqual({ status: "gone" });
  });

  it("a 404 address is FORGOTTEN, so a deleted community stops being re-probed on every sign-in", async () => {
    const STALE = "ws://kwikster.localhost:3000";
    addCommunity(STALE, "Kwikster");
    addCommunity(ACME, "Acme");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("kwikster") ? json({ error: "not found" }, 404) : json([roster([ME, "member"])]),
      ),
    );

    const found = await discoverMemberships(ME);

    expect(found.gone).toEqual([STALE]);
    expect(communities.value.map((c) => c.relayUrl)).not.toContain(STALE);
    expect(communities.value.map((c) => c.relayUrl)).toContain(ACME); // a real one is kept
    expect(found.memberships.map((m) => m.relayUrl)).toContain(ACME);
  });

  it("a 403 address is KEPT — the community exists, this identity just isn't a member", async () => {
    addCommunity(ACME, "Acme");
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "restricted" }, 403)));

    const found = await discoverMemberships(ME);

    expect(found.gone).toEqual([]);
    expect(communities.value.map((c) => c.relayUrl)).toContain(ACME);
  });

  it("UNREACHABLE: a network failure, a timeout and a server error are not 'not a member'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await probeMembership(ACME, ME)).toEqual({ status: "unreachable" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "boom" }, 500)));
    expect(await probeMembership(ACME, ME)).toEqual({ status: "unreachable" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    expect(await probeMembership(ACME, ME)).toEqual({ status: "unreachable" });
  });

  it("PROOF, not a claim: the request is a NIP-98 signed POST — there is no pubkey header or parameter", async () => {
    const fetchMock = vi.fn(async () => json([roster([ME, "member"])]));
    vi.stubGlobal("fetch", fetchMock);
    await probeMembership(ACME, ME);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://acme.localhost:3000/query");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(["Authorization", "Content-Type"]); // no X-Pubkey
    const auth = decodeNip98(headers.Authorization);
    expect(auth.kind).toBe(27235);
    expect(auth.tags).toContainEqual(["u", "http://acme.localhost:3000/query"]);
    expect(auth.tags).toContainEqual(["method", "POST"]);
    expect(JSON.parse(init.body as string)).toEqual([{ kinds: [13534], limit: 1 }]);
  });

  it("without a usable signer the probe cannot prove anything → unreachable, never 'member'", async () => {
    removeFakeSigner();
    vi.stubGlobal("fetch", vi.fn(async () => json([roster([ME, "owner"])])));
    expect(await probeMembership(ACME, ME)).toEqual({ status: "unreachable" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("candidateRelays — addresses come from configuration and links, never typing", () => {
  it("is the deployment's home relay when the device knows nothing else", () => {
    expect(candidateRelays().map((c) => c.relayUrl)).toEqual(["ws://localhost:3000"]);
  });

  it("adds communities this device joined (with their saved label), without duplicates", () => {
    addCommunity(ACME, "Acme HQ");
    addCommunity("ws://localhost:3000");
    expect(candidateRelays()).toEqual([
      { relayUrl: ACME, name: "Acme HQ" },
      { relayUrl: "ws://localhost:3000", name: "localhost:3000" },
    ]);
  });
});

describe("discoverMemberships", () => {
  it("keeps the communities that say member, reports the unreachable ones, ignores refusals", async () => {
    addCommunity(ACME, "Acme HQ");
    addCommunity("ws://gone.localhost:3000", "Gone");
    addCommunity("ws://down.localhost:3000", "Down");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("http://acme.")) return json([roster([ME, "admin"])]);
        if (url.startsWith("http://gone.")) return json({ error: "no" }, 403);
        if (url.startsWith("http://down.")) throw new TypeError("Failed to fetch");
        return json({ error: "no" }, 403); // the home relay: not a member
      }),
    );

    const result = await discoverMemberships(ME);

    expect(result.memberships).toEqual([
      { relayUrl: ACME, host: "acme.localhost:3000", name: "Acme HQ", role: "admin" },
    ]);
    expect(result.unreachable).toEqual(["ws://down.localhost:3000"]);
    expect(result.asked).toBe(4);
  });

  it("a removed member simply stops appearing: memberships are re-asked, not remembered", async () => {
    addCommunity(ACME, "Acme HQ");
    vi.stubGlobal("fetch", vi.fn(async () => json([roster([ME, "member"])])));
    expect((await discoverMemberships(ME)).memberships.map((m) => m.host)).toContain("acme.localhost:3000");

    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "restricted" }, 403)));
    expect((await discoverMemberships(ME)).memberships).toEqual([]);
    // the address book still has it (it is only a list of addresses) — the relay decides
    expect(candidateRelays().map((c) => c.relayUrl)).toContain(ACME);
  });
});
