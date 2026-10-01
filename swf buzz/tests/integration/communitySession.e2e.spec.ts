/**
 * Phase 6 — the community SESSION model against the REAL relay.
 *
 * The earlier live specs drive the session layer directly, so none of them
 * exercises the routing rule introduced in Phase 6. This file does:
 *
 *  1. Fresh login never auto-connects. `resolveAccess` for a real member, with
 *     a recent community in the address book, answers "choose a community" and
 *     opens no socket — the relay's membership probe (NIP-98) is the only
 *     network touch.
 *  2. Real A → B → A isolation for ONE identity. B is provisioned by the
 *     throwaway operator with a fresh ephemeral owner (no shared identity's
 *     quota or state is touched), and the owner adds our member. In A the member
 *     posts a unique token; in B neither A's channels nor that token are
 *     visible (channels, cache, NIP-50 search); back in A they are.
 *
 * Env (test process only): SWF_E2E_MEMBER_SK (a member of the dev community),
 * SWF_E2E_OPERATOR_SK (throwaway operator), SWF_E2E_DM_HOST (the dev community).
 */
import dns from "node:dns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { hexToBytes } from "nostr-tools/utils";
import { useWebSocketImplementation } from "nostr-tools/relay";
import WebSocket from "ws";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { setActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { useConnectionStore } from "@/stores/connection";
import { channelService } from "@/features/channels/ChannelService";
import { messageService } from "@/features/messages/MessageService";
import { searchService } from "@/features/search/SearchService";
import { operatorService } from "@/features/communities/OperatorService";
import { relayMembersService } from "@/features/community-members/RelayMembersService";
import { addCommunity, clearCommunitiesForTests } from "@/features/communities/relayCommunities";
import { beginIdentitySession, endIdentitySession } from "@/features/auth/identitySession";
import { queryClient } from "@/app/providers/queryClient";
import { queryKeys } from "@/app/providers/queryKeys";

const _origDnsLookup = dns.lookup;
type LookupCallback = (err: Error | null, address: unknown, family?: number) => void;
type LookupRest = [LookupCallback] | [{ all?: boolean } | number | undefined, LookupCallback];
(dns as { lookup: unknown }).lookup = (hostname: string, ...rest: LookupRest) => {
  if (typeof hostname === "string" && hostname.endsWith(".localhost")) {
    const cb = rest[rest.length - 1] as LookupCallback;
    const opts = rest.length > 1 ? rest[0] : undefined;
    if (opts && typeof opts === "object" && opts.all) return cb(null, [{ address: "127.0.0.1", family: 4 }]);
    return cb(null, "127.0.0.1", 4);
  }
  return (_origDnsLookup as unknown as (...args: unknown[]) => void).call(dns, hostname, ...rest);
};
useWebSocketImplementation(WebSocket);

const MEMBER_SK = process.env.SWF_E2E_MEMBER_SK?.trim() ?? "";
const OPERATOR_SK = process.env.SWF_E2E_OPERATOR_SK?.trim() ?? "";
const HOST_A = process.env.SWF_E2E_DM_HOST?.trim() ?? "";
const HAS_ENV = /^[0-9a-f]{64}$/i.test(MEMBER_SK) && /^[0-9a-f]{64}$/i.test(OPERATOR_SK) && HOST_A.length > 0;
const RELAY_A = `ws://${HOST_A}`;
const BASE_ORIGIN_WS = "ws://localhost:3000";

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    last = await fn();
  }
  return last;
}

describe.skipIf(!HAS_ENV)("Phase 6 live — community session model", () => {
  let member: DevSigningService;
  let memberPubkey = "";

  beforeAll(async () => {
    setActivePinia(createPinia());
    clearCommunitiesForTests();
    member = new DevSigningService(hexToBytes(MEMBER_SK));
    memberPubkey = await member.getPublicKey();
  });

  afterAll(() => {
    endIdentitySession();
    relayConnectionService.disconnect();
  });

  it("fresh login with a recent community: the relay confirms membership, but NOTHING is opened — choose a community", async () => {
    const { resolveAccess } = await import("@/features/auth/useAuth");
    endIdentitySession();
    addCommunity(RELAY_A, "Dev community"); // a recent community on this device
    setActiveSigningService(member);

    const decision = await resolveAccess(memberPubkey);

    expect(decision).toEqual({ kind: "route", destination: "communities" });
    const { useAccessStore } = await import("@/stores/access");
    expect(useAccessStore().memberships.map((m) => m.relayUrl)).toContain(RELAY_A); // relay-verified, offered
    expect(useConnectionStore().status).not.toBe("connected"); // no socket was opened on its own
    expect(useConnectionStore().authenticatedPubkey).toBeNull();
  }, 60_000);

  it("A → B → A with one identity: B never shows A's channels, cache or search results — and back in A they return", async () => {
    // ---- Provision community B: throwaway operator, fresh ephemeral owner ----
    const operator = new DevSigningService(hexToBytes(OPERATOR_SK));
    const ownerB = new DevSigningService("ephemeral");
    const hostB = `swf-sess-${Date.now()}.localhost:3000`;
    setActiveSigningService(operator);
    const created = await operatorService.createCommunity(BASE_ORIGIN_WS, { host: hostB, ownerPubkey: await ownerB.getPublicKey() });
    const RELAY_B = created.relayUrl;

    endIdentitySession();
    setActiveSigningService(ownerB);
    await relayConnectionService.connect(RELAY_B);
    await relayMembersService.addMember({ pubkey: memberPubkey, role: "member", actingRole: "owner" });
    await channelService.createChannel({ name: "b-only" });
    await waitFor(() => channelService.discoverChannels(), (l) => l.some((c) => c.name === "b-only"));
    relayConnectionService.disconnect();

    // ---- The member works in A ------------------------------------------------
    const token = `swfiso${Date.now().toString(36)}`;
    expect(await beginIdentitySession({ signer: member, pubkey: memberPubkey, relayUrl: RELAY_A })).not.toBeNull();
    const channelsA = await waitFor(() => channelService.discoverChannels(), (l) => l.length > 0);
    const idsA = new Set(channelsA.map((c) => c.id));
    queryClient.setQueryData(queryKeys.channels(), channelsA);
    const openA = channelsA.find((c) => c.visibility !== "private")!;
    await messageService.send({ channelId: openA.id, content: `isolation ${token}` });
    const hitsInA = await waitFor(() => searchService.searchMessages(token), (h) => h.length > 0);
    expect(hitsInA.length, "the token must be findable in A (else B's zero proves nothing)").toBeGreaterThan(0);

    // ---- Switch to B (same identity) -------------------------------------------
    expect(await beginIdentitySession({ signer: member, pubkey: memberPubkey, relayUrl: RELAY_B })).not.toBeNull();
    expect(useConnectionStore().authenticatedPubkey).toBe(memberPubkey);
    expect(queryClient.getQueryData(queryKeys.channels()), "A's cached channels must not be served in B").toBeUndefined();
    const channelsB = await waitFor(() => channelService.discoverChannels(), (l) => l.some((c) => c.name === "b-only"));
    expect(channelsB.some((c) => c.name === "b-only")).toBe(true);
    expect(channelsB.filter((c) => idsA.has(c.id)), "no channel of A may appear in B").toEqual([]);
    expect(await searchService.searchMessages(token), "A's message must not be searchable from B").toEqual([]);

    // ---- Back to A --------------------------------------------------------------
    expect(await beginIdentitySession({ signer: member, pubkey: memberPubkey, relayUrl: RELAY_A })).not.toBeNull();
    const channelsA2 = await waitFor(() => channelService.discoverChannels(), (l) => l.length > 0);
    expect(channelsA2.some((c) => c.name === "b-only"), "no stale B channel in A").toBe(false);
    expect(channelsA2.some((c) => c.id === openA.id)).toBe(true);
    expect((await searchService.searchMessages(token)).length).toBeGreaterThan(0);
  }, 180_000);
});
