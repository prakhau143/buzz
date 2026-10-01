import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { useSessionStore } from "@/stores/session";
import { useSendMessage } from "@/features/messages/useSendMessage";
import type { Message } from "@/types/domain";
import type { ThreadData } from "@/features/threads/ThreadService";

/**
 * Bug: a reply sent from the thread composer appeared in the channel feed but
 * NOT in the thread panel until the thread was closed and reopened.
 *
 * Root cause: `useSendMessage.send()` wrote the optimistic message and the
 * relay-confirmed one only to `queryKeys.channelMessages(channelId)`. The
 * thread panel reads `queryKeys.thread(rootId)`, which nothing on the send path
 * ever touched — only `ThreadService.subscribeToThread`'s relay echo, which is
 * a separate subscription and does not reliably deliver one's own event.
 *
 * These tests drive the real composable against a real QueryClient with only
 * the relay send mocked.
 */
const sendMock = vi.fn();
vi.mock("@/features/messages/MessageService", () => ({
  messageService: { send: (...args: unknown[]) => sendMock(...args) },
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
vi.mock("@tanstack/vue-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/vue-query")>("@tanstack/vue-query");
  return { ...actual, useQueryClient: () => queryClient };
});

const ME = "ab".repeat(32);
const CHANNEL = "channel-1";
const ROOT = "root-event-1";

const rootMessage: Message = {
  id: ROOT,
  channelId: CHANNEL,
  authorPubkey: "cd".repeat(32),
  content: "parent",
  createdAt: 100,
  thread: {},
  mentions: [],
  reactions: [],
  status: "sent",
  isSystemMessage: false,
  isAgentMessage: false,
};

function seedThread(replies: Message[] = []): void {
  queryClient.setQueryData<ThreadData>(queryKeys.thread(ROOT), {
    root: rootMessage,
    replies,
    summary: null,
  });
}
const thread = () => queryClient.getQueryData<ThreadData>(queryKeys.thread(ROOT));
const feed = () => queryClient.getQueryData<Message[]>(queryKeys.channelMessages(CHANNEL)) ?? [];

function sendReply(content = "my reply") {
  const { send } = useSendMessage(() => CHANNEL);
  return send({ content, reply: { rootEventId: ROOT, parentEventId: ROOT } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  queryClient.clear();
  sendMock.mockReset();
  useSessionStore().setIdentity({
    authMode: "local",
    employeeEmail: null,
    applicationUserId: null,
    pubkey: ME,
  });
});

describe("sending a reply updates the THREAD immediately, not only the channel feed", () => {
  it("shows the reply in the thread panel's data as 'sending', before the relay confirms", async () => {
    seedThread();
    let resolveSend: (m: Message) => void = () => {};
    sendMock.mockImplementation(() => new Promise<Message>((r) => (resolveSend = r)));

    const pending = sendReply();
    await Promise.resolve();
    await Promise.resolve();

    // The thread panel would render this — previously it stayed empty.
    expect(thread()!.replies).toHaveLength(1);
    expect(thread()!.replies[0]).toMatchObject({ content: "my reply", status: "sending" });
    expect(thread()!.replies[0].thread.rootId).toBe(ROOT);

    resolveSend({ ...rootMessage, id: "confirmed-1", content: "my reply", createdAt: 200, thread: { rootId: ROOT, parentId: ROOT }, authorPubkey: ME });
    await pending;
  });

  it("reconciles the optimistic reply with the confirmed event — no duplicate", async () => {
    seedThread();
    const confirmed: Message = { ...rootMessage, id: "confirmed-1", content: "my reply", createdAt: 200, authorPubkey: ME, thread: { rootId: ROOT, parentId: ROOT } };
    sendMock.mockResolvedValue(confirmed);

    await sendReply();

    expect(thread()!.replies).toHaveLength(1);
    expect(thread()!.replies[0].id).toBe("confirmed-1");
    expect(thread()!.replies.filter((m) => m.status === "sending")).toHaveLength(0);
  });

  it("does not duplicate when the live subscription delivered the same event first", async () => {
    const confirmed: Message = { ...rootMessage, id: "confirmed-1", content: "my reply", createdAt: 200, authorPubkey: ME, thread: { rootId: ROOT, parentId: ROOT } };
    seedThread();
    sendMock.mockImplementation(async () => {
      // the relay echo arrives through subscribeToThread while the send is in flight
      queryClient.setQueryData<ThreadData>(queryKeys.thread(ROOT), (c) => ({
        ...c!,
        replies: [...c!.replies, confirmed],
      }));
      return confirmed;
    });

    await sendReply();

    expect(thread()!.replies.filter((m) => m.id === "confirmed-1")).toHaveLength(1);
    expect(thread()!.replies.some((m) => m.id.startsWith("optimistic-"))).toBe(false);
  });

  it("marks the reply failed IN THE THREAD when the send fails, keeping its content for retry", async () => {
    seedThread();
    sendMock.mockRejectedValue(new Error("relay refused"));

    await sendReply("will fail");

    expect(thread()!.replies).toHaveLength(1);
    expect(thread()!.replies[0]).toMatchObject({ content: "will fail", status: "failed" });
  });

  it("keeps replies ordered by time when one arrives out of order", async () => {
    const earlier: Message = { ...rootMessage, id: "earlier", createdAt: 150, thread: { rootId: ROOT, parentId: ROOT } };
    seedThread([earlier]);
    sendMock.mockResolvedValue({ ...rootMessage, id: "later", createdAt: 120, authorPubkey: ME, thread: { rootId: ROOT, parentId: ROOT } });

    await sendReply();

    expect(thread()!.replies.map((m) => m.createdAt)).toEqual([120, 150]);
  });

  it("a NON-reply message touches only the channel feed, never a thread", async () => {
    seedThread();
    sendMock.mockResolvedValue({ ...rootMessage, id: "plain-1", content: "top level", authorPubkey: ME });
    const { send } = useSendMessage(() => CHANNEL);

    await send({ content: "top level" });

    expect(thread()!.replies).toHaveLength(0);
    expect(feed().map((m) => m.id)).toEqual(["plain-1"]);
  });

  it("a thread that has not been opened is left alone (its own fetch will include the reply)", async () => {
    // no seedThread() — the panel was never opened
    sendMock.mockResolvedValue({ ...rootMessage, id: "confirmed-1", authorPubkey: ME, thread: { rootId: ROOT, parentId: ROOT } });

    await sendReply();

    expect(thread()).toBeUndefined(); // no cache entry invented
    expect(feed()).toHaveLength(1); // but the channel feed still got it
  });
});

describe("the channel feed shows top-level messages only", () => {
  /**
   * Mirrors `ChannelsView`'s `topLevelMessages` filter. A reply is represented
   * under its parent by the thread summary row, never as a new feed message.
   */
  const topLevel = (messages: Message[]) => messages.filter((m) => !m.thread.rootId);

  it("excludes replies and keeps their parents", () => {
    const reply: Message = { ...rootMessage, id: "r1", thread: { rootId: ROOT, parentId: ROOT } };
    const nested: Message = { ...rootMessage, id: "r2", thread: { rootId: ROOT, parentId: "r1" } };
    const other: Message = { ...rootMessage, id: "top-2", thread: {} };

    expect(topLevel([rootMessage, reply, nested, other]).map((m) => m.id)).toEqual([ROOT, "top-2"]);
  });

  it("a reply whose parent is not loaded is still not shown as top level", () => {
    const orphan: Message = { ...rootMessage, id: "orphan", thread: { rootId: "not-loaded", parentId: "not-loaded" } };
    expect(topLevel([orphan])).toEqual([]);
  });
});
