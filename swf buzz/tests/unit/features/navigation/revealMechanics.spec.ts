/**
 * The reveal mechanics used by the mobile deep links: MessageList's existing
 * `highlightId` (already loaded / pages older history / gives up — bounded),
 * ThreadPanel's new `highlightId` (root or reply), and the thread reveal's
 * failure paths.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { ref } from "vue";
import type { Message } from "@/types/domain";

vi.mock("@/composables/useProfile", async () => {
  const { computed } = await import("vue");
  const { ref: r } = await import("vue");
  return {
    useProfile: () => ({ data: computed(() => undefined) }),
    useProfileMap: () => ({ profiles: r(new Map()), displayNames: r(new Map()) }),
  };
});
const thread = ref<{ root: Message; replies: Message[] } | null>(null);
const threadLoading = ref(false);
const threadError = ref(false);
vi.mock("@/features/threads/useThread", () => ({
  useThread: () => ({ data: thread, isLoading: threadLoading, isError: threadError, refetch: vi.fn() }),
}));
vi.mock("@/features/messages/useSendMessage", () => ({ useSendMessage: () => ({ send: vi.fn(), isSending: ref(false), error: ref(null) }) }));

const MessageList = (await import("@/components/MessageList.vue")).default;
const ThreadPanel = (await import("@/components/ThreadPanel.vue")).default;

let n = 0;
const msg = (over: Partial<Message> = {}): Message => ({
  id: (++n).toString(16).padStart(64, "0"),
  channelId: "c1",
  authorPubkey: "a".repeat(64),
  content: `message ${n}`,
  createdAt: 1_700_000_000 + n,
  thread: {},
  mentions: [],
  reactions: [],
  status: "sent",
  isSystemMessage: false,
  isAgentMessage: false,
  attachments: [],
  ...over,
});

const scrolled: string[] = [];
beforeEach(() => {
  setActivePinia(createPinia());
  scrolled.length = 0;
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.getAttribute("data-message-id") ?? "");
  };
  thread.value = null;
  threadLoading.value = false;
  threadError.value = false;
  document.body.innerHTML = "";
});

function mountList(props: Record<string, unknown>) {
  return mount(MessageList, {
    props: { isLoading: false, isError: false, ...props },
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
  });
}

describe("MessageList reveal (channel / DM)", () => {
  it("target already loaded: centred, highlighted, reported found — no history fetched", async () => {
    const messages = [msg(), msg(), msg()];
    const w = mountList({ messages, highlightId: messages[1].id, hasOlderMessages: true });
    await flushPromises();
    expect(scrolled).toContain(messages[1].id);
    expect(document.querySelector(`[data-message-id="${messages[1].id}"]`)?.classList.contains("is-highlighted")).toBe(true);
    expect(w.emitted("highlight-done")?.[0]).toEqual([true]);
    expect(w.emitted("load-older")).toBeUndefined();
  });

  it("target older than the loaded window: pages older history through the EXISTING load-older, then reveals it", async () => {
    const older = msg();
    const recent = [msg(), msg()];
    const w = mountList({ messages: recent, highlightId: older.id, hasOlderMessages: true });
    await flushPromises();
    expect(w.emitted("load-older")).toHaveLength(1);
    expect(w.emitted("highlight-done")).toBeUndefined();
    await w.setProps({ isLoadingOlder: true });
    await w.setProps({ messages: [older, ...recent], isLoadingOlder: false });
    await flushPromises();
    expect(w.emitted("highlight-done")?.[0]).toEqual([true]);
    expect(scrolled).toContain(older.id);
  });

  it("history exhausted without the target (deleted / inaccessible): reports not found, no loop", async () => {
    const w = mountList({ messages: [msg(), msg()], highlightId: "f".repeat(64), hasOlderMessages: false });
    await flushPromises();
    expect(w.emitted("highlight-done")?.[0]).toEqual([false]);
    expect(w.emitted("load-older")).toBeUndefined();
  });

  it("bounded: never pages more than 10 times looking for a target", async () => {
    let messages = [msg()];
    const w = mountList({ messages, highlightId: "f".repeat(64), hasOlderMessages: true });
    for (let i = 0; i < 15; i++) {
      await flushPromises();
      await w.setProps({ isLoadingOlder: true });
      messages = [msg(), ...messages];
      await w.setProps({ messages, isLoadingOlder: false });
    }
    await flushPromises();
    expect((w.emitted("load-older") ?? []).length).toBeLessThanOrEqual(10);
    expect(w.emitted("highlight-done")?.at(-1)).toEqual([false]);
  });
});

describe("ThreadPanel reveal (thread replies)", () => {
  function mountThread(highlightId: string | null) {
    return mount(ThreadPanel, {
      props: { rootEventId: "root", channelId: "c1", highlightId, hideHeader: true },
      attachTo: document.body,
      global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { enabled: false } } }) }]] },
    });
  }

  it("reveals the exact reply once the thread has loaded", async () => {
    const root = msg();
    const replies = [msg({ thread: { rootId: root.id, parentId: root.id } }), msg({ thread: { rootId: root.id, parentId: root.id } })];
    threadLoading.value = true;
    const w = mountThread(replies[1].id);
    await flushPromises();
    expect(w.emitted("highlight-done")).toBeUndefined(); // waits for the thread
    thread.value = { root, replies };
    threadLoading.value = false;
    await flushPromises();
    expect(scrolled).toContain(replies[1].id);
    expect(document.querySelector(`[data-message-id="${replies[1].id}"]`)?.classList.contains("is-highlighted")).toBe(true);
    expect(w.emitted("highlight-done")).toEqual([[true]]);
  });

  it("the root itself can be the target", async () => {
    const root = msg();
    thread.value = { root, replies: [] };
    const w = mountThread(root.id);
    await flushPromises();
    expect(w.emitted("highlight-done")).toEqual([[true]]);
  });

  it("a reply that isn't in the thread (deleted) → not found, once", async () => {
    thread.value = { root: msg(), replies: [msg()] };
    const w = mountThread("f".repeat(64));
    await flushPromises();
    thread.value = { ...thread.value! }; // a later refresh must not re-report or re-scroll
    await flushPromises();
    expect(w.emitted("highlight-done")).toEqual([[false]]);
  });

  it("the thread can't be loaded (no access) → not found", async () => {
    threadError.value = true;
    const w = mountThread("f".repeat(64));
    await flushPromises();
    expect(w.emitted("highlight-done")).toEqual([[false]]);
  });

  it("desktop (no highlightId): no reveal behaviour at all", async () => {
    thread.value = { root: msg(), replies: [msg()] };
    const w = mountThread(null);
    await flushPromises();
    expect(w.emitted("highlight-done")).toBeUndefined();
    expect(scrolled).toEqual([]);
  });
});
