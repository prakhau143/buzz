import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useModerationActions } from "@/features/moderation/useModerationActions";

/**
 * Bug: a ban/unban/timeout/untimeout invalidated only
 * `moderationRestrictions`, never `moderationAudit`. Every one of those actions
 * writes a `moderation_actions` row that the audit log reads, so the Moderation
 * tab kept showing pre-action data until its 15s `staleTime` lapsed or the modal
 * was remounted — a ban looked like it had done nothing.
 *
 * `useModerationQueue.resolveReport` already invalidated the audit key, which is
 * what made the omission visible: resolving a report refreshed the log, banning
 * someone did not.
 *
 * These tests drive the real composable against a real QueryClient with only the
 * relay calls mocked, and assert on the *keys invalidated* rather than on
 * rendered output — the rendering was never wrong, the cache bookkeeping was.
 */
const banMember = vi.fn().mockResolvedValue(undefined);
const unbanMember = vi.fn().mockResolvedValue(undefined);
const timeoutMember = vi.fn().mockResolvedValue(undefined);
const untimeoutMember = vi.fn().mockResolvedValue(undefined);

vi.mock("@/features/moderation/ModerationService", () => ({
  moderationService: {
    banMember: (...a: unknown[]) => banMember(...a),
    unbanMember: (...a: unknown[]) => unbanMember(...a),
    timeoutMember: (...a: unknown[]) => timeoutMember(...a),
    untimeoutMember: (...a: unknown[]) => untimeoutMember(...a),
  },
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

/**
 * `useMutation` resolves its client through Vue's injection context, so the
 * composable has to run inside a real component rather than be called bare.
 */
function withModerationActions(): ReturnType<typeof useModerationActions> {
  let api!: ReturnType<typeof useModerationActions>;
  mount(
    defineComponent({
      setup() {
        api = useModerationActions();
        return () => null;
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  return api;
}

const TARGET = "ab".repeat(32);

/** Serialised keys passed to `invalidateQueries`, in call order. */
let invalidated: string[] = [];

beforeEach(() => {
  invalidated = [];
  vi.clearAllMocks();
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(((filters: { queryKey?: unknown }) => {
    invalidated.push(JSON.stringify(filters?.queryKey));
    return Promise.resolve();
  }) as typeof queryClient.invalidateQueries);
});

const AUDIT = JSON.stringify(queryKeys.moderationAudit());
const RESTRICTIONS = JSON.stringify(queryKeys.moderationRestrictions());

describe("moderation actions invalidate the audit log", () => {
  it("ban invalidates both restrictions and the audit log", async () => {
    const { ban } = withModerationActions();
    await ban({ pubkey: TARGET, targetRole: "member", actingRole: "owner" });

    expect(banMember).toHaveBeenCalledTimes(1);
    expect(invalidated).toContain(RESTRICTIONS);
    expect(invalidated).toContain(AUDIT);
  });

  it("unban invalidates both", async () => {
    const { unban } = withModerationActions();
    await unban({ pubkey: TARGET, actingRole: "owner" });

    expect(unbanMember).toHaveBeenCalledTimes(1);
    expect(invalidated).toContain(RESTRICTIONS);
    expect(invalidated).toContain(AUDIT);
  });

  it("timeout invalidates both", async () => {
    const { timeout } = withModerationActions();
    await timeout({
      pubkey: TARGET,
      targetRole: "member",
      actingRole: "admin",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });

    expect(timeoutMember).toHaveBeenCalledTimes(1);
    expect(invalidated).toContain(RESTRICTIONS);
    expect(invalidated).toContain(AUDIT);
  });

  it("untimeout invalidates both", async () => {
    const { untimeout } = withModerationActions();
    await untimeout({ pubkey: TARGET, actingRole: "admin" });

    expect(untimeoutMember).toHaveBeenCalledTimes(1);
    expect(invalidated).toContain(RESTRICTIONS);
    expect(invalidated).toContain(AUDIT);
  });

  /**
   * The specific regression: restrictions alone is what the buggy version did,
   * so a test asserting only "something was invalidated" would have passed
   * against the bug. This pins the audit key explicitly.
   */
  it("a failed action invalidates nothing", async () => {
    banMember.mockRejectedValueOnce(new Error("forbidden: not a moderator"));
    const { ban } = withModerationActions();

    await expect(ban({ pubkey: TARGET, targetRole: "member", actingRole: null })).rejects.toThrow(
      /forbidden/,
    );
    expect(invalidated).toEqual([]);
  });
});
