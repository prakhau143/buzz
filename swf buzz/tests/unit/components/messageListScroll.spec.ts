/**
 * Chat scroll behaviour of MessageList: open at the latest message, follow new
 * messages only when the reader is at the bottom, never move someone reading
 * history, "↓ New messages" pill, own sends always visible, older pages keep the
 * viewport, and a conversation switch starts at the bottom again.
 *
 * jsdom has no layout, so the feed gets a fake geometry: 40px per message in a
 * 400px viewport, with scrollTop clamped like a real scroll container.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import MessageList from "@/components/MessageList.vue";
import type { Message } from "@/types/domain";

const ROW = 40;
const VIEWPORT = 400;
const scrollTops = new WeakMap<Element, number>();
const isFeed = (el: Element) => el.classList.contains("message-list");
const height = (el: Element) => el.querySelectorAll("message-item-stub").length * ROW;

const saved = {
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight"),
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop"),
};

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return isFeed(this) ? height(this) : 0;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get() {
      return isFeed(this) ? VIEWPORT : 0;
    },
  });
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get() {
      return scrollTops.get(this) ?? 0;
    },
    set(value: number) {
      const max = isFeed(this) ? Math.max(0, height(this) - VIEWPORT) : 0;
      scrollTops.set(this, Math.min(Math.max(0, value), max));
    },
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (cb(0), 1));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterAll(() => {
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(Element.prototype, key, descriptor);
  }
  vi.unstubAllGlobals();
});

let serial = 0;
beforeEach(() => {
  serial = 0;
});

function msg(overrides: Partial<Message> = {}): Message {
  serial += 1;
  return {
    id: `m${serial}`,
    channelId: "c1",
    authorPubkey: "a".repeat(64),
    content: `message ${serial}`,
    createdAt: serial,
    status: "sent",
    ...overrides,
  } as Message;
}
const many = (n: number) => Array.from({ length: n }, () => msg());

async function mountList(messages: Message[], conversationId = "c1") {
  const wrapper = mount(MessageList, {
    props: { messages, conversationId, isLoading: false, isError: false },
    global: { stubs: { MessageItem: true } },
  });
  await flushPromises();
  return wrapper;
}
const feed = (wrapper: Awaited<ReturnType<typeof mountList>>) =>
  wrapper.find(".message-list").element as HTMLElement;
const bottom = (count: number) => count * ROW - VIEWPORT;

async function scrollTo(wrapper: Awaited<ReturnType<typeof mountList>>, top: number) {
  feed(wrapper).scrollTop = top;
  await wrapper.find(".message-list").trigger("scroll");
}

describe("MessageList scrolling", () => {
  it("opens a long history at the latest message", async () => {
    const wrapper = await mountList(many(500));
    expect(feed(wrapper).scrollTop).toBe(bottom(500));
  });

  it("opens at the latest message once loading finishes (not before)", async () => {
    const wrapper = mount(MessageList, {
      props: { messages: [], conversationId: "c1", isLoading: true, isError: false },
      global: { stubs: { MessageItem: true } },
    });
    await wrapper.setProps({ messages: many(300), isLoading: false });
    await flushPromises();
    expect(feed(wrapper).scrollTop).toBe(bottom(300));
  });

  it("follows a new message when the reader is at the bottom", async () => {
    const messages = many(50);
    const wrapper = await mountList(messages);
    await wrapper.setProps({ messages: [...messages, msg()] });
    await flushPromises();
    expect(feed(wrapper).scrollTop).toBe(bottom(51));
    expect(wrapper.find(".new-messages-pill").exists()).toBe(false);
  });

  it("never moves someone reading history; shows the pill instead", async () => {
    const messages = many(50);
    const wrapper = await mountList(messages);
    await scrollTo(wrapper, 200);
    await wrapper.setProps({ messages: [...messages, msg()] });
    await flushPromises();
    expect(feed(wrapper).scrollTop).toBe(200);
    expect(wrapper.find(".new-messages-pill").exists()).toBe(true);
  });

  it("the pill jumps to the latest message and disappears", async () => {
    const messages = many(50);
    const wrapper = await mountList(messages);
    await scrollTo(wrapper, 200);
    await wrapper.setProps({ messages: [...messages, msg()] });
    await flushPromises();
    await wrapper.find(".new-messages-pill").trigger("click");
    expect(feed(wrapper).scrollTop).toBe(bottom(51));
    expect(wrapper.find(".new-messages-pill").exists()).toBe(false);
  });

  it("the reader's own message being sent is always shown", async () => {
    const messages = many(50);
    const wrapper = await mountList(messages);
    await scrollTo(wrapper, 200);
    await wrapper.setProps({ messages: [...messages, msg({ status: "sending" })] });
    await flushPromises();
    expect(feed(wrapper).scrollTop).toBe(bottom(51));
  });

  it("an edit or status change does not move the reader", async () => {
    const messages = many(50);
    const wrapper = await mountList(messages);
    await scrollTo(wrapper, 200);
    await wrapper.setProps({ messages: messages.map((m, i) => (i === 10 ? { ...m, content: "edited" } : m)) });
    await flushPromises();
    expect(feed(wrapper).scrollTop).toBe(200);
    expect(wrapper.find(".new-messages-pill").exists()).toBe(false);
  });

  it("loading an older page keeps the same messages in view", async () => {
    const messages = many(50);
    const wrapper = await mountList(messages);
    await scrollTo(wrapper, 0);
    await wrapper.setProps({ isLoadingOlder: true });
    const older = Array.from({ length: 20 }, (_, i) => ({ ...msg(), id: `old${i}` }));
    await wrapper.setProps({ messages: [...older, ...messages], isLoadingOlder: false });
    await flushPromises();
    expect(feed(wrapper).scrollTop).toBe(20 * ROW);
  });

  it("switching conversation opens the new one at its latest message", async () => {
    const wrapper = await mountList(many(50), "c1");
    await scrollTo(wrapper, 100);
    await wrapper.setProps({ messages: many(200), conversationId: "c2" });
    await flushPromises();
    expect(feed(wrapper).scrollTop).toBe(bottom(200));
  });
});

describe("MessageList reveal (Inbox → Open in channel)", () => {
  it("scrolls to and highlights the target, then reports it", async () => {
    const messages = many(50);
    const target = messages[10];
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute("data-message-id") ?? "");
    };
    const wrapper = mount(MessageList, {
      props: { messages, conversationId: "c1", isLoading: false, isError: false, highlightId: target.id },
      global: { stubs: { MessageItem: { props: ["message"], template: '<div :data-message-id="message.id" />' } } },
    });
    await flushPromises();
    expect(scrolled).toContain(target.id);
    expect(wrapper.find(`[data-message-id="${target.id}"]`).classes()).toContain("is-highlighted");
    expect(wrapper.emitted("highlight-done")).toEqual([[true]]);
  });

  it("loads older pages while the target isn't loaded yet", async () => {
    const wrapper = mount(MessageList, {
      props: { messages: many(20), conversationId: "c1", isLoading: false, isError: false, hasOlderMessages: true, highlightId: "not-loaded" },
      global: { stubs: { MessageItem: { props: ["message"], template: '<div :data-message-id="message.id" />' } } },
    });
    await flushPromises();
    expect(wrapper.emitted("load-older")?.length).toBeGreaterThan(0);
    expect(wrapper.emitted("highlight-done")).toBeUndefined();
  });

  it("gives up honestly when history is exhausted", async () => {
    const wrapper = mount(MessageList, {
      props: { messages: many(5), conversationId: "c1", isLoading: false, isError: false, hasOlderMessages: false, highlightId: "gone" },
      global: { stubs: { MessageItem: { props: ["message"], template: '<div :data-message-id="message.id" />' } } },
    });
    await flushPromises();
    expect(wrapper.emitted("highlight-done")).toEqual([[false]]);
  });
});
