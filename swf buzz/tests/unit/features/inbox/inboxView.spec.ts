/**
 * The Inbox workspace route: a full view (no dialog), URL-backed selection,
 * OLD BUZZ auto-select on wide layouts, mark-read on select, the unread-only
 * rule that keeps the selection visible, narrow single-pane with Back, and
 * "Open in channel" targets.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, h, ref } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { InboxItem } from "@/features/inbox/inboxModel";

function item(key: string, over: Partial<InboxItem> = {}): InboxItem {
  return {
    key,
    event: { id: `${key}-id`, pubkey: "b".repeat(64), created_at: 100, kind: 9, tags: [], content: `${key} text`, sig: "s" },
    type: "mention",
    channelId: "ch-1",
    rootId: null,
    createdAt: 100,
    count: 1,
    mentionsMe: true,
    ...over,
  };
}

const items = ref<InboxItem[]>([]);
const unreadKeys = ref(new Set<string>());
const markRead = vi.fn((i: InboxItem) => unreadKeys.value.delete(i.key));
vi.mock("@/features/inbox/useInboxFeed", () => ({
  useInboxFeed: () => ({
    items: computed(() => items.value),
    unread: (i: InboxItem) => unreadKeys.value.has(i.key),
    isLoading: ref(false),
    isError: ref(false),
    partialError: ref(false),
    refetch: vi.fn(),
    markRead,
    markUnread: vi.fn(),
    markAllRead: vi.fn(),
  }),
}));
vi.mock("@/features/channels/useChannels", () => ({ useChannels: () => ({ data: ref([{ id: "ch-1", name: "SWF Project" }]) }) }));
vi.mock("@/composables/useProfile", () => ({
  useProfileMap: () => ({ profiles: ref(new Map()), displayNames: ref(new Map([["b".repeat(64), "Devankit"]])) }),
}));

/** Detail-pane stand-in: renders the title it receives and exposes its two events. */
const DetailStub = {
  props: { item: { type: Object, default: null }, title: { type: String, default: "" }, narrow: { type: Boolean, default: false } },
  emits: ["back", "open-source"],
  setup(p: { title: string }, { emit }: { emit: (e: "back" | "open-source") => void }) {
    return () =>
      h("div", { "data-stub": "InboxDetailPane" }, [
        p.title,
        h("button", { "data-testid": "stub-back", onClick: () => emit("back") }),
        h("button", { "data-testid": "stub-open", onClick: () => emit("open-source") }),
      ]);
  },
};
/** AppShell stand-in: just renders its three slots. */
const ShellStub = {
  setup(_: unknown, { slots }: { slots: Record<string, (() => unknown) | undefined> }) {
    return () => h("div", [slots.sidebar?.(), slots.main?.(), slots.details?.()] as never);
  },
};

const InboxView = (await import("@/views/InboxView.vue")).default;
const { useReadStateStore } = await import("@/stores/readState");
void useReadStateStore;

let router: Router;
async function mountView(query: Record<string, string> = {}) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/inbox", name: "inbox", component: InboxView },
      { path: "/channels", name: "channels", component: { render: () => null } },
      { path: "/dm", name: "dm", component: { render: () => null } },
    ],
  });
  await router.push({ name: "inbox", query });
  const w = mount(InboxView, {
    attachTo: document.body,
    global: {
      plugins: [router],
      stubs: {
        AppShell: ShellStub,
        AppSidebar: true,
        UserProfilePanel: true,
        InboxDetailPane: DetailStub,
      },
    },
  });
  await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  items.value = [item("a"), item("b"), item("c", { type: "dm", channelId: "dm-1" })];
  unreadKeys.value = new Set(["a", "b"]);
  markRead.mockClear();
});

describe("InboxView", () => {
  it("is a workspace, not a dialog", async () => {
    const w = await mountView();
    expect(w.find("[data-testid=inbox-workspace]").exists()).toBe(true);
    expect(document.querySelector("[role=dialog], .overlay-backdrop")).toBeNull();
  });

  it("wide: auto-selects the first row, puts it in the URL and marks it read", async () => {
    const w = await mountView();
    expect(router.currentRoute.value.query.item).toBe("a");
    expect(markRead).toHaveBeenCalledWith(expect.objectContaining({ key: "a" }));
    expect(w.find("[data-stub=InboxDetailPane]").text()).toContain("Message in #SWF Project");
  });

  it("clicking another row selects it and marks it read", async () => {
    const w = await mountView();
    await w.findAll("[data-testid=inbox-row]")[1].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.item).toBe("b");
    expect(markRead).toHaveBeenLastCalledWith(expect.objectContaining({ key: "b" }));
  });

  it("an explicit ?item survives load (no auto-select over it)", async () => {
    await mountView({ item: "c" });
    expect(router.currentRoute.value.query.item).toBe("c");
  });

  it("unread only: shows unread rows, and the selected row stays visible after it is read (no cascade)", async () => {
    const w = await mountView();
    // "a" was auto-selected and marked read.
    await w.find("[data-testid=inbox-options]").trigger("click");
    (document.querySelector("[data-testid=inbox-unread-only]") as HTMLElement).click();
    await flushPromises();
    const rows = w.findAll("[data-testid=inbox-row]").map((r) => r.text());
    expect(rows.some((t) => t.includes("a text"))).toBe(true); // selected, kept
    expect(rows.some((t) => t.includes("b text"))).toBe(true); // unread
    expect(rows.some((t) => t.includes("c text"))).toBe(false); // read, not selected
    expect(markRead).toHaveBeenCalledTimes(1); // nothing cascaded
  });

  it("Open in channel targets the real source with the message id (DMs go to the DM view)", async () => {
    const w = await mountView({ item: "c" });
    await w.find("[data-testid=stub-open]").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("dm");
    expect(router.currentRoute.value.query).toMatchObject({ conversationId: "dm-1", messageId: "c-id" });
  });

  it("the filter dropdown offers SWF's options (no Agents / Projects) and filters the list", async () => {
    items.value = [item("m"), item("d", { type: "dm", channelId: "dm-1", mentionsMe: false })];
    const w = await mountView();
    await w.find("[data-testid=inbox-filter]").trigger("click");
    const labels = [...document.querySelectorAll("[role=menuitemradio]")].map((b) => b.textContent?.trim().replace("✓", ""));
    expect(labels).toEqual(["All", "Mentions", "Threads", "Needs action", "Reminders"]);
    (document.querySelector("[data-testid=inbox-filter-mentions]") as HTMLElement).click();
    await flushPromises();
    expect(w.findAll("[data-testid=inbox-row]")).toHaveLength(1);
  });
});

describe("InboxView — narrow (single pane)", () => {
  it("under 600px: no auto-select; a row opens the detail with Back, Back returns to the list", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() {
          this.cb([{ contentRect: { width: 500 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        disconnect() {}
      },
    );
    const w = await mountView();
    expect(router.currentRoute.value.query.item).toBeUndefined();
    expect(w.find("[data-stub=InboxDetailPane]").exists()).toBe(false);
    expect(w.find("[data-testid=inbox-resize]").exists()).toBe(false);

    await w.findAll("[data-testid=inbox-row]")[0].trigger("click");
    await flushPromises();
    expect(w.find("[data-testid=inbox-rows]").exists()).toBe(false); // list hidden
    expect(w.find("[data-stub=InboxDetailPane]").exists()).toBe(true);

    await w.find("[data-testid=stub-back]").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query.item).toBeUndefined();
    expect(w.find("[data-testid=inbox-rows]").exists()).toBe(true);
    vi.unstubAllGlobals();
  });
});
