import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  clearProfileCache,
  hasIdentityProfileAnywhere,
  rememberProfileEvent,
  resolveIdentityProfile,
} from "@/features/profile/identityProfile";
import { addCommunity, clearCommunitiesForTests } from "@/features/communities/relayCommunities";
import { installFakeSigner, json, removeFakeSigner } from "../../helpers/fakeSigner";
import type { RawNostrEvent } from "@/protocol/types";

/**
 * A profile belongs to the IDENTITY, not to a community. Each community is a
 * relay tenant with its own event store, so a kind:0 published in one is absent
 * from the others — which is why onboarding used to ask again on every entry.
 */
const ME = "ab".repeat(32);

const fetchOnceMock = vi.fn();
vi.mock("@/services/relayQuery", () => ({
  fetchEventsOnce: (...args: unknown[]) => fetchOnceMock(...args),
}));
const publishMock = vi.fn();
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: { publish: (...args: unknown[]) => publishMock(...args) },
}));

function profileEvent(name: string, createdAt: number): RawNostrEvent {
  return {
    id: `${name}-${createdAt}`,
    pubkey: ME,
    kind: 0,
    created_at: createdAt,
    content: JSON.stringify({ display_name: name, name }),
    tags: [],
    sig: "s".repeat(128),
  } as RawNostrEvent;
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  clearCommunitiesForTests();
  clearProfileCache(ME);
  fetchOnceMock.mockReset();
  fetchOnceMock.mockResolvedValue([]);
  publishMock.mockReset();
  publishMock.mockResolvedValue("");
  installFakeSigner(ME);
  vi.unstubAllGlobals();
});
afterEach(() => {
  removeFakeSigner();
  vi.unstubAllGlobals();
});

describe("resolveIdentityProfile — searches every community, newest wins", () => {
  it("uses the profile from the community currently open, without asking anywhere else", async () => {
    addCommunity("ws://other.localhost:3000", "Other");
    fetchOnceMock.mockResolvedValue([profileEvent("Prakhar Mittal", 500)]);
    const otherRelay = vi.fn();
    vi.stubGlobal("fetch", otherRelay);

    const resolved = await resolveIdentityProfile(ME);

    expect(resolved.profile?.displayName).toBe("Prakhar Mittal");
    expect(resolved.presentInCurrentCommunity).toBe(true);
    expect(otherRelay).not.toHaveBeenCalled(); // no need to look elsewhere
  });

  it("finds a profile published in ANOTHER community when the open one has none", async () => {
    addCommunity("ws://other.localhost:3000", "Other");
    fetchOnceMock.mockResolvedValue([]); // nothing here
    vi.stubGlobal("fetch", vi.fn(async () => json([profileEvent("Prakhar Mittal", 500)])));

    const resolved = await resolveIdentityProfile(ME);

    expect(resolved.profile?.displayName).toBe("Prakhar Mittal");
    expect(resolved.presentInCurrentCommunity).toBe(false);
    expect(resolved.event?.created_at).toBe(500);
  });

  it("picks the NEWEST event when several communities disagree", async () => {
    addCommunity("ws://a.localhost:3000", "A");
    addCommunity("ws://b.localhost:3000", "B");
    fetchOnceMock.mockResolvedValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        json([url.includes("//b.") ? profileEvent("Newer Name", 900) : profileEvent("Older Name", 100)]),
      ),
    );

    const resolved = await resolveIdentityProfile(ME);

    expect(resolved.profile?.displayName).toBe("Newer Name");
    expect(resolved.event?.created_at).toBe(900);
  });

  it("a community that is unreachable, refuses us, or no longer exists contributes nothing", async () => {
    addCommunity("ws://gone.localhost:3000", "Gone");
    fetchOnceMock.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "not found" }, 404)));

    const resolved = await resolveIdentityProfile(ME);

    expect(resolved.event).toBeNull();
    expect(resolved.profile).toBeNull();
  });

  it("caches the resolved event per pubkey, so the next community resolves it without a request", async () => {
    fetchOnceMock.mockResolvedValue([profileEvent("Prakhar Mittal", 500)]);
    await resolveIdentityProfile(ME);

    // Now nothing is reachable at all — the cache still answers.
    fetchOnceMock.mockResolvedValue([]);
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", offline);

    const again = await resolveIdentityProfile(ME);
    expect(again.profile?.displayName).toBe("Prakhar Mittal");
  });

  it("a freshly published profile is remembered immediately", async () => {
    rememberProfileEvent(profileEvent("Just Saved", 700));
    fetchOnceMock.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => json([])));

    expect((await resolveIdentityProfile(ME)).profile?.displayName).toBe("Just Saved");
  });
});

describe("hasIdentityProfileAnywhere — the onboarding question", () => {
  it("is false only when this identity has no profile in any community", async () => {
    fetchOnceMock.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => json([])));
    expect(await hasIdentityProfileAnywhere(ME)).toBe(false);
  });

  it("is true when a profile exists elsewhere — the setup screen is skipped", async () => {
    addCommunity("ws://other.localhost:3000", "Other");
    fetchOnceMock.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => json([profileEvent("Prakhar Mittal", 500)])));

    expect(await hasIdentityProfileAnywhere(ME)).toBe(true);
  });

  it("REPLICATES the same signed event into a community that lacks it — never a re-signed edit", async () => {
    addCommunity("ws://other.localhost:3000", "Other");
    const published = profileEvent("Prakhar Mittal", 500);
    fetchOnceMock.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => json([published])));

    expect(await hasIdentityProfileAnywhere(ME)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(publishMock).toHaveBeenCalledTimes(1);
    // byte-identical: same id and signature, so the relay sees a replication
    expect(publishMock.mock.calls[0][0]).toEqual(published);
  });

  it("does NOT republish when the open community already has the profile", async () => {
    fetchOnceMock.mockResolvedValue([profileEvent("Prakhar Mittal", 500)]);
    expect(await hasIdentityProfileAnywhere(ME)).toBe(true);
    expect(publishMock).not.toHaveBeenCalled();
  });
});
