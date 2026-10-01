/**
 * Phase F — interactions wired into the real screens: long-press on the shared
 * MessageList (mobile only), the richer action sheet (context, react haptic,
 * explicit destructive confirmation with focus, Escape, focus return),
 * MobileLayout's swipe-back / pull-to-refresh, and which screens get which
 * gesture (conversation, DM, thread, Inbox, Home, Search, Settings).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { h } from "vue";
import type { Message } from "@/types/domain";

vi.mock("@/composables/useProfile", async () => {
  const { computed, ref } = await import("vue");
  return { useProfile: () => ({ data: computed(() => undefined) }), useProfileMap: () => ({ profiles: ref(new Map()), displayNames: ref(new Map()) }) };
});
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useRoute: () => ({ name: "mobile-channel", params: {}, query: {} }) }));

const MessageList = (await import("@/components/MessageList.vue")).default;
const MobileMessageActions = (await import("@/features/mobile/ui/MobileMessageActions.vue")).default;
const MobileLayout = (await import("@/features/mobile/ui/MobileLayout.vue")).default;
const policy = await import("@/features/mobile/gestures/gesturePolicy");
const haptics = await import("@/platform/haptics");

function touch(el: Element, type: string, x: number, y: number, timeStamp?: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [point] });
  Object.defineProperty(ev, "changedTouches", { value: [point] });
  if (timeStamp !== undefined) Object.defineProperty(ev, "timeStamp", { value: timeStamp });
  el.dispatchEvent(ev);
  return ev;
}
const msg = (over: Partial<Message> = {}): Message => ({
  id: "1".repeat(64),
  channelId: "c1",
  authorPubkey: "b".repeat(64),
  content: "Deployment finished — health checks are green across all regions",
  createdAt: Math.floor(Date.now() / 1000) - 120,
  thread: {},
  mentions: [],
  reactions: [],
  status: "sent",
  isSystemMessage: false,
  isAgentMessage: false,
  attachments: [],
  ...over,
});

let vibrate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true, writable: true });
  policy.resetGesturesForTests();
  haptics.resetHapticsForTests();
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("long press on the shared MessageList", () => {
  const mountList = (mobileActions: boolean, messages: Message[]) =>
    mount(MessageList, {
      props: { messages, isLoading: false, isError: false, mobileActions },
      attachTo: document.body,
      global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
    });

  it("mobile: long-pressing a row opens that message's actions (same event as its ⋯)", async () => {
    vi.useFakeTimers();
    const m = msg();
    const w = mountList(true, [m]);
    await flushPromises();
    const body = w.find(`[data-message-id="${m.id}"] .message-content, [data-message-id="${m.id}"]`).element;
    touch(body, "touchstart", 120, 200);
    vi.advanceTimersByTime(policy.LONG_PRESS_MS);
    expect(w.emitted("open-actions")?.[0]).toEqual([m]);
  });

  it("desktop (no mobileActions): a long touch does nothing; a message still sending has no actions", async () => {
    vi.useFakeTimers();
    const w = mountList(false, [msg()]);
    await flushPromises();
    touch(w.find("[data-message-id]").element, "touchstart", 1, 1);
    vi.advanceTimersByTime(700);
    expect(w.emitted("open-actions")).toBeUndefined();
    w.unmount();
    const w2 = mountList(true, [msg({ status: "sending" })]);
    await flushPromises();
    touch(w2.find("[data-message-id]").element, "touchstart", 1, 1);
    vi.advanceTimersByTime(700);
    expect(w2.emitted("open-actions")).toBeUndefined();
  });
});

describe("action sheet (long-press target)", () => {
  const sheet = (over: Partial<Message> = {}, abilities = { reply: true, react: true, edit: true, deleteMode: "self" as const, report: false }, isOwn = true) =>
    mount(MobileMessageActions, {
      props: { message: msg(over), abilities, isOwn, authorName: "Prakhar Mittal", reactions: [] },
      attachTo: document.body,
    });

  it("shows who, when, what — plus attachment and thread cues — from data already held", () => {
    sheet({ attachments: [{ url: "u", mimeType: "image/png", sha256: "s", size: 1 }], thread: { rootId: "2".repeat(64) } });
    const ctx = document.querySelector("[data-testid=sheet-message-context]")!;
    expect(ctx.textContent).toContain("Prakhar Mittal");
    expect(ctx.textContent).toContain("2m");
    expect(ctx.textContent).toContain("Deployment finished");
    expect(ctx.textContent).toContain("1 attachment");
    expect(ctx.textContent).toContain("In a thread");
  });

  it("offers only the actions it was authorized for; every action is labelled and 44 px+", () => {
    sheet({}, { reply: false, react: false, edit: false, deleteMode: null as never, report: false }, false);
    const ids = [...document.querySelectorAll("[data-testid^=action-]")].map((e) => e.getAttribute("data-testid"));
    expect(ids).toEqual(["action-copy"]);
    const css = readFileSync("src/features/mobile/ui/MobileSheet.vue", "utf8");
    expect(css).toMatch(/\.sheet-row\) \{[^}]*min-height: 52px/);
    expect(readFileSync("src/features/mobile/ui/MobileMessageActions.vue", "utf8")).toMatch(/\.react \{[^}]*min-width: 44px;\s*height: 48px/);
  });

  it("a reaction: selection haptic, the toggle, and the sheet closes", async () => {
    const w = sheet();
    (document.querySelector("[data-testid=action-react]") as HTMLButtonElement).click();
    expect(vibrate).toHaveBeenCalledWith(5);
    expect(w.emitted("react")?.[0]).toEqual(["👍"]);
    expect(w.emitted("close")).toBeTruthy();
  });

  it("delete is a separate, explicit step: warning haptic, focus on 'Delete', easy cancel", async () => {
    const w = sheet();
    (document.querySelector("[data-testid=action-delete]") as HTMLButtonElement).click();
    await flushPromises();
    const confirm = document.querySelector("[data-testid=action-delete-confirm]")!;
    expect(confirm.getAttribute("role")).toBe("alertdialog");
    expect(confirm.textContent).toContain("Delete your message?");
    expect(document.activeElement).toBe(document.querySelector("[data-testid=action-delete-confirm-yes]"));
    expect(vibrate).toHaveBeenCalledWith([18, 60, 18]);
    expect(w.emitted("delete")).toBeUndefined();
    (document.querySelector("[data-testid=action-delete-confirm-yes]") as HTMLButtonElement).click();
    expect(w.emitted("delete")).toBeTruthy();
  });

  it("someone else's message as a moderator is named as such", async () => {
    sheet({}, { reply: true, react: true, edit: false, deleteMode: "admin" as never, report: true }, false);
    (document.querySelector("[data-testid=action-delete]") as HTMLButtonElement).click();
    await flushPromises();
    expect(document.querySelector("[data-testid=action-delete-confirm]")!.textContent).toContain("moderation audit log");
  });

  it("Escape closes; focus returns to what opened it", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const w = sheet();
    await flushPromises();
    expect(document.activeElement).not.toBe(trigger);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("MobileLayout gestures", () => {
  const layout = (props: Record<string, unknown>) =>
    mount(MobileLayout, {
      props,
      slots: { default: () => h("div", { class: "body" }, "content") },
      attachTo: document.body,
      global: { stubs: { MobileBottomNav: true, MobileProfileSheet: true } },
    });

  it("a screen with a back gets the edge swipe; a tab root without one does not", () => {
    const back = vi.fn();
    const w = layout({ back });
    const body = w.find(".body").element;
    Object.defineProperty(w.find("[data-testid=mobile-layout]").element, "clientWidth", { value: 390 });
    touch(body, "touchstart", 6, 300, 0);
    touch(body, "touchmove", 200, 305, 300);
    touch(body, "touchend", 200, 305, 400);
    expect(back).toHaveBeenCalledOnce();
    w.unmount();
    const w2 = layout({});
    const body2 = w2.find(".body").element;
    touch(body2, "touchstart", 6, 300, 0);
    const move = touch(body2, "touchmove", 200, 305, 300);
    touch(body2, "touchend", 200, 305, 400);
    expect(move.defaultPrevented).toBe(false); // the page keeps its own scrolling
    expect(policy.gestureOwner()).toBeNull();
  });

  it("pull-to-refresh exists only where the screen passes a refresh; its state is announced", () => {
    const w = layout({ refresh: async () => undefined });
    expect(w.find("[data-testid=pull-indicator]").attributes("aria-hidden")).toBe("true");
    expect(w.find("[data-testid=pull-status]").attributes("role")).toBe("status");
    w.unmount();
    expect(layout({}).find("[data-testid=pull-indicator]").exists()).toBe(false);
  });
});

describe("which screens get which gesture (wiring contract)", () => {
  const src = (p: string) => readFileSync(`src/features/mobile/views/${p}`, "utf8");
  it("conversations: swipe-back to their parent + pull-to-refresh on the message list (their own refetch)", () => {
    for (const f of ["MobileChannelView.vue", "MobileDmView.vue"]) {
      expect(src(f), f).toContain('<MobileLayout :back="goBack" :refresh="refreshConversation" refresh-scroller=".message-list">');
      expect(src(f), f).toMatch(/const result = await refetch\(\);\s*if \(result\.isError\) throw/);
    }
  });
  it("thread: swipe back to the conversation, no pull-to-refresh", () => {
    expect(src("MobileThreadView.vue")).toContain('<MobileLayout :back="goBack">');
  });
  it("Inbox and Home refresh with their existing refetches; Search never pulls", () => {
    expect(src("MobileInboxView.vue")).toContain('<MobileLayout show-nav :refresh="refreshInbox">');
    expect(src("MobileHomeView.vue")).toContain('<MobileLayout show-nav :refresh="refreshHome">');
    expect(src("MobileSearchView.vue")).not.toMatch(/:refresh=/);
  });
  it("sideways rows are declared to the gesture policy (no swipe-back / pull from filter chips or tabs)", () => {
    expect(src("MobileInboxView.vue")).toMatch(/class="filters" role="tablist"[^>]*data-hscroll/);
    expect(src("MobileSearchView.vue")).toMatch(/class="tabs" role="tablist"[^>]*data-hscroll/);
  });
  it("threads long-press like conversations; Settings on a phone swipes back like its header", () => {
    expect(readFileSync("src/components/ThreadPanel.vue", "utf8")).toMatch(/useMessageLongPress\(panel, \{\s*enabled: \(\) => !!props\.mobileActions/);
    expect(readFileSync("src/features/settings/ui/SettingsView.vue", "utf8")).toMatch(/useSwipeBack\(mobileScreen, \{ enabled: \(\) => isMobile\.value, onBack: mobileBack \}\)/);
  });
  it("every new motion stands down under reduced motion", () => {
    for (const f of ["src/features/mobile/ui/MobileLayout.vue", "src/features/mobile/ui/MobileSheet.vue", "src/features/mobile/ui/MobilePullIndicator.vue", "src/features/settings/ui/SettingsView.vue", "src/features/mobile/views/MobileInboxView.vue"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    }
    expect(readFileSync("src/features/mobile/ui/MobileLayout.vue", "utf8")).toMatch(/reaction-pill\.mine\),\s*\.mobile-layout :deep\(\.message-list\) \{\s*animation: none/);
  });
});
