/**
 * Message author → profile → Message / Wave, OLD BUZZ-compatible:
 *  - avatar AND name open the profile, by the author's pubkey (never the name);
 *  - a wave is a kind:9 DM with OLD BUZZ's marker, rendered as a card;
 *  - the profile shows the same presence as everywhere else (one store);
 *  - Message resolves the DM once per click (no double request), Wave sends the
 *    marker message into that same DM, Huddle is not offered (no voice client).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { Message } from "@/types/domain";

const GAURAV = "9".repeat(64);
const ME = "8".repeat(64);

vi.mock("@/composables/useProfile", () => ({
  useProfile: (pubkey: () => string | null) => ({
    data: ref(pubkey() === ME ? { displayName: "Vaibhav" } : { displayName: "Gaurav Sharma" }),
    isLoading: ref(false),
    isError: ref(false),
  }),
}));

let resolveOpen: (id: string) => void = () => undefined;
const openCalls: string[] = [];
const sent: { conversationId: string; content: string }[] = [];
vi.mock("@/features/dm/useOpenDm", () => ({
  useOpenDm: () => ({
    open: (pubkeys: string[]) => {
      openCalls.push(pubkeys[0]);
      return new Promise<string>((resolve) => (resolveOpen = resolve));
    },
    isOpening: ref(false),
  }),
}));
vi.mock("@/features/dm/DmService", () => ({
  dmService: {
    sendMessage: async (conversationId: string, content: string) => {
      sent.push({ conversationId, content });
    },
  },
}));
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const { buildWaveMessageContent, parseWaveMessageContent, WAVE_MESSAGE_MARKER } = await import("@/features/dm/wave");
const { usePresenceStore } = await import("@/stores/presence");
const { useSessionStore } = await import("@/stores/session");
const UserProfilePanel = (await import("@/features/channels/ui/UserProfilePanel.vue")).default;
const MessageItem = (await import("@/components/MessageItem.vue")).default;

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    channelId: "c1",
    authorPubkey: GAURAV,
    content: "Good morning",
    createdAt: 1_790_000_000,
    thread: {},
    mentions: [],
    reactions: [],
    attachments: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    ...overrides,
  } as Message;
}

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().$patch({ pubkey: ME });
  openCalls.length = 0;
  sent.length = 0;
  push.mockClear();
});

describe("wave format (OLD BUZZ waveMessage.ts)", () => {
  it("builds the marker content and parses it back", () => {
    const content = buildWaveMessageContent("Vaibhav");
    expect(content).toBe(`${WAVE_MESSAGE_MARKER}\nVaibhav waved at you.`);
    expect(parseWaveMessageContent(content)).toEqual({ text: "Vaibhav waved at you." });
    expect(buildWaveMessageContent("  ")).toBe(`${WAVE_MESSAGE_MARKER}\nSomeone waved at you.`);
    expect(parseWaveMessageContent("hello")).toBeNull();
  });
});

describe("MessageItem author", () => {
  const mountItem = (m: Message) => mount(MessageItem, { props: { message: m }, global: { stubs: { MessageMenu: true } } });

  it("avatar and name both open the profile with the author's pubkey", async () => {
    const wrapper = mountItem(message());
    await wrapper.find("[data-testid=message-author-avatar]").trigger("click");
    await wrapper.find("[data-testid=message-author-name]").trigger("click");
    expect(wrapper.emitted("open-profile")).toEqual([[GAURAV], [GAURAV]]);
    expect(wrapper.find("[data-testid=message-author-name]").text()).toBe("Gaurav Sharma");
  });

  it("renders a wave as a card, not the raw marker", () => {
    const wrapper = mountItem(message({ content: buildWaveMessageContent("Gaurav Sharma") }));
    expect(wrapper.find("[data-testid=message-wave]").text()).toContain("Gaurav Sharma waved at you.");
    expect(wrapper.text()).not.toContain("buzz:wave");
  });
});

describe("UserProfilePanel", () => {
  const mountPanel = () =>
    mount(UserProfilePanel, { props: { pubkey: GAURAV }, global: { stubs: { CloseButton: true } } });

  it("keeps the presence dot and shows the status label from the shared store", async () => {
    usePresenceStore().apply(GAURAV, { status: "online", updatedAt: 1, source: "snapshot" });
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.find("[data-testid=profile-name]").text()).toBe("Gaurav Sharma");
    expect(wrapper.find(".avatar-presence").attributes("data-presence")).toBe("online");
    expect(wrapper.find("[data-testid=profile-status]").text()).toBe("Online");
  });

  it("Message resolves the DM once even when clicked twice, then opens it", async () => {
    const wrapper = mountPanel();
    const button = wrapper.find("[data-testid=profile-message]");
    await button.trigger("click");
    await button.trigger("click");
    expect(button.text()).toBe("Opening…");
    resolveOpen("dm-1");
    await flushPromises();
    expect(openCalls).toEqual([GAURAV]);
    expect(push).toHaveBeenCalledWith({ name: "dm", query: { conversationId: "dm-1" } });
  });

  it("Wave sends OLD BUZZ's wave message into the resolved 1:1 DM", async () => {
    const wrapper = mountPanel();
    await wrapper.find("[data-testid=profile-wave]").trigger("click");
    resolveOpen("dm-1");
    await flushPromises();
    expect(sent).toEqual([{ conversationId: "dm-1", content: buildWaveMessageContent("Vaibhav") }]);
    expect(wrapper.find("[data-testid=profile-wave]").text()).toContain("Waved");
  });

  it("offers no huddle at all — huddles are outside SWF Buzz's product boundary", () => {
    const wrapper = mountPanel();
    expect(wrapper.find("[data-testid=profile-huddle]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=profile-huddle-note]").exists()).toBe(false);
    expect(wrapper.text().toLowerCase()).not.toContain("huddle");
  });

  it("Escape closes the profile", async () => {
    const wrapper = mount(UserProfilePanel, {
      props: { pubkey: GAURAV },
      global: { stubs: { CloseButton: true } },
      attachTo: document.body,
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });
});
