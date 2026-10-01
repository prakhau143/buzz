/**
 * Owner role resolution against the real relay, through the app's OWN code
 * path — NIP-42 → roster → resolveMyRole → capabilities.
 *
 * This exists because the ownership transfer mutates `relay_members`, but the
 * client never reads that table: it reads the relay's NIP-43 roster snapshot
 * (kind:13534). A correct DB row with a stale snapshot would leave the new
 * owner resolving as their OLD role, so "the transfer returned 200" is not
 * evidence that the owner is an owner in the app.
 *
 *   npx vitest run --config vitest.e2e.config.ts tests/integration/ownerRoleResolution.e2e.spec.ts
 *
 * Env: SWF_E2E_OWNER_SK, SWF_E2E_MEMBER_SK, SWF_E2E_DM_HOST.
 */
import dns from "node:dns";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { hexToBytes } from "nostr-tools/utils";
import { useWebSocketImplementation } from "nostr-tools/relay";
import WebSocket from "ws";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { setActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { useConnectionStore } from "@/stores/connection";
import { relayMembersService } from "@/features/community-members/RelayMembersService";
import { resolveMyRole } from "@/features/community-members/permissions";
import { capabilitiesFor } from "@/features/access/capabilities";

const _origDnsLookup = dns.lookup;
type LookupCallback = (err: Error | null, address: unknown, family?: number) => void;
type LookupRest = [LookupCallback] | [{ all?: boolean } | number | undefined, LookupCallback];
(dns as { lookup: unknown }).lookup = (hostname: string, ...rest: LookupRest) => {
  if (typeof hostname === "string" && hostname.endsWith(".localhost")) {
    const cb = rest[rest.length - 1] as LookupCallback;
    const opts = rest.length > 1 ? rest[0] : undefined;
    if (opts && typeof opts === "object" && opts.all) {
      return cb(null, [{ address: "127.0.0.1", family: 4 }]);
    }
    return cb(null, "127.0.0.1", 4);
  }
  return (_origDnsLookup as unknown as (...args: unknown[]) => void).call(dns, hostname, ...rest);
};
useWebSocketImplementation(WebSocket);

const OWNER_SK = process.env.SWF_E2E_OWNER_SK?.trim() ?? "";
const MEMBER_SK = process.env.SWF_E2E_MEMBER_SK?.trim() ?? "";
const HOST = process.env.SWF_E2E_DM_HOST?.trim() ?? "";
const HAS_ENV =
  /^[0-9a-f]{64}$/i.test(OWNER_SK) && /^[0-9a-f]{64}$/i.test(MEMBER_SK) && HOST.length > 0;
const RELAY_URL = `ws://${HOST}`;

describe.runIf(HAS_ENV)("owner role resolution after ownership transfer", () => {
  beforeAll(() => setActivePinia(createPinia()));
  afterAll(() => relayConnectionService.disconnect());

  it("resolves the transferred owner as owner, with owner capabilities", async () => {
    const owner = new DevSigningService(hexToBytes(OWNER_SK));
    const ownerPubkey = await owner.getPublicKey();

    setActiveSigningService(owner);
    await relayConnectionService.connect(RELAY_URL);
    // [4] NIP-42: the relay challenged and OUR signer answered as this identity.
    expect(useConnectionStore().status).toBe("connected");
    expect(useConnectionStore().authenticatedPubkey).toBe(ownerPubkey);

    // [5] present in the roster the client actually reads
    const members = await relayMembersService.fetchMembershipList();
    expect(members, "the relay must publish a roster snapshot").not.toBeNull();
    expect(members!.map((m) => m.pubkey.toLowerCase())).toContain(ownerPubkey.toLowerCase());

    // [6] the role the app resolves — from the roster, not from any local state
    const role = resolveMyRole(members, ownerPubkey);
    expect(role, "the transferred owner must resolve as owner").toBe("owner");

    // [7] capabilities follow the resolved role
    const caps = capabilitiesFor(null, role);
    expect(caps.canManageCommunityMembers).toBe(true);
    expect(caps.canModerateCommunity).toBe(true);
    expect(caps.canInviteToCommunity).toBe(true);
    expect(caps.canOpenCommunity).toBe(true);
    // [9] owner is NOT operator: a community role grants no platform power
    expect(caps.canAccessOperatorDashboard).toBe(false);
    expect(caps.canCreateCommunity).toBe(false);
  }, 60_000);

  /**
   * The three representations of a role must agree:
   *
   *   relay_members (canonical)  ==  published kind:13534 roster  ==  resolveMyRole
   *
   * They drifted once already: `BUZZ_REQUIRE_RELAY_MEMBERSHIP` was unset, so the
   * relay skipped roster publication after an ownership transfer
   * (`operator.rs:438`) and skipped both reconciliation jobs (`main.rs:625`).
   * The DB said `owner` while the app — which reads only the roster — said
   * `admin`, and nothing would ever have repaired it.
   *
   * This test can only see two of the three directly; the roster IS what
   * `fetchMembershipList` returns, and `relay_members` is asserted through the
   * relay's own behaviour: an owner-only operation is accepted for this
   * identity, which the relay authorises from `relay_members`, not the roster.
   */
  it("agrees on the owner's role across the roster, the client and the relay's own authorisation", async () => {
    const owner = new DevSigningService(hexToBytes(OWNER_SK));
    const ownerPubkey = await owner.getPublicKey();

    relayConnectionService.disconnect();
    setActiveSigningService(owner);
    await relayConnectionService.connect(RELAY_URL);

    // 1. published roster (what the client reads) says owner
    const members = await relayMembersService.fetchMembershipList();
    expect(resolveMyRole(members, ownerPubkey)).toBe("owner");

    // 2. relay_members (what the relay authorises from) agrees — a role change
    //    is owner-only (`relay_admin.rs`: "role changes are owner-only"), so the
    //    relay accepting one proves the canonical row says owner too. Flip a
    //    member's role and flip it straight back: net state unchanged.
    const other = await new DevSigningService(hexToBytes(MEMBER_SK)).getPublicKey();
    const original = resolveMyRole(members, other) ?? "member";
    const flipped = original === "admin" ? "member" : "admin";
    const change = (targetRole: typeof original, newRole: typeof original) =>
      relayMembersService.changeRole({
        pubkey: other,
        targetRole,
        newRole,
        actingRole: "owner",
        selfPubkey: ownerPubkey,
      });

    await change(original, flipped);
    await new Promise((r) => setTimeout(r, 1200));
    await change(flipped, original);
    await new Promise((r) => setTimeout(r, 1500));

    // 3. and the roster still agrees afterwards, for both identities
    const after = await relayMembersService.fetchMembershipList();
    expect(resolveMyRole(after, ownerPubkey)).toBe("owner");
    expect(resolveMyRole(after, other), "membership must end unchanged").toBe(original);
  }, 60_000);

  it("resolves the demoted previous owner as a plain member, not owner", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK));
    const memberPubkey = await member.getPublicKey();

    relayConnectionService.disconnect();
    setActiveSigningService(member);
    await relayConnectionService.connect(RELAY_URL);
    expect(useConnectionStore().status).toBe("connected");

    const members = await relayMembersService.fetchMembershipList();
    const role = resolveMyRole(members, memberPubkey);
    expect(role).not.toBe("owner");

    // [10] a non-owner gets none of the owner-only capabilities
    const caps = capabilitiesFor(null, role);
    expect(caps.canManageCommunityMembers).toBe(false);
    expect(caps.canModerateCommunity).toBe(false);
  }, 60_000);
});
