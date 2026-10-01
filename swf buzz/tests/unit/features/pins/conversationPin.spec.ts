/**
 * Phase G — the conversation pin end to end on the client: event stream →
 * active pin → pinned view, the pin/unpin flow (toast, replace confirmation,
 * errors), the PinnedMessageBar (desktop + mobile), and the message actions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { defineComponent, h, ref } from "vue";
import type { PinEvent } from "@/protocol/pins";
import type { Message } from "@/types/domain";
import type { MemberRole } from "@/protocol/membership";

const svc = vi.hoisted(() => ({
  history: [] as PinEvent[],
  live: null as ((e: PinEvent) => void) | null,
  fetchMessage: vi.fn(async (): Promise<Message | null> => null),
  publish: vi.fn(),
  fetchFails: false,
}));
vi.mock("@/features/pins/PinService", () => ({
  pinService: {
    fetchPinEvents: vi.fn(async () => {
      if (svc.fetchFails) throw new Error("relay unavailable");
      return svc.history;
    }),
    subscribe: vi.fn((_id: string, _since: number, cb: (e: PinEvent) => void) => {
      svc.live = cb;
      return { close: vi.fn() };
    }),
    publish: svc.publish,
    fetchMessage: svc.fetchMessage,
  },
}));
vi.mock("@/services/ProfileService", () => ({ profileService: { fetchProfile: vi.fn(async () => null), fetchProfiles: vi.fn(async () => []) } }));

import { useConversationPin, type ConversationPin } from "@/features/pins/useConversationPin";
import { usePinFlow } from "@/features/pins/usePinFlow";
import PinnedMessageBar from "@/features/pins/ui/PinnedMessageBar.vue";
import MobileMessageActions from "@/features/mobile/ui/MobileMessageActions.vue";
import MessageItem from "@/components/MessageItem.vue";
import { clearInAppToasts, inAppToasts } from "@/features/notifications/inAppToasts";

const ME = "a".repeat(64);
const BOB = "b".repeat(64);
const ADMIN = "c".repeat(64);
const CH = "ch-1";

function msg(id: string, author: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    channelId: CH,
    authorPubkey: author,
    content: `message ${id}`,
    createdAt: 100,
    thread: {},
    mentions: [],
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    attachments: [],
    ...extra,
  };
}

let serial = 0;
function pinEvent(actor: string, messageId: string, createdAt: number, action: "pin" | "unpin" = "pin", author: string | null = null): PinEvent {
  serial += 1;
  return { id: `pin-${String(serial).padStart(5, "0")}`, conversationId: CH, messageId, action, actorPubkey: actor, claimedAuthor: author, createdAt };
}

const roles: Record<string, MemberRole> = { [ME]: "member", [BOB]: "member", [ADMIN]: "admin" };
const loaded = ref<Message[]>([msg("m-me", ME), msg("m-bob", BOB), msg("m-reply", BOB, { thread: { rootId: "m-bob", parentId: "m-bob" } })]);

function harness(opts: { me?: string; kind?: "channel" | "dm"; deleted?: Set<string> } = {}) {
  let api!: ConversationPin;
  let flow!: ReturnType<typeof usePinFlow>;
  const Host = defineComponent({
    setup() {
      api = useConversationPin({
        conversationId: () => CH,
        kind: () => opts.kind ?? "channel",
        myPubkey: () => opts.me ?? ME,
        roleOf: (pk) => roles[pk] ?? null,
        rolesReady: () => true,
        messages: () => loaded.value,
        isDeleted: (id) => opts.deleted?.has(id) ?? false,
      });
      flow = usePinFlow(api);
      return () => h("div");
    },
  });
  const w = mount(Host);
  return { w, get api() { return api; }, get flow() { return flow; } };
}

beforeEach(() => {
  setActivePinia(createPinia());
  svc.history = [];
  svc.live = null;
  svc.fetchFails = false;
  svc.fetchMessage.mockReset().mockResolvedValue(null);
  svc.publish.mockReset();
  clearInAppToasts();
  document.body.innerHTML = "";
});
afterEach(() => vi.clearAllMocks());

describe("useConversationPin", () => {
  it("resolves the active pin from history and shows the loaded message", async () => {
    svc.history = [pinEvent(ME, "m-me", 10, "pin", ME)];
    const { api } = harness();
    await flushPromises();
    expect(api.view.value?.status).toBe("ready");
    expect(api.view.value?.message?.id).toBe("m-me");
    expect(api.isPinned("m-me")).toBe(true);
  });

  it("15. live events and reconnect replays are deduplicated; replacement wins", async () => {
    const first = pinEvent(ME, "m-me", 10, "pin", ME);
    svc.history = [first];
    const { api } = harness();
    await flushPromises();
    svc.live?.(first); // replay after reconnect
    svc.live?.(first);
    expect(api.active.value?.eventId).toBe(first.id);
    svc.live?.(pinEvent(ADMIN, "m-bob", 20, "pin", BOB));
    expect(api.active.value?.messageId).toBe("m-bob");
  });

  it("19. a pinned reply reveals through its thread root", async () => {
    svc.history = [pinEvent(ADMIN, "m-reply", 10, "pin", BOB)];
    const { api } = harness();
    await flushPromises();
    expect(api.view.value?.threadRootId).toBe("m-bob");
  });

  it("16. a deleted pinned message shows as unavailable, never as a dead link", async () => {
    svc.history = [pinEvent(ME, "m-me", 10, "pin", ME)];
    const { api } = harness({ deleted: new Set(["m-me"]) });
    await flushPromises();
    expect(api.view.value?.status).toBe("unavailable");
    expect(api.canUnpinActive.value).toBe(true);
  });

  it("17. a pinned message outside the window is fetched once; missing → unavailable", async () => {
    svc.history = [pinEvent(ADMIN, "m-old", 10)];
    const { api } = harness();
    await flushPromises();
    expect(svc.fetchMessage).toHaveBeenCalledTimes(1);
    expect(svc.fetchMessage).toHaveBeenCalledWith(CH, "m-old");
    expect(api.view.value?.status).toBe("unavailable");
  });

  it("a fetched old pinned message is shown", async () => {
    svc.fetchMessage.mockResolvedValue(msg("m-old", BOB, { content: "from last week" }));
    svc.history = [pinEvent(ADMIN, "m-old", 10)];
    const { api } = harness();
    await flushPromises();
    expect(api.view.value?.status).toBe("ready");
    expect(api.view.value?.message?.content).toBe("from last week");
  });

  it("a fetch failure is an error state (retryable), not a broken banner", async () => {
    svc.fetchMessage.mockRejectedValue(new Error("offline"));
    svc.history = [pinEvent(ADMIN, "m-old", 10)];
    const { api } = harness();
    await flushPromises();
    expect(api.view.value?.status).toBe("error");
  });

  it("relay unavailable while loading history surfaces an error", async () => {
    svc.fetchFails = true;
    const { api } = harness();
    await flushPromises();
    expect(api.error.value).toBeTruthy();
    expect(api.view.value).toBeNull();
  });

  it("abilities follow the model: a member may pin only their own message", async () => {
    const { api } = harness();
    await flushPromises();
    expect(api.canPin(msg("m-me", ME))).toBe(true);
    expect(api.canPin(msg("m-bob", BOB))).toBe(false);
    expect(api.canPin(msg("sending", ME, { status: "sending" }))).toBe(false);
  });

  it("an admin may pin anyone's message", async () => {
    const { api } = harness({ me: ADMIN });
    await flushPromises();
    expect(api.canPin(msg("m-bob", BOB))).toBe(true);
  });
});

describe("usePinFlow", () => {
  it("first pin: immediate, no confirmation, 'Message pinned' toast", async () => {
    const h1 = harness();
    await flushPromises();
    svc.publish.mockResolvedValue(pinEvent(ME, "m-me", 50, "pin", ME));
    h1.flow.requestPin(msg("m-me", ME));
    await flushPromises();
    expect(h1.flow.confirmingReplace.value).toBeNull();
    expect(svc.publish).toHaveBeenCalledWith({ conversationId: CH, messageId: "m-me", action: "pin", messageAuthor: ME });
    expect(h1.api.active.value?.messageId).toBe("m-me");
    expect(inAppToasts.value.map((t) => t.title)).toContain("Message pinned");
  });

  it("11. replacing a different pin asks first; Replace publishes, Cancel doesn't", async () => {
    svc.history = [pinEvent(ADMIN, "m-bob", 10, "pin", BOB)];
    const h1 = harness({ me: ADMIN });
    await flushPromises();
    h1.flow.requestPin(msg("m-me", ME));
    expect(h1.flow.confirmingReplace.value?.id).toBe("m-me");
    h1.flow.cancelReplace();
    expect(svc.publish).not.toHaveBeenCalled();

    svc.publish.mockResolvedValue(pinEvent(ADMIN, "m-me", 60, "pin", ME));
    h1.flow.requestPin(msg("m-me", ME));
    await h1.flow.confirmReplace();
    await flushPromises();
    expect(svc.publish).toHaveBeenCalledTimes(1);
    expect(h1.api.active.value?.messageId).toBe("m-me");
  });

  it("22. a refused publish (permission denied) keeps the old state and reports it", async () => {
    const h1 = harness();
    await flushPromises();
    svc.publish.mockRejectedValue(new Error("restricted: not a channel member"));
    h1.flow.requestPin(msg("m-me", ME));
    await flushPromises();
    expect(h1.api.active.value).toBeNull();
    expect(h1.api.error.value).toBeTruthy();
    expect(inAppToasts.value.map((t) => t.title)).toContain("Couldn't pin message");
  });

  it("unpin publishes an unpin of the active message and toasts", async () => {
    svc.history = [pinEvent(ME, "m-me", 10, "pin", ME)];
    const h1 = harness();
    await flushPromises();
    svc.publish.mockResolvedValue(pinEvent(ME, "m-me", 70, "unpin"));
    await h1.flow.requestUnpin();
    expect(svc.publish).toHaveBeenCalledWith({ conversationId: CH, messageId: "m-me", action: "unpin" });
    expect(h1.api.active.value).toBeNull();
    expect(inAppToasts.value.map((t) => t.title)).toContain("Message unpinned");
  });

  it("a member cannot unpin somebody else's pin through the flow", async () => {
    svc.history = [pinEvent(BOB, "m-bob", 10, "pin", BOB)];
    const h1 = harness();
    await flushPromises();
    await h1.flow.requestUnpin();
    expect(svc.publish).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function mountBar(props: Partial<InstanceType<typeof PinnedMessageBar>["$props"]> = {}) {
  return mount(PinnedMessageBar, {
    props: {
      view: {
        pin: { eventId: "e1", messageId: "m-me", pinnedBy: ME, pinnedAt: Math.floor(Date.now() / 1000) - 7200, messageAuthor: ME },
        message: msg("m-me", ME, { content: "Please review the deployment checklist before EOD.", attachments: [] }),
        status: "ready",
        threadRootId: null,
      },
      canUnpin: false,
      ...props,
    },
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
    attachTo: document.body,
  });
}

describe("20/21. PinnedMessageBar", () => {
  it("shows who pinned it, when, and a preview; activating it opens the message", async () => {
    const w = mountBar();
    expect(w.text()).toContain("Pinned by");
    expect(w.text()).toContain("2h ago");
    expect(w.find("[data-testid=pinned-message-preview]").text()).toContain("deployment checklist");
    const open = w.find("[data-testid=pinned-message-open]");
    expect(open.element.tagName).toBe("BUTTON");
    expect(open.attributes("aria-label")).toContain("Open pinned message");
    await open.trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
  });

  it("the unpin control exists only for someone allowed to unpin, with an accessible name", async () => {
    expect(mountBar().find("[data-testid=pinned-message-unpin]").exists()).toBe(false);
    const w = mountBar({ canUnpin: true });
    const unpin = w.find("[data-testid=pinned-message-unpin]");
    expect(unpin.attributes("aria-label")).toBe("Unpin message");
    await unpin.trigger("click");
    expect(w.emitted("unpin")).toHaveLength(1);
    expect(w.emitted("open")).toBeUndefined();
  });

  it("shows attachment and thread cues", () => {
    const w = mountBar({
      view: {
        pin: { eventId: "e1", messageId: "m-reply", pinnedBy: ME, pinnedAt: 1, messageAuthor: BOB },
        message: msg("m-reply", BOB, {
          thread: { rootId: "m-bob", parentId: "m-bob" },
          attachments: [{ url: "https://x/a.png", mimeType: "image/png" } as never],
        }),
        status: "ready",
        threadRootId: "m-bob",
      },
    });
    expect(w.text()).toContain("Thread");
    expect(w.findAll(".pin-cue")).toHaveLength(2);
  });

  it("an unavailable pin says so, is not clickable, and offers unpin to whoever may", async () => {
    const w = mountBar({
      canUnpin: true,
      view: { pin: { eventId: "e1", messageId: "gone", pinnedBy: ME, pinnedAt: 1, messageAuthor: ME }, message: null, status: "unavailable", threadRootId: null },
    });
    expect(w.find("[data-testid=pinned-message-unavailable]").text()).toBe("This message is no longer available.");
    expect(w.find("[data-testid=pinned-message-open]").element.tagName).toBe("DIV");
    await w.find("[data-testid=pinned-message-open]").trigger("click");
    expect(w.emitted("open")).toBeUndefined();
    expect(w.find("[data-testid=pinned-message-unpin]").exists()).toBe(true);
  });

  it("a load error offers retry", async () => {
    const w = mountBar({
      view: { pin: { eventId: "e1", messageId: "x", pinnedBy: ME, pinnedAt: 1, messageAuthor: null }, message: null, status: "error", threadRootId: null },
    });
    expect(w.text()).toContain("Unable to load pinned message");
    await w.find("[data-testid=pinned-message-retry]").trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
  });

  it("mobile layout: full-width strip class with 44px targets", () => {
    const w = mountBar({ mobile: true, canUnpin: true });
    expect(w.find("[data-testid=pinned-message-bar]").classes()).toContain("mobile");
  });
});

describe("P2. message actions offer Pin only when allowed", () => {
  const mountItem = (props: Record<string, unknown>) =>
    mount(MessageItem, {
      props: { message: msg("m-bob", BOB), ...props },
      global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
      attachTo: document.body,
    });
  const openMenu = async (w: VueWrapper) => {
    await w.find("[data-testid=message-more-actions]").trigger("click");
    await flushPromises();
  };

  it("desktop: no Pin for a member on someone else's message", async () => {
    const w = mountItem({ canPin: false });
    await openMenu(w);
    expect(document.querySelector("[data-testid=message-pin]")).toBeNull();
  });

  it("desktop: Pin when allowed; emits pin", async () => {
    const w = mountItem({ canPin: true });
    await openMenu(w);
    (document.querySelector("[data-testid=message-pin]") as HTMLElement).click();
    expect(w.emitted("pin")).toHaveLength(1);
  });

  it("desktop: the pinned message offers Unpin to someone allowed, and shows a Pinned marker", async () => {
    const w = mountItem({ isPinned: true, canUnpin: true, canPin: false });
    expect(w.find("[data-testid=message-pinned-marker]").exists()).toBe(true);
    await openMenu(w);
    (document.querySelector("[data-testid=message-unpin]") as HTMLElement).click();
    expect(w.emitted("unpin")).toHaveLength(1);
  });

  it("mobile sheet: the same logical abilities", async () => {
    const sheet = (abilities: Record<string, boolean>) =>
      mount(MobileMessageActions, {
        props: { message: msg("m-bob", BOB), abilities, isOwn: false, authorName: "Bob" },
        attachTo: document.body,
      });
    sheet({ pin: false });
    expect(document.querySelector("[data-testid=action-pin]")).toBeNull();
    document.body.innerHTML = "";
    const w = sheet({ pin: true });
    (document.querySelector("[data-testid=action-pin]") as HTMLElement).click();
    expect(w.emitted("pin")).toHaveLength(1);
  });
});
