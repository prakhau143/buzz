/**
 * U1a — profile lookup must not be N+1.
 *
 * Before: `fetchProfile` issued TWO `fetchEventsOnce` calls per pubkey (kind:0
 * + agent check), and list views called it once per row — a 50-member list cost
 * ~100 relay subscriptions (docs/U0_UI_PROFILE_AUDIT.md §2).
 *
 * These assert the actual request COUNT, not just the returned data, because
 * the data was already correct — only the cost was wrong.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NostrFilter, RawNostrEvent } from "@/protocol/types";
import { KIND_MANAGED_AGENT, KIND_PROFILE_METADATA } from "@/protocol/kinds";

/** Every call is one relay subscription (one REQ, one EOSE), however many filters it carries. */
const calls: NostrFilter[][] = [];
let respond: (filters: NostrFilter[]) => RawNostrEvent[] = () => [];

vi.mock("@/services/relayQuery", () => ({
  fetchEventsOnce: (filters: NostrFilter[]) => {
    calls.push(filters);
    return Promise.resolve(respond(filters));
  },
}));

const { profileService } = await import("@/services/ProfileService");
// Profiles are an identity-level registry (newest seen wins, kept across
// communities); each test starts from a fresh one, as a new sign-in does.
const { clearProfileStore } = await import("@/features/profile/profileStore");

const KEY = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

function profileEvent(pubkey: string, displayName: string): RawNostrEvent {
  return {
    id: `p-${pubkey.slice(0, 4)}`,
    pubkey,
    created_at: 100,
    kind: KIND_PROFILE_METADATA,
    tags: [],
    content: JSON.stringify({ display_name: displayName }),
    sig: "s".repeat(128),
  };
}

function agentEvent(subject: string): RawNostrEvent {
  return {
    id: `a-${subject.slice(0, 4)}`,
    pubkey: "f".repeat(64),
    created_at: 100,
    kind: KIND_MANAGED_AGENT,
    tags: [["d", subject]],
    content: "{}",
    sig: "s".repeat(128),
  };
}

beforeEach(() => {
  clearProfileStore();
  calls.length = 0;
  respond = () => [];
});

describe("fetchProfiles — one round trip for many people", () => {
  it("resolves a 50-member list in ONE relay request, not 100", async () => {
    const pubkeys = Array.from({ length: 50 }, (_, i) => KEY(i));
    respond = () => pubkeys.map((pk, i) => profileEvent(pk, `Member ${i}`));

    const resolved = await profileService.fetchProfiles(pubkeys);

    expect(calls.length, "a 50-member list must cost exactly one subscription").toBe(1);
    expect(resolved.size).toBe(50);
    expect(resolved.get(KEY(7))?.displayName).toBe("Member 7");
  });

  it("asks both questions in the SAME subscription", async () => {
    await profileService.fetchProfiles([KEY(1), KEY(2)]);
    expect(calls).toHaveLength(1);
    const [filters] = calls;
    const kinds = filters.flatMap((f) => f.kinds ?? []);
    expect(kinds).toContain(KIND_PROFILE_METADATA);
    expect(kinds).toContain(KIND_MANAGED_AGENT);
  });

  it("deduplicates pubkeys before querying", async () => {
    await profileService.fetchProfiles([KEY(1), KEY(1), KEY(2), KEY(1)]);
    const authors = calls[0].find((f) => f.kinds?.includes(KIND_PROFILE_METADATA))?.authors ?? [];
    expect(authors).toEqual([KEY(1), KEY(2)]);
  });

  it("makes NO relay request for an empty list", async () => {
    const resolved = await profileService.fetchProfiles([]);
    expect(calls).toHaveLength(0);
    expect(resolved.size).toBe(0);
  });

  it("makes no request when every entry is empty", async () => {
    await profileService.fetchProfiles(["", ""]);
    expect(calls).toHaveLength(0);
  });

  /**
   * The single-pubkey agent filter uses `limit: 1`, which is correct for one
   * subject and silently wrong for a batch — it would cap the whole list at one
   * event and mislabel every other agent as human.
   */
  it("bounds the agent filter by the number of subjects, not 1", async () => {
    const pubkeys = [KEY(1), KEY(2), KEY(3)];
    await profileService.fetchProfiles(pubkeys);
    const agentFilter = calls[0].find((f) => f.kinds?.includes(KIND_MANAGED_AGENT));
    expect(agentFilter?.limit).toBe(3);
    expect(agentFilter?.["#d"]).toEqual(pubkeys);
  });

  it("marks only the pubkeys with an agent record as agents", async () => {
    const [human, agent] = [KEY(1), KEY(2)];
    respond = () => [profileEvent(human, "Human"), profileEvent(agent, "Bot"), agentEvent(agent)];

    const resolved = await profileService.fetchProfiles([human, agent]);
    expect(resolved.get(human)?.isAgent).toBe(false);
    expect(resolved.get(agent)?.isAgent).toBe(true);
  });

  it("falls back to a short pubkey for someone with no profile, without failing the batch", async () => {
    const [withProfile, without] = [KEY(1), KEY(2)];
    respond = () => [profileEvent(withProfile, "Has One")];

    const resolved = await profileService.fetchProfiles([withProfile, without]);
    expect(resolved.get(withProfile)?.displayName).toBe("Has One");
    expect(resolved.get(without)?.displayName).toBe(without.slice(0, 8));
  });

  it("survives malformed profile content", async () => {
    const pubkey = KEY(1);
    respond = () => [{ ...profileEvent(pubkey, "x"), content: "{not json" }];
    const resolved = await profileService.fetchProfiles([pubkey]);
    expect(resolved.get(pubkey)?.displayName).toBe(pubkey.slice(0, 8));
  });

  it("keeps the newest kind:0 when a relay returns more than one version", async () => {
    const pubkey = KEY(1);
    respond = () => [
      { ...profileEvent(pubkey, "Old"), created_at: 100 },
      { ...profileEvent(pubkey, "New"), created_at: 200, id: "newer" },
    ];
    const resolved = await profileService.fetchProfiles([pubkey]);
    expect(resolved.get(pubkey)?.displayName).toBe("New");
  });
});

describe("fetchProfile — the single-pubkey API still works", () => {
  it("returns the profile, now in ONE request instead of two", async () => {
    const pubkey = KEY(9);
    respond = () => [profileEvent(pubkey, "Solo")];

    const profile = await profileService.fetchProfile(pubkey);

    expect(profile.displayName).toBe("Solo");
    expect(calls.length, "the two-call-per-pubkey pattern is gone").toBe(1);
  });

  it("still falls back to a short pubkey when there is no profile", async () => {
    const pubkey = KEY(10);
    const profile = await profileService.fetchProfile(pubkey);
    expect(profile.displayName).toBe(pubkey.slice(0, 8));
    expect(profile.isAgent).toBe(false);
  });
});
