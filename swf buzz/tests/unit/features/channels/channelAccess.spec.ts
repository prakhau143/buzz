/**
 * Phase G — community switching & channel access consistency.
 *
 * The bug: after A → B (join a private channel there) → A, an A private
 * channel the user belongs to showed its messages AND "You're not a member of
 * this channel yet" + "Join channel". Root cause (docs/PHASE_G_… §12):
 *  1. the roster read resolved as an EMPTY list on timeout / relay CLOSED
 *     (e.g. "auth-required" while the new session authenticates), and
 *  2. the screens rendered "no role" — loading, failed or empty alike — as
 *     "not a member".
 * These tests pin the fix: a strict roster read, and one access state machine
 * in which only an authoritative negative can ever offer Join.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, h, ref } from "vue";

const relay = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: { subscribe: (...a: unknown[]) => relay.subscribe(...a) },
}));

import { fetchEventsOnce, IncompleteRelayAnswerError } from "@/services/relayQuery";
import {
  beginCommunitySession,
  endCommunitySession,
  StaleCommunitySessionError,
} from "@/features/communities/communitySession";
import { clearCommunitiesForTests, setActiveRelay } from "@/features/communities/relayCommunities";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import {
  historyIsReadable,
  resolveChannelAccess,
  showsJoin,
  useChannelAccess,
  type RosterState,
} from "@/features/channels/channelAccess";
import ChannelAccessBar from "@/features/channels/ui/ChannelAccessBar.vue";
import { KIND_NIP29_GROUP_ADMINS, KIND_NIP29_GROUP_MEMBERS } from "@/protocol/kinds";
import type { Member } from "@/types/domain";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const COMMUNITY_A = "wss://a.example";
const COMMUNITY_B = "wss://b.example";

type Handlers = { onEvent: (e: unknown) => void; onEose?: () => void; onClosed?: (r: string) => void };

beforeEach(() => {
  setActivePinia(createPinia());
  relay.subscribe.mockReset();
  clearCommunitiesForTests();
});
afterEach(() => vi.useRealTimers());

const roster = (data: Member[] | undefined, extra: Partial<RosterState> = {}): RosterState => ({
  data,
  isFetching: false,
  isError: false,
  ...extra,
});
const access = (input: Partial<Parameters<typeof resolveChannelAccess>[0]>) =>
  resolveChannelAccess({ me: ME, channelId: "ch", roster: roster(undefined), visibility: "private", ...input });

// ---------------------------------------------------------------------------
// The transport fix: an incomplete roster read is not an empty roster
// ---------------------------------------------------------------------------

describe("roster reads require a complete relay answer", () => {
  it("a relay CLOSED ('auth-required' while a switched session authenticates) rejects instead of returning []", async () => {
    relay.subscribe.mockImplementation((_id: string, _f: unknown, h: Handlers) => {
      queueMicrotask(() => h.onClosed?.("auth-required: please authenticate"));
      return { close: vi.fn() };
    });
    await expect(fetchEventsOnce([{ kinds: [KIND_NIP29_GROUP_MEMBERS] }], { requireEose: true })).rejects.toBeInstanceOf(
      IncompleteRelayAnswerError,
    );
  });

  it("11. a slow relay (timeout) rejects instead of returning []", async () => {
    vi.useFakeTimers();
    relay.subscribe.mockImplementation(() => ({ close: vi.fn() }));
    const pending = fetchEventsOnce([{ kinds: [KIND_NIP29_GROUP_ADMINS] }], { requireEose: true, timeoutMs: 300 });
    vi.advanceTimersByTime(300);
    await expect(pending).rejects.toMatchObject({ reason: "timeout" });
  });

  it("lenient reads keep their old behaviour (partial on timeout)", async () => {
    vi.useFakeTimers();
    relay.subscribe.mockImplementation((_id: string, _f: unknown, h: Handlers) => {
      h.onEvent({ id: "x" });
      return { close: vi.fn() };
    });
    const pending = fetchEventsOnce([{ kinds: [9] }], { timeoutMs: 300 });
    vi.advanceTimersByTime(300);
    await expect(pending).resolves.toEqual([{ id: "x" }]);
  });

  it("7. a roster answer from community A arriving after the switch to B is rejected as stale", async () => {
    let eose: (() => void) | undefined;
    relay.subscribe.mockImplementation((_id: string, _f: unknown, h: Handlers) => {
      eose = h.onEose;
      return { close: vi.fn() };
    });
    beginCommunitySession(COMMUNITY_A);
    const fromA = fetchEventsOnce([{ kinds: [KIND_NIP29_GROUP_MEMBERS] }], { requireEose: true });
    endCommunitySession(); // switch: teardown…
    beginCommunitySession(COMMUNITY_B); // …and B begins
    eose?.();
    await expect(fromA).rejects.toBeInstanceOf(StaleCommunitySessionError);
  });
});

describe("8/24. community-scoped cache keys", () => {
  it("the same channel id in two communities never shares a roster entry", () => {
    setActiveRelay(COMMUNITY_A);
    const inA = JSON.stringify(queryKeys.members("ch-1"));
    setActiveRelay(COMMUNITY_B);
    const inB = JSON.stringify(queryKeys.members("ch-1"));
    expect(inA).not.toBe(inB);
    expect(inA).toContain(COMMUNITY_A);
    expect(inB).toContain(COMMUNITY_B);
  });

  it("…and the identity is part of the key too", () => {
    setActiveRelay(COMMUNITY_A);
    useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: ME });
    expect(JSON.stringify(queryKeys.members("ch-1"))).toContain(ME);
  });
});

// ---------------------------------------------------------------------------
// The access state machine
// ---------------------------------------------------------------------------

describe("access state machine", () => {
  it("unknown without an identity or a channel", () => {
    expect(access({ me: null }).status).toBe("unknown");
    expect(access({ channelId: null }).status).toBe("unknown");
  });

  it("9/10. unknown and checking never offer Join", () => {
    expect(showsJoin(access({ me: null }))).toBe(false);
    const checking = access({ roster: roster(undefined, { isFetching: true }) });
    expect(checking.status).toBe("checking");
    expect(showsJoin(checking)).toBe(false);
  });

  it("11. a failed first read is 'error', never 'not_member'", () => {
    const failed = access({ roster: roster(undefined, { isError: true }) });
    expect(failed.status).toBe("error");
    expect(showsJoin(failed)).toBe(false);
  });

  it("12. an authoritative roster without me is NOT_MEMBER — the only state that offers Join", () => {
    const no = access({ roster: roster([{ pubkey: OTHER, role: "owner" }]) });
    expect(no.status).toBe("not_member");
    expect(showsJoin(no)).toBe(true);
  });

  it("13/22/23. an authoritative roster with me is MEMBER, with my role preserved", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      const yes = access({ roster: roster([{ pubkey: ME, role }]) });
      expect(yes).toMatchObject({ status: "member", role, source: "roster" });
      expect(showsJoin(yes)).toBe(false);
    }
  });

  it("6/11. a known member stays a member while re-checking or after a failed re-check", () => {
    const known = [{ pubkey: ME, role: "admin" as const }];
    expect(access({ roster: roster(known, { isFetching: true }) })).toMatchObject({ status: "member", role: "admin", rechecking: true });
    expect(access({ roster: roster(known, { isError: true }) })).toMatchObject({ status: "member", rechecking: true });
  });

  it("14. private channel: history the relay served me means access, even if the roster lags", () => {
    expect(access({ historyReadable: true }).status).toBe("member");
    expect(access({ roster: roster([{ pubkey: OTHER, role: "owner" }]), historyReadable: true })).toMatchObject({
      status: "member",
      source: "history",
    });
  });

  it("open channel: readable history proves nothing (anyone may read), the roster decides", () => {
    const open = access({ visibility: "open", roster: roster([]), historyReadable: true });
    expect(open.status).toBe("not_member");
  });

  it("only relay-confirmed rows count as readable history", () => {
    expect(historyIsReadable([{ status: "sending" }, { status: "failed" }], false)).toBe(false);
    expect(historyIsReadable([{ status: "sent" }], false)).toBe(true);
    expect(historyIsReadable([{ status: "sent" }], true)).toBe(false);
    expect(historyIsReadable(undefined, false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The reported scenario, end to end through vue-query
// ---------------------------------------------------------------------------

const svc = vi.hoisted(() => ({ fetchMembers: vi.fn() }));
vi.mock("@/features/channels/ChannelService", () => ({ channelService: { fetchMembers: svc.fetchMembers } }));

function mountAccess(channelId: ReturnType<typeof ref<string | null>>, visibility: "open" | "private" = "private") {
  let api!: ReturnType<typeof useChannelAccess>;
  const Host = defineComponent({
    setup() {
      api = useChannelAccess({ channelId: () => channelId.value ?? null, me: () => ME, visibility: () => visibility });
      return () => h("div");
    },
  });
  const client = new QueryClient();
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } });
  return { get api() { return api; }, client };
}

describe("1–6, 15–21. switching communities", () => {
  beforeEach(() => svc.fetchMembers.mockReset());

  it("1/4/15. A → B (join B1) → A: A1 resolves MEMBER and never shows Join on the way", async () => {
    vi.useFakeTimers();
    useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: ME });
    // A1 roster — but the first read lands while the switched session is still
    // authenticating, exactly the reported timing.
    svc.fetchMembers
      .mockRejectedValueOnce(new IncompleteRelayAnswerError("closed", "auth-required:"))
      .mockResolvedValue([{ pubkey: ME, role: "member" }]);
    setActiveRelay(COMMUNITY_A);
    const channel = ref<string | null>("a1");
    const view = mountAccess(channel);
    const seen = new Set<string>();
    const record = () => seen.add(view.api.access.value.status);
    record();
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(600);
      record();
    }
    expect(view.api.access.value.status).toBe("member");
    expect(seen.has("not_member")).toBe(false);
    expect(view.api.showJoin.value).toBe(false);
  });

  it("2/3. B's roster cannot answer for A's channel (separate community-scoped entries)", async () => {
    useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: ME });
    svc.fetchMembers.mockImplementation(async () => [{ pubkey: ME, role: "member" }]);
    setActiveRelay(COMMUNITY_B);
    const channel = ref<string | null>("shared-id");
    const view = mountAccess(channel);
    await flushPromises();
    expect(view.api.access.value.status).toBe("member");
    // Same channel id, other community: a different cache entry, fetched afresh.
    setActiveRelay(COMMUNITY_A);
    svc.fetchMembers.mockImplementation(async () => [{ pubkey: OTHER, role: "owner" }]);
    await flushPromises();
    expect(view.client.getQueryData(queryKeys.members("shared-id"))).toEqual([{ pubkey: OTHER, role: "owner" }]);
    setActiveRelay(COMMUNITY_B);
    expect(view.client.getQueryData(queryKeys.members("shared-id"))).toEqual([{ pubkey: ME, role: "member" }]);
  });

  it("16. a private channel I'm not in: authoritative negative → Join", async () => {
    useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: ME });
    svc.fetchMembers.mockResolvedValue([{ pubkey: OTHER, role: "owner" }]);
    setActiveRelay(COMMUNITY_B);
    const view = mountAccess(ref<string | null>("b1"));
    await flushPromises();
    expect(view.api.access.value.status).toBe("not_member");
    expect(view.api.showJoin.value).toBe(true);
  });

  it("5/6. rapid A → B → A: whichever channel is current, its own answer wins", async () => {
    useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: ME });
    const answers: Record<string, Member[]> = { a1: [{ pubkey: ME, role: "admin" }], b1: [{ pubkey: OTHER, role: "owner" }] };
    svc.fetchMembers.mockImplementation(async (id: string) => answers[id]);
    const channel = ref<string | null>("a1");
    setActiveRelay(COMMUNITY_A);
    const view = mountAccess(channel);
    setActiveRelay(COMMUNITY_B);
    channel.value = "b1";
    setActiveRelay(COMMUNITY_A);
    channel.value = "a1";
    await flushPromises();
    expect(view.api.access.value).toMatchObject({ status: "member", role: "admin" });
  });
});

describe("17/18. the access bar (desktop + mobile share it)", () => {
  const bar = (status: "unknown" | "checking" | "member" | "not_member" | "error", mobile = false) =>
    mount(ChannelAccessBar, { props: { access: { status, role: null, rechecking: false, source: null }, mobile } });

  it("Join appears ONLY for not_member", () => {
    expect(bar("not_member").find("[data-testid=channel-join]").exists()).toBe(true);
    for (const status of ["unknown", "checking", "member", "error"] as const) {
      expect(bar(status).find("[data-testid=channel-join]").exists()).toBe(false);
      expect(bar(status).text()).not.toContain("not a member");
    }
  });

  it("checking is silent for a fast open, then shows a neutral line", async () => {
    vi.useFakeTimers();
    const w = bar("checking");
    expect(w.find("[data-testid=channel-access-checking]").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(450);
    expect(w.find("[data-testid=channel-access-checking]").text()).toContain("Checking channel access");
  });

  it("error offers retry, not Join", async () => {
    const w = bar("error", true);
    await w.find("[data-testid=channel-access-retry]").trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
  });
});
