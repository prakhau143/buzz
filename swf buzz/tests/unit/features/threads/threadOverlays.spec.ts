import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { useThread } from "@/features/threads/useThread";
import type { ThreadData } from "@/features/threads/ThreadService";
import type { TimelineEvent } from "@/features/messages/MessageService";
import type { Message } from "@/types/domain";

/**
 * Bug (open item 2 in the Phase 4 run state): the thread panel rendered stale
 * text after an edit and kept showing deleted replies.
 *
 * Root cause was structural, not a missed call. Replies are found by `#e`
 * against the ROOT, but an edit or deletion of a REPLY carries `e` = that
 * reply's own id — so a root-anchored query and subscription are blind to them
 * by construction. `ThreadService` also filtered to renderable message kinds,
 * discarding the root's own overlays even when they did arrive.
 *
 * These tests drive the real `useThread` against a real QueryClient with only
 * `ThreadService` mocked, so the overlay folding under test is the shipped code
 * path. The overlay mechanics themselves are the shared ones from
 * `features/messages/messageOverlay` — covered separately; what is asserted
 * here is that the thread actually applies them.
 */
const fetchThread = vi.fn();
const subscribeToThread = vi.fn();
let emit: ((event: TimelineEvent) => void) | null = null;
const closeSub = vi.fn();

vi.mock("@/features/threads/ThreadService", () => ({
  threadService: {
    fetchThread: (...a: unknown[]) => fetchThread(...a),
    subscribeToThread: (
      _rootId: string,
      _channelId: string,
      _since: number,
      onEvent: (event: TimelineEvent) => void,
    ) => {
      emit = onEvent;
      subscribeToThread();
      return { close: closeSub };
    },
  },
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const CHANNEL = "channel-1";
const ROOT = "root-1";
const AUTHOR = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const ADMIN = "ef".repeat(32);

function message(id: string, over: Partial<Message> = {}): Message {
  return {
    id,
    channelId: CHANNEL,
    authorPubkey: AUTHOR,
    content: `content of ${id}`,
    createdAt: 100,
    thread: {},
    mentions: [],
    reactions: [],
    attachments: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    ...over,
  };
}

const reply = (id: string, over: Partial<Message> = {}) =>
  message(id, { thread: { rootId: ROOT, parentId: ROOT }, ...over });

function seedFetch(data: Partial<ThreadData> = {}): void {
  fetchThread.mockResolvedValue({
    root: message(ROOT),
    replies: [reply("r1", { createdAt: 110 }), reply("r2", { createdAt: 120 })],
    summary: null,
    edits: [],
    deletes: [],
    ...data,
  } satisfies ThreadData);
}

/** Mounts the composable and waits for its query to settle. */
async function openThread(rootId: string = ROOT) {
  let api!: ReturnType<typeof useThread>;
  mount(
    defineComponent({
      setup() {
        api = useThread(() => rootId);
        return () => null;
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );
  await vi.waitUntil(() => api.data.value !== undefined, { timeout: 2000 });
  await nextTick();
  return api;
}

const contentOf = (api: ReturnType<typeof useThread>, id: string) =>
  api.data.value?.replies.find((m) => m.id === id)?.content;
const replyIds = (api: ReturnType<typeof useThread>) =>
  (api.data.value?.replies ?? []).map((m) => m.id);

beforeEach(() => {
  queryClient.clear();
  fetchThread.mockReset();
  subscribeToThread.mockReset();
  closeSub.mockReset();
  emit = null;
});

describe("thread replies honour edit overlays", () => {
  it("renders the edited text for a reply edited before the thread was opened", async () => {
    seedFetch({
      edits: [
        {
          eventId: "e1",
          targetId: "r1",
          authorPubkey: AUTHOR,
          content: "edited text",
          createdAt: 200,
        },
      ],
    });

    const api = await openThread();

    // Before the fix this was "content of r1" — the fetch discarded overlay kinds.
    expect(contentOf(api, "r1")).toBe("edited text");
    expect(api.data.value?.replies.find((m) => m.id === "r1")?.editedAt).toBe(200);
    expect(contentOf(api, "r2")).toBe("content of r2");
  });

  it("applies an edit that arrives live, after the thread is already open", async () => {
    seedFetch();
    const api = await openThread();
    expect(contentOf(api, "r1")).toBe("content of r1");

    emit!({
      type: "edit",
      edit: {
        eventId: "e1",
        targetId: "r1",
        authorPubkey: AUTHOR,
        content: "live edit",
        createdAt: 300,
      },
    });
    await nextTick();

    expect(contentOf(api, "r1")).toBe("live edit");
  });

  it("keeps the newest edit when an older one arrives afterwards (out-of-order backfill)", async () => {
    seedFetch();
    const api = await openThread();

    emit!({
      type: "edit",
      edit: { eventId: "e2", targetId: "r1", authorPubkey: AUTHOR, content: "newer", createdAt: 300 },
    });
    emit!({
      type: "edit",
      edit: { eventId: "e1", targetId: "r1", authorPubkey: AUTHOR, content: "older", createdAt: 200 },
    });
    await nextTick();

    expect(contentOf(api, "r1")).toBe("newer");
  });

  it("edits the ROOT message too, not only the replies", async () => {
    seedFetch({
      edits: [
        {
          eventId: "e1",
          targetId: ROOT,
          authorPubkey: AUTHOR,
          content: "edited root",
          createdAt: 200,
        },
      ],
    });

    const api = await openThread();

    expect(api.data.value?.root?.content).toBe("edited root");
  });
});

describe("thread replies honour delete overlays", () => {
  it("drops a reply self-deleted (kind:5) by its own author", async () => {
    seedFetch({
      deletes: [{ targetId: "r1", authorPubkey: AUTHOR, isAdminDelete: false }],
    });

    const api = await openThread();

    expect(replyIds(api)).toEqual(["r2"]);
  });

  it("drops a reply removed by an admin (kind:9005) even though the author differs", async () => {
    seedFetch({
      deletes: [{ targetId: "r1", authorPubkey: ADMIN, isAdminDelete: true }],
    });

    const api = await openThread();

    expect(replyIds(api)).toEqual(["r2"]);
  });

  it("IGNORES a kind:5 whose author is not the reply's author — a forged self-delete", async () => {
    seedFetch({
      deletes: [{ targetId: "r1", authorPubkey: OTHER, isAdminDelete: false }],
    });

    const api = await openThread();

    // The relay should never serve this; trusting it would be client-side
    // deletion forgery, so the row stays.
    expect(replyIds(api)).toEqual(["r1", "r2"]);
  });

  it("removes a reply deleted live, after the thread is open", async () => {
    seedFetch();
    const api = await openThread();
    expect(replyIds(api)).toEqual(["r1", "r2"]);

    emit!({ type: "delete", del: { targetId: "r2", authorPubkey: AUTHOR, isAdminDelete: false } });
    await nextTick();

    expect(replyIds(api)).toEqual(["r1"]);
  });

  it("removes the ROOT when the root itself is deleted", async () => {
    seedFetch({
      deletes: [{ targetId: ROOT, authorPubkey: AUTHOR, isAdminDelete: false }],
    });

    const api = await openThread();

    expect(api.data.value?.root).toBeNull();
  });
});

describe("overlay scoping", () => {
  it("ignores an overlay targeting a message outside this thread", async () => {
    seedFetch();
    const api = await openThread();

    // The subscription is channel-filtered, so overlays for unrelated messages
    // are delivered by design. They must be inert, not corrupting.
    emit!({
      type: "edit",
      edit: {
        eventId: "e1",
        targetId: "some-other-message",
        authorPubkey: AUTHOR,
        content: "not ours",
        createdAt: 300,
      },
    });
    emit!({
      type: "delete",
      del: { targetId: "another-message", authorPubkey: AUTHOR, isAdminDelete: true },
    });
    await nextTick();

    expect(replyIds(api)).toEqual(["r1", "r2"]);
    expect(contentOf(api, "r1")).toBe("content of r1");
  });

  it("does not render a base message from the same channel that belongs to no thread", async () => {
    seedFetch();
    const api = await openThread();

    emit!({ type: "message", message: message("unrelated", { createdAt: 130 }) });
    await nextTick();

    expect(replyIds(api)).toEqual(["r1", "r2"]);
  });

  it("still adds a genuine new reply arriving live", async () => {
    seedFetch();
    const api = await openThread();

    emit!({ type: "message", message: reply("r3", { createdAt: 130 }) });
    await nextTick();

    expect(replyIds(api)).toEqual(["r1", "r2", "r3"]);
  });
});
