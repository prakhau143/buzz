/**
 * Mobile DM screen: the existing DM implementation (list, messages, send,
 * reactions, typing, read state) presented full screen — partner header with
 * presence, typing indicator above the composer, NIP-RS "seen" on open,
 * thread navigation, and DM-appropriate actions (no invented edit/delete).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { h, ref } from "vue";
import type { Channel, Message } from "@/types/domain";

const ME = "8".repeat(64);
const BINOD = "b".repeat(64);

const push = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ name: "mobile-dm", params: { conversationId: "d1" } }),
}));
vi.mock("@/composables/useProfile", async () => {
  const { computed } = await import("vue");
  return { useProfile: (pk: () => string | null) => ({ data: computed(() => (pk() === BINOD ? { displayName: "Binod" } : undefined)) }) };
});
vi.mock("@/features/dm/useDmList", () => ({
  useDmList: () => ({
    data: ref([{ id: "d1", name: "", visibility: "private", channelType: "dm", archived: false, dmParticipants: [ME, BINOD] } as Channel]),
  }),
}));
const messages = ref<Message[]>([]);
vi.mock("@/features/dm/useDmMessages", () => ({
  useDmMessages: () => ({
    data: messages,
    isLoading: ref(false),
    isError: ref(false),
    refetch: vi.fn(),
    loadOlder: vi.fn(),
    hasOlderMessages: ref(false),
    isLoadingOlder: ref(false),
    olderMessagesError: ref(false),
  }),
}));
const send = vi.fn();
vi.mock("@/features/dm/useSendDm", () => ({ useSendDm: () => ({ send, isSending: ref(false), error: ref(null) }) }));
vi.mock("@/features/dm/useHideDm", () => ({ useHideDm: () => ({ hide: vi.fn(), isHiding: ref(false) }) }));
vi.mock("@/features/dm/useOpenDm", () => ({ useOpenDm: () => ({ open: vi.fn(async () => "d1"), isOpening: ref(false) }) }));
vi.mock("@/features/reactions/useChannelReactions", () => ({ useChannelReactions: () => ({ data: ref(new Map()) }) }));
vi.mock("@/features/reactions/useAddReaction", () => ({ useAddReaction: () => ({ react: vi.fn() }) }));
vi.mock("@/features/reactions/useRemoveReaction", () => ({ useRemoveReaction: () => ({ unreact: vi.fn() }) }));
const typing = ref<string[]>([]);
vi.mock("@/features/presence/useTypingIndicator", () => ({ useTypingIndicator: () => ({ typingPubkeys: typing, notifyTyping: vi.fn() }) }));
vi.mock("@/features/notifications/useNotificationService", () => ({ useReportActiveConversation: vi.fn() }));

const listProps = ref<Record<string, unknown>>({});
const MessageListStub = {
  name: "MessageList",
  props: { messages: Array, mobileActions: Boolean, emptyTitle: String },
  emits: ["open-thread", "open-actions"],
  setup(props: Record<string, unknown>, { emit, expose }: { emit: (e: string, ...a: unknown[]) => void; expose: (e: object) => void }) {
    expose({ captureScrollAnchor: () => ({ id: "anchor1", offset: 8, scrollTop: 300 }) });
    return () => {
      listProps.value = { ...props };
      return h("div", { "data-testid": "list" }, [
        h("button", { "data-testid": "stub-open-thread", onClick: () => emit("open-thread", "root1") }),
        h("button", { "data-testid": "stub-open-actions", onClick: () => emit("open-actions", messages.value[0]) }),
      ]);
    };
  },
};
const ComposerStub = {
  name: "MessageComposer",
  props: { mentionScope: Object, placeholder: String },
  setup: (p: { mentionScope?: object }) => () => h("div", { "data-testid": "composer", "data-scope": JSON.stringify(p.mentionScope) }),
};
const TypingStub = {
  name: "TypingIndicator",
  props: { pubkeys: Array },
  setup: (p: { pubkeys?: string[] }) => () => h("div", { "data-testid": "typing" }, (p.pubkeys ?? []).join(",")),
};

const { useSessionStore } = await import("@/stores/session");
const { useReadStateStore } = await import("@/stores/readState");
const { usePresenceStore } = await import("@/stores/presence");
const MobileDmView = (await import("@/features/mobile/views/MobileDmView.vue")).default;

const msg = (id: string, createdAt: number, author = BINOD): Message => ({
  id,
  channelId: "d1",
  authorPubkey: author,
  content: "hi",
  createdAt,
  thread: {},
  mentions: [],
  reactions: [],
  status: "sent",
  isSystemMessage: false,
  isAgentMessage: false,
  attachments: [],
});

function mountDm() {
  return mount(MobileDmView, {
    props: { conversationId: "d1" },
    attachTo: document.body,
    global: { stubs: { MessageList: MessageListStub, MessageComposer: ComposerStub, TypingIndicator: TypingStub } },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().$patch({ pubkey: ME });
  document.body.innerHTML = "";
  push.mockReset();
  messages.value = [];
  typing.value = [];
});

describe("MobileDmView", () => {
  it("header shows the partner and their presence from the one store; tapping it opens their profile", async () => {
    usePresenceStore().apply(BINOD, { status: "online", updatedAt: 1, source: "snapshot" });
    const w = mountDm();
    await flushPromises();
    expect(w.find("[data-testid=mobile-title]").text()).toBe("Binod");
    expect(w.find("[data-testid=mobile-dm-presence]").text()).toBe("Online");
    await w.find("[data-testid=mobile-dm-partner]").trigger("click");
    await flushPromises();
    expect(document.querySelector("[data-testid=mobile-profile-name]")?.textContent).toBe("Binod");
  });

  it("uses the DM's participants as the mention scope, touch actions, and a DM empty state", async () => {
    const w = mountDm();
    await flushPromises();
    expect(JSON.parse(w.find("[data-testid=composer]").attributes("data-scope")!)).toEqual({
      kind: "dm",
      channelId: "d1",
      participants: [ME, BINOD],
    });
    expect(listProps.value.mobileActions).toBe(true);
    expect(listProps.value.emptyTitle).toBe("Start the conversation");
  });

  it("typing indicator sits between the messages and the composer", async () => {
    typing.value = [BINOD];
    const w = mountDm();
    await flushPromises();
    const footer = w.find(".m-footer").element;
    const order = [...footer.children].map((c) => c.getAttribute("data-testid"));
    expect(order).toEqual(["typing", "composer"]);
    expect(w.find("[data-testid=typing]").text()).toBe(BINOD);
  });

  it("marks the DM seen at its newest message (the same NIP-RS frontier as desktop)", async () => {
    const readState = useReadStateStore();
    const seen = vi.spyOn(readState, "markChannelSeen");
    messages.value = [msg("m1", 100), msg("m2", 250)];
    mountDm();
    await flushPromises();
    expect(seen).toHaveBeenCalledWith("d1", 250);
  });

  it("a thread opens as its own DM thread page", async () => {
    const w = mountDm();
    await flushPromises();
    await w.find("[data-testid=stub-open-thread]").trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "mobile-dm-thread", params: { conversationId: "d1", rootId: "root1" } });
    // C3: the reading position is remembered for the way back.
    const { takeScroll } = await import("@/features/mobile/scrollMemory");
    const { navDirection } = await import("@/features/mobile/mobileNav");
    navDirection.value = "back";
    expect(takeScroll("dm", "d1", { revealing: false })).toEqual({ id: "anchor1", offset: 8, scrollTop: 300 });
    navDirection.value = "none";
  });

  it("message actions are the desktop DM's: reply, react, pin, copy — no edit/delete/report", async () => {
    messages.value = [msg("m1", 100, ME)];
    const w = mountDm();
    await flushPromises();
    await w.find("[data-testid=stub-open-actions]").trigger("click");
    await flushPromises();
    const ids = [...new Set([...document.querySelectorAll<HTMLElement>("[data-testid^=action-]")].map((e) => e.dataset.testid))];
    // Phase G: either DM participant may pin any message (no roles in a DM).
    expect(ids).toEqual(["action-react", "action-reply", "action-pin", "action-copy"]);
  });
});
