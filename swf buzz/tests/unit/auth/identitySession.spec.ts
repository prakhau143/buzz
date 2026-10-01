/**
 * P0 identity lifecycle (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md).
 * The relay is mocked (unit tests must not hit one); the real-relay A→B→A
 * matrix lives in tests/integration/liveRelay.e2e.spec.ts. What is asserted
 * here is the *shape* of switching: everything of identity A is gone before B
 * exists, B's socket is B's, roles are resolved per identity and per plane,
 * and caches can never serve A's data as B's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConnectionStore } from "@/stores/connection";
import { useSessionStore } from "@/stores/session";
import { useAccessStore } from "@/stores/access";
import { useUiStore } from "@/stores/ui";
import { useReadStateStore } from "@/stores/readState";
import { queryClient } from "@/app/providers/queryClient";
import { queryKeys } from "@/app/providers/queryKeys";
import { getActiveSigningService, clearActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { setActiveRelay } from "@/features/communities/relayCommunities";
import type { SigningService } from "@/features/signing/types";

const membershipListMock = vi.fn();
vi.mock("@/features/community-members/RelayMembersService", () => ({
  relayMembersService: { fetchMembershipList: (...a: unknown[]) => membershipListMock(...a) },
}));
const isOperatorMock = vi.fn();
vi.mock("@/features/communities/OperatorService", () => ({
  operatorService: {
    isOperator: (...a: unknown[]) => isOperatorMock(...a),
    // Same answer with its evidence; the signer is the identity being asked about.
    probeOperator: async (relay: string, forPubkey: string | null = null) => ({
      status: (await isOperatorMock(relay)) ? 200 : 403,
      signerPubkey: forPubkey,
      error: null,
      origin: "http://localhost:3000",
    }),
  },
}));

// The mocked connection behaves like the real one in the one way that matters
// here: connecting "signs" an AUTH with the ACTIVE signer and records whose
// pubkey that was — so a stale signer would be caught.
const connectMock = vi.fn();
const disconnectMock = vi.fn();
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: {
    connect: (...a: unknown[]) => connectMock(...a),
    disconnect: (...a: unknown[]) => disconnectMock(...a),
  },
}));

const A = "aa".repeat(32);
const B = "bb".repeat(32);

function signer(pubkey: string): SigningService {
  return {
    mode: "development",
    getPublicKey: async () => pubkey,
    signEvent: async (e) => ({ ...e, id: "id", pubkey, sig: "sig", created_at: e.created_at ?? 0, tags: e.tags }),
    nip44Encrypt: async () => "",
    nip44Decrypt: async () => "",
  } as unknown as SigningService;
}

async function importSession() {
  return import("@/features/auth/identitySession");
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  clearActiveSigningService();
  queryClient.clear();
  membershipListMock.mockResolvedValue(null);
  isOperatorMock.mockResolvedValue(false);
  connectMock.mockImplementation(async () => {
    // Real behaviour, reduced: the relay challenges; whoever is the ACTIVE
    // signer answers; the connection store records that pubkey.
    const signed = await getActiveSigningService().signEvent({ kind: 22242, content: "", tags: [] });
    const store = useConnectionStore();
    store.setStatus("connected");
    store.setAuthenticatedPubkey(signed.pubkey);
  });
  disconnectMock.mockImplementation(() => {
    useConnectionStore().setStatus("disconnected");
  });
});

describe("identitySession — beginIdentitySession", () => {
  it("establishes A: signer active, socket authenticated AS A, community role from relay_members, platform role separately", async () => {
    const { beginIdentitySession } = await importSession();
    membershipListMock.mockResolvedValue([{ pubkey: A, role: "member" }]);
    isOperatorMock.mockResolvedValue(false);

    const report = await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x", resolvePlatform: true });

    expect(report).toEqual({
      pubkey: A,
      authMode: "local",
      relayAuthenticatedPubkey: A,
      communityRole: "member",
      platformRole: null,
    });
    expect(useSessionStore().isReady).toBe(true);
    expect(useSessionStore().communityRole).toBe("member");
    expect(useSessionStore().platformRole).toBeNull();
    expect(useSessionStore().isPlatformOperator).toBe(false);
    expect(await getActiveSigningService().getPublicKey()).toBe(A);
  });

  it("platform role and community role are independent: an operator with no membership, and a member who is no operator", async () => {
    const { beginIdentitySession } = await importSession();

    membershipListMock.mockResolvedValue([{ pubkey: "cc".repeat(32), role: "owner" }]); // roster exists, B not in it
    isOperatorMock.mockResolvedValue(true);
    let report = await beginIdentitySession({ signer: signer(B), pubkey: B, relayUrl: "ws://x", resolvePlatform: true });
    expect(report?.platformRole).toBe("operator");
    expect(report?.communityRole).toBeNull(); // operator ≠ member

    membershipListMock.mockResolvedValue([{ pubkey: A, role: "owner" }]);
    isOperatorMock.mockResolvedValue(false);
    report = await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x", resolvePlatform: true });
    expect(report?.platformRole).toBeNull(); // owner ≠ operator
    expect(report?.communityRole).toBe("owner");
  });

  it("refuses a socket whose AUTH was signed by a different identity than the one being established", async () => {
    const { beginIdentitySession } = await importSession();
    // A misbehaving connect that authenticates as someone else.
    connectMock.mockImplementationOnce(async () => {
      const store = useConnectionStore();
      store.setStatus("connected");
      store.setAuthenticatedPubkey(B);
    });

    const report = await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x" });

    expect(report).toBeNull();
    expect(useSessionStore().authStatus).toBe("authError");
    expect(useSessionStore().pubkey).toBeNull();
    expect(() => getActiveSigningService()).toThrow(); // nothing may sign as the wrong identity
    expect(disconnectMock).toHaveBeenCalled();
  });

  it("relay unreachable: not ready, error recorded, signer left active for background reconnect", async () => {
    const { beginIdentitySession } = await importSession();
    connectMock.mockImplementationOnce(async () => {
      useConnectionStore().setStatus("error", "Can't reach the local Buzz relay.");
    });

    const report = await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x" });

    expect(report).toBeNull();
    expect(useSessionStore().authStatus).toBe("authError");
    expect(useSessionStore().authError).toContain("relay");
    expect(() => getActiveSigningService()).not.toThrow();
  });
});

describe("identitySession — switching A → B → A (no restart)", () => {
  it("nothing of A survives into B's session, and B's socket is authenticated as B", async () => {
    const { beginIdentitySession, endIdentitySession } = await importSession();

    // ---- A signs in and accumulates identity-scoped state ----------------
    membershipListMock.mockResolvedValue([{ pubkey: A, role: "member" }]);
    await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x", resolvePlatform: true });
    useAccessStore().setResult({ isOperator: false, memberships: [], unreachable: [], destination: null });
    useUiStore().selectChannel("chan-A");
    useUiStore().openThread("root-A");
    useReadStateStore().recordUnseenMessage("chan-A", true);
    // DM read state lives in the shared NIP-RS store now (DMs are channels).
    useReadStateStore().recordUnseenMessage("dm-A", false);
    queryClient.setQueryData(queryKeys.channels(), [{ id: "chan-A", name: "a-only" }]);
    queryClient.setQueryData(queryKeys.relayMembers(), [{ pubkey: A, role: "member" }]);
    const keyForA = queryKeys.channels();
    // Identity-scoped first, then community-scoped (see queryKeys.ts).
    expect(keyForA.slice(0, 2)).toEqual(["identity", A]);
    expect(keyForA).toContain("channels");

    // ---- sign out ------------------------------------------------------------
    endIdentitySession();

    expect(disconnectMock).toHaveBeenCalled();
    expect(() => getActiveSigningService()).toThrow();
    expect(useSessionStore().pubkey).toBeNull();
    expect(useSessionStore().communityRole).toBeNull();
    expect(useSessionStore().platformRole).toBeNull();
    expect(useAccessStore().destination).toBeNull();
    expect(useConnectionStore().authenticatedPubkey).toBeNull();
    expect(useConnectionStore().status).toBe("disconnected");
    expect(useUiStore().selectedChannelId).toBeNull();
    expect(useUiStore().contextPanel).toEqual({ kind: "none" });
    expect(useReadStateStore().unreadCounts).toEqual({});
    expect(useReadStateStore().hasMention).toEqual({});
    expect(useReadStateStore().unreadCounts["dm-A"]).toBeUndefined();
    expect(queryClient.getQueryData(keyForA)).toBeUndefined(); // A's caches are gone, not just hidden

    // ---- B signs in ------------------------------------------------------------
    membershipListMock.mockResolvedValue([{ pubkey: B, role: "owner" }]);
    isOperatorMock.mockResolvedValue(true);
    const reportB = await beginIdentitySession({ signer: signer(B), pubkey: B, relayUrl: "ws://x", resolvePlatform: true });

    expect(reportB?.pubkey).toBe(B);
    expect(reportB?.relayAuthenticatedPubkey).toBe(B);
    expect(reportB?.communityRole).toBe("owner");
    expect(reportB?.platformRole).toBe("operator");
    expect(await getActiveSigningService().getPublicKey()).toBe(B);
    expect(queryKeys.channels().slice(0, 2)).toEqual(["identity", B]);
    expect(queryClient.getQueryData(queryKeys.channels())).toBeUndefined(); // B never sees A's channel list
    expect(queryClient.getQueryData(keyForA)).toBeUndefined();

    // ---- back to A -------------------------------------------------------------
    endIdentitySession();
    membershipListMock.mockResolvedValue([{ pubkey: A, role: "member" }]);
    isOperatorMock.mockResolvedValue(false);
    const reportA2 = await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x", resolvePlatform: true });
    expect(reportA2).toEqual({
      pubkey: A,
      authMode: "local",
      relayAuthenticatedPubkey: A,
      communityRole: "member",
      platformRole: null,
    });
  });

  it("switching WITHOUT an explicit sign-out still tears A down first (begin is self-contained)", async () => {
    const { beginIdentitySession } = await importSession();
    membershipListMock.mockResolvedValue([{ pubkey: A, role: "admin" }]);
    await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x" });
    queryClient.setQueryData(queryKeys.channels(), ["A-data"]);
    disconnectMock.mockClear();

    membershipListMock.mockResolvedValue([{ pubkey: B, role: "member" }]);
    const report = await beginIdentitySession({ signer: signer(B), pubkey: B, relayUrl: "ws://x" });

    expect(disconnectMock).toHaveBeenCalledTimes(1); // A's socket closed before B's opened
    expect(report?.relayAuthenticatedPubkey).toBe(B);
    expect(report?.communityRole).toBe("member"); // B's own role, not A's "admin"
    // Prefix match: no query of A survives, whatever community it was scoped to.
    expect(queryClient.getQueryCache().findAll({ queryKey: ["identity", A] })).toHaveLength(0);
  });

  it("same identity, another community: the routing decision survives but the previous relay's cache does not", async () => {
    const { beginIdentitySession } = await importSession();
    membershipListMock.mockResolvedValue([{ pubkey: A, role: "member" }]);
    await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://one" });
    useAccessStore().setResult({
      isOperator: false,
      memberships: [{ relayUrl: "ws://one", host: "one", name: "One", role: "member" }, { relayUrl: "ws://two", host: "two", name: "Two", role: "owner" }],
      unreachable: [],
      destination: null,
    });
    queryClient.setQueryData(queryKeys.channels(), ["from-one"]);

    membershipListMock.mockResolvedValue([{ pubkey: A, role: "owner" }]);
    await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://two" });

    expect(useAccessStore().memberships).toHaveLength(2); // still A's decision
    expect(useSessionStore().communityRole).toBe("owner"); // role is per community
    expect(queryClient.getQueryData(queryKeys.channels())).toBeUndefined(); // "from-one" never shown as two's
  });
});

/**
 * SWF sign-out = session teardown + REMOVAL of the identity from the device
 * (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3). The "device" here is a
 * fake store handed in as the injectable `remove`, standing in for the Rust
 * `delete_identity` command (which needs a desktop process — its own behaviour
 * is covered by `cargo test` in src-tauri/src/identity/storage.rs).
 */
describe("identitySession — endIdentitySessionAndRemoveIdentity (SWF shared-device sign-out)", () => {
  type Device = { stored: string | null; deletes: number; failNext?: string };
  const device = (pubkey: string | null): Device => ({ stored: pubkey, deletes: 0 });
  const removerFor = (d: Device) => async () => {
    d.deletes += 1;
    if (d.failNext) {
      const reason = d.failNext;
      d.failNext = undefined;
      throw new Error(reason);
    }
    d.stored = null;
    return { pubkey: null, npub: null, storage: "none" as const, recovery: "none" as const };
  };

  it("A → sign out: everything of A is gone AND the identity is removed from the device, in that order", async () => {
    const { beginIdentitySession, endIdentitySessionAndRemoveIdentity } = await importSession();
    const order: string[] = [];
    disconnectMock.mockImplementation(() => {
      order.push("disconnect");
      useConnectionStore().setStatus("disconnected");
    });
    membershipListMock.mockResolvedValue([{ pubkey: A, role: "member" }]);
    await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x", resolvePlatform: true });
    useUiStore().selectChannel("chan-A");
    queryClient.setQueryData(queryKeys.channels(), ["A-data"]);
    order.length = 0; // begin's own teardown disconnect is not what is under test
    const d = device(A);
    const remove = async () => {
      order.push("delete_identity");
      return removerFor(d)();
    };

    const result = await endIdentitySessionAndRemoveIdentity(remove);

    expect(result).toEqual({ removed: true });
    expect(order).toEqual(["disconnect", "delete_identity"]); // teardown BEFORE the key goes
    expect(d.stored).toBeNull(); // get_identity() = none
    expect(d.deletes).toBe(1);
    expect(() => getActiveSigningService()).toThrow(); // signer cleared
    expect(useSessionStore().pubkey).toBeNull(); // session cleared
    expect(useSessionStore().communityRole).toBeNull(); // roles cleared
    expect(useSessionStore().platformRole).toBeNull();
    expect(useSessionStore().identityRemovalError).toBeNull();
    expect(useAccessStore().memberships).toEqual([]);
    expect(useConnectionStore().authenticatedPubkey).toBeNull();
    expect(useConnectionStore().status).toBe("disconnected"); // relay disconnected
    expect(useUiStore().selectedChannelId).toBeNull();
    expect(queryClient.getQueryCache().findAll({ queryKey: ["identity", A] })).toHaveLength(0); // cache cleared
  });

  it("removal FAILURE: the session is still ended (safe logged-out state) but the identity is reported as still stored", async () => {
    const { beginIdentitySession, endIdentitySessionAndRemoveIdentity } = await importSession();
    membershipListMock.mockResolvedValue([{ pubkey: A, role: "owner" }]);
    await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x" });
    const d = device(A);
    d.failNext = "couldn't remove the identity from secure storage: keyring delete denied";

    const result = await endIdentitySessionAndRemoveIdentity(removerFor(d));

    expect(result).toEqual({ removed: false, error: expect.stringContaining("keyring delete denied") });
    expect(d.stored).toBe(A); // still on the device
    expect(useSessionStore().pubkey).toBeNull(); // but nobody is signed in
    expect(() => getActiveSigningService()).toThrow(); // and nothing can sign as A
    expect(useConnectionStore().status).toBe("disconnected");
    expect(useSessionStore().identityRemovalError).toContain("keyring delete denied");

    // A retry that succeeds clears the notice.
    expect(await endIdentitySessionAndRemoveIdentity(removerFor(d))).toEqual({ removed: true });
    expect(d.stored).toBeNull();
    expect(useSessionStore().identityRemovalError).toBeNull();
  });

  it("A → sign out (removed) → B: B's session is B's; A's data and A's key are nowhere", async () => {
    const { beginIdentitySession, endIdentitySessionAndRemoveIdentity } = await importSession();
    membershipListMock.mockResolvedValue([{ pubkey: A, role: "member" }]);
    await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x", resolvePlatform: true });
    queryClient.setQueryData(queryKeys.relayMembers(), [{ pubkey: A, role: "member" }]);
    const d = device(A);
    await endIdentitySessionAndRemoveIdentity(removerFor(d));
    expect(d.stored).toBeNull();

    // B imports → (Rust stores B) → B signs in
    d.stored = B;
    membershipListMock.mockResolvedValue([{ pubkey: B, role: "owner" }]);
    isOperatorMock.mockResolvedValue(true);
    const reportB = await beginIdentitySession({ signer: signer(B), pubkey: B, relayUrl: "ws://x", resolvePlatform: true });

    expect(reportB).toEqual({ pubkey: B, authMode: "local", relayAuthenticatedPubkey: B, communityRole: "owner", platformRole: "operator" });
    expect(queryClient.getQueryData(["identity", A, "relay-members"])).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.relayMembers())).toBeUndefined();

    // B → sign out (removed) → A imports again
    await endIdentitySessionAndRemoveIdentity(removerFor(d));
    expect(d.stored).toBeNull();
    expect(useSessionStore().isPlatformOperator).toBe(false);
    d.stored = A;
    membershipListMock.mockResolvedValue([{ pubkey: A, role: "member" }]);
    isOperatorMock.mockResolvedValue(false);
    const reportA = await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x", resolvePlatform: true });
    expect(reportA).toEqual({ pubkey: A, authMode: "local", relayAuthenticatedPubkey: A, communityRole: "member", platformRole: null });
  });

  it("a stale AUTH answered by A's signer is rejected once B is being established", async () => {
    const { beginIdentitySession, endIdentitySessionAndRemoveIdentity } = await importSession();
    await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://x" });
    await endIdentitySessionAndRemoveIdentity(removerFor(device(A)));

    // A leftover handshake (old socket, old signer) reports A's AUTH while B connects.
    connectMock.mockImplementationOnce(async () => {
      const store = useConnectionStore();
      store.setStatus("connected");
      store.setAuthenticatedPubkey(A);
    });
    const report = await beginIdentitySession({ signer: signer(B), pubkey: B, relayUrl: "ws://x" });

    expect(report).toBeNull();
    expect(useSessionStore().authError).toContain("different identity");
    expect(useSessionStore().pubkey).toBeNull();
    expect(() => getActiveSigningService()).toThrow();
  });
});

describe("queryKeys — identity and community scope", () => {
  it("every key is prefixed with the active pubkey, and 'anonymous' with no session", () => {
    expect(queryKeys.relayMembers().slice(0, 2)).toEqual(["identity", "anonymous"]);
    useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: A });
    expect(queryKeys.relayMembers().slice(0, 2)).toEqual(["identity", A]);
    expect(queryKeys.channelMessages("c1").slice(0, 2)).toEqual(["identity", A]);
    expect(queryKeys.adminReports("open").slice(0, 3)).toEqual(queryKeys.adminReportsAll());
  });

  /**
   * Relay-backed state belongs to ONE tenant. Identity alone was not enough of
   * a key: two communities opened by the same person shared a cache entry, and
   * only `queryClient.clear()` during teardown kept them apart — a behavioural
   * guarantee rather than a structural one.
   */
  it("community-specific keys carry the community, so two communities cannot share an entry", () => {
    useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: A });

    setActiveRelay("ws://community-a.localhost:3000");
    const aMembers = queryKeys.relayMembers();
    const aMessages = queryKeys.channelMessages("c1");

    setActiveRelay("ws://community-b.localhost:3000");
    expect(queryKeys.relayMembers()).not.toEqual(aMembers);
    expect(queryKeys.channelMessages("c1")).not.toEqual(aMessages);
    expect(queryKeys.relayMembers()).toContain("ws://community-b.localhost:3000");
  });

  /**
   * A profile belongs to a PUBKEY and is replicated to every community, so the
   * same person must resolve to the same cache entry everywhere — scoping it
   * per community would refetch an identical event on every switch.
   */
  it("profile keys stay identity-scoped across communities", () => {
    useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: A });
    setActiveRelay("ws://community-a.localhost:3000");
    const inA = queryKeys.profile(A);
    setActiveRelay("ws://community-b.localhost:3000");
    expect(queryKeys.profile(A)).toEqual(inA);
  });
});

describe("identitySession — an overtaken community switch never commits", () => {
  it("A → one (slow) → two: one's late membership answer cannot become two's role or session", async () => {
    const { beginIdentitySession } = await importSession();
    const { readyCommunityUrl } = await import("@/features/communities/communitySession");
    let answerOne: (members: unknown) => void = () => undefined;
    membershipListMock.mockImplementationOnce(() => new Promise((resolve) => (answerOne = resolve)));
    const toOne = beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://one" });
    await vi.waitFor(() => expect(membershipListMock).toHaveBeenCalledTimes(1));

    // The user picks another community before "one" finished resolving the role.
    membershipListMock.mockResolvedValueOnce([{ pubkey: A, role: "owner" }]);
    const two = await beginIdentitySession({ signer: signer(A), pubkey: A, relayUrl: "ws://two" });
    expect(two?.communityRole).toBe("owner");

    answerOne([{ pubkey: A, role: "member" }]);
    expect(await toOne).toBeNull();
    expect(useSessionStore().communityRole).toBe("owner");
    expect(readyCommunityUrl.value).toBe("ws://two");
  });
});
