import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KIND_JOB_PROGRESS,
  KIND_JOB_REQUEST,
  KIND_STREAM_MESSAGE,
  KIND_WORKFLOW_APPROVAL_REQUESTED,
} from "@/protocol/kinds";
import type { RawNostrEvent } from "@/protocol/types";

vi.mock("@/services/nip98", () => ({
  buildNip98AuthHeader: vi.fn().mockResolvedValue("Nostr stub"),
}));
vi.mock("@/features/communities/relayCommunities", () => ({
  activeRelayUrl: { value: "ws://relay.test" },
  relayHttpBase: (url: string) => url.replace("ws://", "http://"),
}));

const { inboxService } = await import("@/features/inbox/InboxService");

function event(overrides: Partial<RawNostrEvent> = {}): RawNostrEvent {
  return {
    id: overrides.id ?? "e1",
    pubkey: overrides.pubkey ?? "author",
    created_at: overrides.created_at ?? 100,
    kind: overrides.kind ?? KIND_STREAM_MESSAGE,
    tags: overrides.tags ?? [["h", "chan-1"]],
    content: overrides.content ?? "",
    sig: "sig",
  };
}

function respondWith(events: RawNostrEvent[], status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => events,
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("InboxService — request shape", () => {
  it("sends the feed_types extension for the requested category", async () => {
    respondWith([]);
    await inboxService.fetchFeed("mentions", "pubkey-1");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0].feed_types).toEqual(["mentions"]);
    expect(body[0]["#p"]).toEqual(["pubkey-1"]);
  });

  it("requests `activity` for the agent view, because the relay aliases it", async () => {
    respondWith([]);
    await inboxService.fetchFeed("agent_activity", "pubkey-1");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0].feed_types).toEqual(["activity"]);
  });
});

describe("InboxService — agent vs human partition", () => {
  // The relay returns ONE set for activity and agent_activity. If both views
  // rendered it unfiltered, the same rows would appear under two tab labels.
  const mixed = [
    event({ id: "human", kind: KIND_STREAM_MESSAGE, created_at: 300 }),
    event({ id: "job", kind: KIND_JOB_REQUEST, created_at: 200 }),
    event({ id: "progress", kind: KIND_JOB_PROGRESS, created_at: 100 }),
  ];

  it("shows only agent job events in the agent view", async () => {
    respondWith(mixed);
    const entries = await inboxService.fetchFeed("agent_activity", "p");
    expect(entries.map((e) => e.event.id)).toEqual(["job", "progress"]);
  });

  it("excludes agent job events from the human activity view", async () => {
    respondWith(mixed);
    const entries = await inboxService.fetchFeed("activity", "p");
    expect(entries.map((e) => e.event.id)).toEqual(["human"]);
  });

  it("partitions the set — no entry appears in both views, none is lost", async () => {
    respondWith(mixed);
    const agent = await inboxService.fetchFeed("agent_activity", "p");
    respondWith(mixed);
    const human = await inboxService.fetchFeed("activity", "p");
    const ids = [...agent, ...human].map((e) => e.event.id).sort();
    expect(ids).toEqual(["human", "job", "progress"]);
  });

  it("does not narrow the mentions or needs-action views", async () => {
    respondWith([event({ id: "approval", kind: KIND_WORKFLOW_APPROVAL_REQUESTED })]);
    const entries = await inboxService.fetchFeed("needs_action", "p");
    expect(entries.map((e) => e.event.id)).toEqual(["approval"]);
  });
});

describe("InboxService — results", () => {
  it("orders newest first", async () => {
    respondWith([
      event({ id: "old", created_at: 10 }),
      event({ id: "new", created_at: 90 }),
    ]);
    const entries = await inboxService.fetchFeed("mentions", "p");
    expect(entries.map((e) => e.event.id)).toEqual(["new", "old"]);
  });

  it("deduplicates repeated ids", async () => {
    respondWith([event({ id: "same" }), event({ id: "same" })]);
    expect(await inboxService.fetchFeed("mentions", "p")).toHaveLength(1);
  });

  it("exposes the channel for entries that have one, and omits it otherwise", async () => {
    respondWith([
      event({ id: "in-channel", tags: [["h", "chan-3"]] }),
      event({ id: "global", tags: [] }),
    ]);
    const entries = await inboxService.fetchFeed("mentions", "p");
    expect(entries.find((e) => e.event.id === "in-channel")?.channelId).toBe("chan-3");
    expect(entries.find((e) => e.event.id === "global")?.channelId).toBeUndefined();
  });

  it("surfaces a refusal as a permission error rather than an empty inbox", async () => {
    // An empty list and "you may not read this" must not look identical — the
    // UI needs to say which happened.
    respondWith([], 403);
    await expect(inboxService.fetchFeed("mentions", "p")).rejects.toMatchObject({
      code: "permission_denied",
    });
  });

  it("surfaces an unreachable relay as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(inboxService.fetchFeed("mentions", "p")).rejects.toMatchObject({
      code: "network",
    });
  });
});
