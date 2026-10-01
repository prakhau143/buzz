/**
 * Thread Index + thread rows: counts are visible as soon as the history page is
 * (no thread has to be opened), live replies add on top, more repliers than
 * avatars show "+N", and messages without replies offer "Reply in thread".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
vi.mock("@/composables/useProfile", () => ({
  useProfile: () => ({ data: ref(null), isLoading: ref(false), isError: ref(false) }),
}));
import { useThreadIndexStore } from "@/stores/threadIndex";
import { buildThreadSummaries, mergeThreadSummaries } from "@/features/threads/threadSummary";
import ThreadSummaryRow from "@/components/ThreadSummaryRow.vue";
import MessageItem from "@/components/MessageItem.vue";
import type { Message } from "@/types/domain";

const ROOT = "root-1";
const pk = (c: string) => c.repeat(64);

function msg(over: Partial<Message> = {}): Message {
  return {
    id: "m1",
    channelId: "ch",
    authorPubkey: pk("a"),
    content: "hello",
    createdAt: 100,
    thread: {},
    mentions: [],
    reactions: [],
    attachments: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    ...over,
  } as Message;
}

beforeEach(() => setActivePinia(createPinia()));

describe("thread index store", () => {
  it("holds the relay's summaries per channel, newest summary per root wins, resets on teardown", () => {
    const index = useThreadIndexStore();
    index.absorb("ch", [{ rootId: ROOT, replyCount: 2, lastReplyAt: 10, participants: [] }]);
    index.absorb("ch", [{ rootId: ROOT, replyCount: 3, lastReplyAt: 20, participants: [] }]);
    index.absorb("ch", [{ rootId: ROOT, replyCount: 1, lastReplyAt: 5, participants: [] }]); // an older page's stale copy
    expect(index.forChannel("ch").get(ROOT)?.replyCount).toBe(3);
    expect(index.forChannel("other").size).toBe(0);
    index.reset();
    expect(index.forChannel("ch").size).toBe(0);
  });

  it("fresh load: the relay's count shows with no replies loaded (the reload bug)", () => {
    const index = useThreadIndexStore();
    index.absorb("ch", [{ rootId: ROOT, replyCount: 3, lastReplyAt: 90, participants: [pk("p"), pk("m")] }]);
    const summaries = mergeThreadSummaries(buildThreadSummaries([msg({ id: ROOT })]), index.forChannel("ch"));
    expect(summaries.get(ROOT)).toMatchObject({ count: 3, participantPubkeys: [pk("p"), pk("m")], lastReplyAt: 90 });
  });
});

describe("ThreadSummaryRow", () => {
  it("shows +N when more people replied than avatars fit", () => {
    const w = mount(ThreadSummaryRow, {
      props: {
        summary: { rootId: ROOT, count: 5, participantPubkeys: [pk("a"), pk("b"), pk("c")], participantTotal: 5, lastReplyAt: 50 },
        now: 60_000,
      },
      global: { stubs: { ThreadParticipantAvatar: true, AvatarCircle: true } },
    });
    expect(w.find("[data-testid=thread-summary-count]").text()).toBe("5 replies");
    expect(w.find("[data-testid=thread-summary-more]").text()).toBe("+2");
  });

  it("singular label for one reply, and no +N", () => {
    const w = mount(ThreadSummaryRow, {
      props: { summary: { rootId: ROOT, count: 1, participantPubkeys: [pk("a")], participantTotal: 1, lastReplyAt: 50 }, now: 60_000 },
      global: { stubs: { ThreadParticipantAvatar: true, AvatarCircle: true } },
    });
    expect(w.find("[data-testid=thread-summary-count]").text()).toBe("1 reply");
    expect(w.find("[data-testid=thread-summary-more]").exists()).toBe(false);
  });
});

describe("Reply in thread affordance", () => {
  const mountItem = (props: Record<string, unknown>) =>
    mount(MessageItem, { props: { message: msg(), ...props }, global: { stubs: { MessageMenu: true, AvatarCircle: true } } });

  it("a message with no replies offers it in the feed, and it opens that message's thread", async () => {
    const w = mountItem({ replyAffordance: true });
    const button = w.find("[data-testid=reply-in-thread]");
    expect(button.exists()).toBe(true);
    await button.trigger("click");
    expect(w.emitted("open-thread")).toEqual([["m1"]]);
  });

  it("not when the message already has replies (its summary row shows instead)", () => {
    const w = mountItem({
      replyAffordance: true,
      threadSummary: { rootId: "m1", count: 2, participantPubkeys: [], lastReplyAt: 1 },
    });
    expect(w.find("[data-testid=reply-in-thread]").exists()).toBe(false);
    expect(w.find("[data-testid=thread-summary-row]").exists()).toBe(true);
  });

  it("not outside the main feed (thread panel, inbox) and not on replies", () => {
    expect(mountItem({}).find("[data-testid=reply-in-thread]").exists()).toBe(false);
    const reply = mount(MessageItem, {
      props: { message: msg({ thread: { rootId: ROOT } }), replyAffordance: true },
      global: { stubs: { MessageMenu: true, AvatarCircle: true } },
    });
    expect(reply.find("[data-testid=reply-in-thread]").exists()).toBe(false);
  });
});
