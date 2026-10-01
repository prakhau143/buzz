/**
 * Phase C3 — mobile conversation polish: scroll capture/restore (MessageList +
 * the narrow scroll memory), the initial-load skeleton, the switch overlay,
 * attachment presentation at phone width, and keyboard regression.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { Message } from "@/types/domain";

vi.mock("@/composables/useProfile", async () => {
  const { computed, ref: r } = await import("vue");
  return {
    useProfile: () => ({ data: computed(() => undefined) }),
    useProfileMap: () => ({ profiles: r(new Map()), displayNames: r(new Map()) }),
  };
});
const sw = vi.hoisted(() => ({ retryFailed: vi.fn(async () => true) }));
vi.mock("@/features/communities/useCommunitySwitch", async () => {
  const { ref: r, computed: c } = await import("vue");
  const switchingTo = r<string | null>(null);
  const switchingFrom = r<string | null>(null);
  const error = r<string | null>(null);
  const failed = r<string | null>(null);
  return {
    __state: { switchingTo, switchingFrom, error, failed },
    communitySwitchingTo: c(() => switchingTo.value),
    communitySwitchingFrom: c(() => switchingFrom.value),
    communitySwitchError: c(() => error.value),
    communitySwitchFailedTarget: c(() => failed.value),
    clearCommunitySwitchError: () => {
      error.value = null;
      failed.value = null;
    },
    useCommunitySwitch: () => ({ retryFailed: sw.retryFailed }),
  };
});
vi.mock("@/features/communities/communityIcon", () => ({ fetchCommunityIcon: async () => null }));
vi.mock("@/features/communities/relayCommunities", async () => {
  const { ref: r } = await import("vue");
  return {
    activeRelayUrl: r("wss://a.example.com"),
    communities: r([{ relayUrl: "wss://a.example.com", name: "Alpha" }, { relayUrl: "wss://b.example.com", name: "Beta" }]),
    relayHost: (u: string) => u.replace(/^wss?:\/\//, ""),
  };
});

const MessageList = (await import("@/components/MessageList.vue")).default;
const MobileConversationSkeleton = (await import("@/features/mobile/ui/MobileConversationSkeleton.vue")).default;
const MobileSwitchOverlay = (await import("@/features/mobile/ui/MobileSwitchOverlay.vue")).default;
const { rememberScroll, takeScroll, clearScrollMemoryForTests } = await import("@/features/mobile/scrollMemory");
const { navDirection, startViewportTracking } = await import("@/features/mobile/mobileNav");
const switchState = ((await import("@/features/communities/useCommunitySwitch")) as unknown as {
  __state: Record<"switchingTo" | "switchingFrom" | "error" | "failed", { value: string | null }>;
}).__state;

let n = 0;
const msg = (): Message => ({
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
});

/**
 * jsdom has no layout: give the feed a deterministic one — each row 100px
 * tall, the viewport at top 0, rows positioned by index minus scrollTop.
 */
function fakeLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const list = this.closest(".message-list") as HTMLElement | null;
    if (this.classList.contains("message-list")) return { top: 0, bottom: 600, height: 600 } as DOMRect;
    const id = this.getAttribute("data-message-id");
    if (id && list) {
      const rows = [...list.querySelectorAll("[data-message-id]")];
      const top = rows.indexOf(this) * 100 - list.scrollTop;
      return { top, bottom: top + 100, height: 100 } as DOMRect;
    }
    return { top: 0, bottom: 0, height: 0 } as DOMRect;
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  clearScrollMemoryForTests();
  navDirection.value = "none";
  switchState.switchingTo.value = null;
  switchState.switchingFrom.value = null;
  switchState.error.value = null;
  switchState.failed.value = null;
  sw.retryFailed.mockClear();
  document.body.innerHTML = "";
});
afterEach(() => vi.restoreAllMocks());

function mountList(props: Record<string, unknown>) {
  return mount(MessageList, {
    props: { isLoading: false, isError: false, ...props },
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
  });
}

// ---------------------------------------------------------------------------
describe("scroll capture / restore (MessageList)", () => {
  it("captures the first visible message and its offset from the top", async () => {
    fakeLayout();
    const messages = [msg(), msg(), msg(), msg(), msg()];
    const w = mountList({ messages });
    await flushPromises();
    const el = document.querySelector(".message-list") as HTMLElement;
    el.scrollTop = 250; // row 2 (top 200-250 = -50) is partly visible
    const anchor = (w.vm as unknown as { captureScrollAnchor: () => { id: string; offset: number } }).captureScrollAnchor();
    expect(anchor).toMatchObject({ id: messages[2].id, offset: -50 });
  });

  it("restores that message to the same place instead of opening at the bottom", async () => {
    fakeLayout();
    const messages = [msg(), msg(), msg(), msg(), msg()];
    mountList({ messages, restoreAnchor: { id: messages[3].id, offset: 20, scrollTop: 0 } });
    await flushPromises();
    // row 3 sits at 300; to put it at 20 the feed scrolls by 280
    expect((document.querySelector(".message-list") as HTMLElement).scrollTop).toBe(280);
  });

  it("an anchor that no longer exists (deleted / outside the window) falls back to the normal open", async () => {
    fakeLayout();
    const messages = [msg(), msg()];
    mountList({ messages, restoreAnchor: { id: "f".repeat(64), offset: 0, scrollTop: 999 } });
    await flushPromises();
    const el = document.querySelector(".message-list") as HTMLElement;
    expect(el.scrollTop).not.toBe(999);
  });

  it("desktop (no restoreAnchor) is unchanged: opens at the latest message", async () => {
    fakeLayout();
    const messages = [msg(), msg(), msg()];
    mountList({ messages });
    await flushPromises();
    const el = document.querySelector(".message-list") as HTMLElement;
    expect(el.scrollTop).toBe(el.scrollHeight);
  });
});

describe("scroll memory (thread → back)", () => {
  const anchor = { id: "1".repeat(64), offset: 12, scrollTop: 400 };

  it("restores only when arriving BACK at the same conversation, once", () => {
    rememberScroll("channel", "c1", anchor);
    navDirection.value = "back";
    expect(takeScroll("channel", "c1", { revealing: false })).toEqual(anchor);
    expect(takeScroll("channel", "c1", { revealing: false })).toBeNull(); // consumed
  });

  it("DMs and channels are separate; another conversation gets nothing", () => {
    rememberScroll("dm", "d1", anchor);
    navDirection.value = "back";
    expect(takeScroll("channel", "d1", { revealing: false })).toBeNull();
    expect(takeScroll("dm", "d1", { revealing: false })).toEqual(anchor);
  });

  it("a fresh (forward / tab) arrival discards it: no stale restore after going elsewhere", () => {
    rememberScroll("channel", "c1", anchor);
    navDirection.value = "forward";
    expect(takeScroll("channel", "c1", { revealing: false })).toBeNull();
    navDirection.value = "back";
    expect(takeScroll("channel", "c1", { revealing: false })).toBeNull();
  });

  it("a pending deep reveal (?m=) wins over the remembered position (C2 compatibility)", () => {
    rememberScroll("channel", "c1", anchor);
    navDirection.value = "back";
    expect(takeScroll("channel", "c1", { revealing: true })).toBeNull();
  });

  it("an old entry (> 30 min) is not restored", () => {
    vi.useFakeTimers();
    rememberScroll("channel", "c1", anchor);
    vi.advanceTimersByTime(31 * 60_000);
    navDirection.value = "back";
    expect(takeScroll("channel", "c1", { revealing: false })).toBeNull();
    vi.useRealTimers();
  });

  it("both conversation screens capture before opening a thread and restore unless revealing (?m=)", () => {
    for (const [file, kind] of [["MobileChannelView.vue", "channel"], ["MobileDmView.vue", "dm"]]) {
      const src = readFileSync(join(process.cwd(), "src/features/mobile/views", file), "utf8");
      expect(src, file).toContain(`takeScroll("${kind}", `);
      expect(src, file).toContain("{ revealing: !!useRoute().query?.m }");
      expect(src, file).toContain(`rememberScroll("${kind}", `);
      expect(src, file).toMatch(/:restore-anchor="restoreAnchor"/);
    }
  });

  it("nothing to remember (no feed yet) stores nothing", () => {
    rememberScroll("channel", "c1", null);
    navDirection.value = "back";
    expect(takeScroll("channel", "c1", { revealing: false })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("initial-load skeleton", () => {
  it("is an accessible busy status with varied message-shaped rows", () => {
    const w = mount(MobileConversationSkeleton);
    const root = w.find("[data-testid=conversation-skeleton]");
    expect(root.attributes("role")).toBe("status");
    expect(root.attributes("aria-busy")).toBe("true");
    expect(root.attributes("aria-label")).toBe("Loading conversation");
    const rows = w.findAll(".sk-row");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBeLessThanOrEqual(5);
    const widths = new Set(w.findAll(".sk-line").map((l) => l.attributes("style")));
    expect(widths.size).toBeGreaterThan(3);
  });

  it("is used only for a conversation's initial load (both mobile screens), never while paging or refreshing", () => {
    for (const file of ["MobileChannelView.vue", "MobileDmView.vue"]) {
      const src = readFileSync(join(process.cwd(), "src/features/mobile/views", file), "utf8");
      expect(src, file).toMatch(/<MobileConversationSkeleton v-if="isLoading && !messages\?\.length" \/>/);
      expect(src, file).toMatch(/<MessageList\s+v-else/);
    }
    // Desktop MessageList keeps its own loading state.
    const list = readFileSync(join(process.cwd(), "src/components/MessageList.vue"), "utf8");
    expect(list).toMatch(/<StateView v-if="isLoading" kind="loading" \/>/);
  });
});

// ---------------------------------------------------------------------------
describe("mobile community-switch overlay", () => {
  it("idle: renders nothing", () => {
    const w = mount(MobileSwitchOverlay, { attachTo: document.body });
    expect(w.find("[data-testid=mobile-switch-overlay]").exists()).toBe(false);
  });

  it("switching: a full-screen accessible status naming the target — no blank gap while the session is torn down", async () => {
    switchState.switchingTo.value = "wss://b.example.com";
    switchState.switchingFrom.value = "wss://a.example.com";
    const w = mount(MobileSwitchOverlay, { attachTo: document.body });
    await flushPromises();
    const status = w.find("[data-testid=mobile-switch-connecting]");
    expect(status.attributes("role")).toBe("status");
    expect(status.attributes("aria-live")).toBe("polite");
    expect(status.text()).toContain("Beta");
    expect(status.text()).toContain("Connecting to community");
  });

  it("failed: says so, keeps you in the previous community, Retry re-runs the verified switch, Stay dismisses", async () => {
    const w = mount(MobileSwitchOverlay, { attachTo: document.body });
    switchState.error.value = "That community can't be reached right now.";
    switchState.failed.value = "wss://b.example.com";
    await flushPromises();
    const box = w.find("[data-testid=mobile-switch-failed]");
    expect(box.attributes("role")).toBe("alertdialog");
    expect(box.text()).toContain("Unable to connect");
    expect(box.text()).toContain("Beta is unavailable");
    expect(w.find("[data-testid=mobile-switch-reason]").text()).toBe("That community can't be reached right now.");
    expect(box.text()).toContain("You're still in Alpha");
    expect(document.activeElement).toBe(w.find("[data-testid=mobile-switch-retry]").element);
    await w.find("[data-testid=mobile-switch-retry]").trigger("click");
    expect(sw.retryFailed).toHaveBeenCalledOnce();
    await w.find("[data-testid=mobile-switch-stay]").trigger("click");
    await flushPromises();
    expect(w.find("[data-testid=mobile-switch-overlay]").exists()).toBe(false);
  });

  it("an error without a failed switch target (e.g. unrelated) does not take over the screen", async () => {
    switchState.error.value = "Something else";
    const w = mount(MobileSwitchOverlay, { attachTo: document.body });
    await flushPromises();
    expect(w.find("[data-testid=mobile-switch-overlay]").exists()).toBe(false);
  });

  it("App shows it on the mobile tier keyed on the identity, not on session readiness (which is false during a switch)", () => {
    const app = readFileSync(join(process.cwd(), "src/App.vue"), "utf8");
    expect(app).toMatch(/<MobileSwitchOverlay v-if="isMobile && session\.pubkey" \/>/);
  });
});

// ---------------------------------------------------------------------------
describe("attachments at phone width (mobile-scoped presentation)", () => {
  const css = readFileSync(join(process.cwd(), "src/features/mobile/ui/MobileLayout.vue"), "utf8");
  it("never wider than the column, aspect ratio kept, no stretching", () => {
    expect(css).toMatch(/:deep\(\.attachments \.image-link\) \{[^}]*width: fit-content;[^}]*max-width: min\(100%, 360px\)/);
    expect(css).toMatch(/:deep\(\.attachments \.image\) \{[^}]*max-width: 100%/);
    expect(css).toMatch(/:deep\(\.attachments \.image\) \{[^}]*object-fit: contain/);
    expect(css).toMatch(/:deep\(\.attachments \.video\) \{[^}]*max-height: 60vh/);
  });
  it("file rows are 44px+ and long names ellipsise; failures wrap", () => {
    expect(css).toMatch(/:deep\(\.attachments \.file\) \{[^}]*min-height: 48px/);
    expect(css).toMatch(/:deep\(\.attachments \.file-name\) \{[^}]*min-width: 0/);
    expect(css).toMatch(/:deep\(\.attachments \.unavailable\) \{[^}]*overflow-wrap: anywhere/);
  });
  it("loading placeholder pulses only when motion is allowed", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*?\.attachments \.loading\) \{\s*animation: none/);
  });
});

// ---------------------------------------------------------------------------
describe("keyboard / composer regression (visualViewport)", () => {
  function fakeViewport(height: number) {
    const listeners = new Set<() => void>();
    const vv = { height, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    return { set: (h: number) => ((vv.height = h), listeners.forEach((fn) => fn())) };
  }

  it("keyboard open → layout = visible height, bottom nav hidden; closed → restored; cleanup on unmount", () => {
    const vp = fakeViewport(800);
    const stop = startViewportTracking();
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--app-height")).toBe("800px");
    expect(root.dataset.keyboard).toBe("closed");
    vp.set(480); // keyboard up
    expect(root.style.getPropertyValue("--app-height")).toBe("480px");
    expect(root.dataset.keyboard).toBe("open");
    vp.set(800); // keyboard down
    expect(root.dataset.keyboard).toBe("closed");
    stop();
    expect(root.style.getPropertyValue("--app-height")).toBe("");
    expect(root.dataset.keyboard).toBeUndefined();
  });

  it("a small resize (browser chrome) is not a keyboard", () => {
    const vp = fakeViewport(800);
    const stop = startViewportTracking();
    vp.set(740);
    expect(document.documentElement.dataset.keyboard).toBe("closed");
    stop();
  });
});
