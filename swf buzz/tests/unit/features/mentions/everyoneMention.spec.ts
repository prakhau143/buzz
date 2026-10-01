/**
 * Phase G — `@everyone` (features/mentions/everyone.ts, protocol/messages.ts
 * EVERYONE_MENTION_TAG). A semantic audience mention: offered in community
 * channels only, sent as a tag, rendered as the same chip as a person mention,
 * and resolved by each READER through the one notification / unread / Inbox
 * pipeline — never from text alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

vi.mock("@/features/channels/ChannelService", () => ({ channelService: { fetchMembers: vi.fn(async () => []) } }));
vi.mock("@/features/community-members/RelayMembersService", () => ({
  relayMembersService: { fetchMembershipList: vi.fn(async () => []) },
}));

import MessageComposer from "@/components/MessageComposer.vue";
import MessageContent from "@/features/mentions/MessageContent";
import {
  buildMessageEditEvent,
  buildMessageEvent,
  EVERYONE_MENTION_TAG,
  hasEveryoneMentionTag,
  parseMessageEvent,
} from "@/protocol/messages";
import { draftMentionsEveryone, everyoneAllowedIn, messageMentionsMe } from "@/features/mentions/everyone";
import { segmentMessage } from "@/features/mentions/messageSegments";
import { classifyMessage } from "@/features/notifications/notificationEngine";
import { countsAsUnread } from "@/features/readState/unreadPolicy";
import { buildInboxItems } from "@/features/inbox/inboxModel";
import { applyEdit, emptyOverlays, renderTimeline } from "@/features/messages/messageOverlay";
import { classifyTimelineEvent } from "@/features/messages/MessageService";
import type { MentionCandidate } from "@/features/mentions/mentionModel";
import type { Message } from "@/types/domain";
import type { RawNostrEvent } from "@/protocol/types";

const ME = "1".repeat(64);
const SENDER = "2".repeat(64);
const DEV = "d".repeat(64);
const CANDIDATES: MentionCandidate[] = [{ pubkey: DEV, displayName: "Devankit", inChannel: true }];

function raw(partial: Partial<RawNostrEvent> & { tags: string[][] }): RawNostrEvent {
  return {
    id: partial.id ?? "e".repeat(64),
    pubkey: partial.pubkey ?? SENDER,
    created_at: partial.created_at ?? 100,
    kind: partial.kind ?? 9,
    content: partial.content ?? "@everyone please review",
    tags: partial.tags,
    sig: "",
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    channelId: "ch",
    authorPubkey: SENDER,
    content: "@everyone please review this before 5 PM",
    createdAt: 100,
    thread: {},
    mentions: [],
    mentionsEveryone: true,
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    attachments: [],
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Composer + picker
// ---------------------------------------------------------------------------

function mountComposer(kind: "channel" | "dm" = "channel") {
  return mount(MessageComposer, {
    props: { mentionCandidates: CANDIDATES, mentionScope: { kind, channelId: "ch" } },
    attachTo: document.body,
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] },
  });
}
async function type(wrapper: VueWrapper, value: string) {
  const textarea = wrapper.find("textarea");
  await textarea.setValue(value);
  (textarea.element as HTMLTextAreaElement).setSelectionRange(value.length, value.length);
  await textarea.trigger("keyup");
}
const key = (wrapper: VueWrapper, name: string) => wrapper.find("textarea").trigger("keydown", { key: name });
const value = (wrapper: VueWrapper) => (wrapper.find("textarea").element as HTMLTextAreaElement).value;
const flush = () => new Promise((r) => setTimeout(r));

describe("23–25. the @everyone picker", () => {
  it("offers @everyone first while typing @eve in a channel", async () => {
    const w = mountComposer();
    await type(w, "@eve");
    const row = w.find("[data-testid=mention-option-everyone]");
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain("@everyone");
    expect(row.text()).toContain("Mention everyone");
    expect(row.attributes("aria-selected")).toBe("true");
  });

  it("lists people first and @everyone last for a bare @", async () => {
    const w = mountComposer();
    await type(w, "@");
    const ids = w.findAll("[role=option]").map((o) => o.attributes("data-testid"));
    expect(ids).toEqual(["mention-option", "mention-option-everyone"]);
  });

  it("is never offered in a DM", async () => {
    const w = mountComposer("dm");
    await type(w, "@eve");
    expect(w.find("[data-testid=mention-option-everyone]").exists()).toBe(false);
  });

  it("24. Enter selects it and inserts @everyone; Escape closes the picker", async () => {
    const w = mountComposer();
    await type(w, "hey @eve");
    await key(w, "Enter");
    expect(value(w)).toBe("hey @everyone ");
    await type(w, `${value(w)}@eve`);
    await key(w, "Escape");
    expect(w.find("[data-testid=mention-picker]").exists()).toBe(false);
  });

  it("arrow keys move between @everyone and people", async () => {
    const w = mountComposer();
    await type(w, "@");
    await key(w, "ArrowUp"); // wraps to the last row: @everyone
    expect(w.find("[data-testid=mention-option-everyone]").attributes("aria-selected")).toBe("true");
    await key(w, "ArrowDown");
    expect(w.find("[data-testid=mention-option]").attributes("aria-selected")).toBe("true");
  });

  it("mouse/touch selection works (mousedown keeps focus in the textarea)", async () => {
    const w = mountComposer();
    await type(w, "@ev");
    await w.find("[data-testid=mention-option-everyone]").trigger("mousedown");
    expect(value(w)).toBe("@everyone ");
  });
});

describe("E4. what the composer sends", () => {
  it("a picked @everyone is sent as the semantic mention", async () => {
    const w = mountComposer();
    await type(w, "@eve");
    await key(w, "Enter");
    await type(w, `${value(w)}please review`);
    await key(w, "Enter");
    await flush();
    expect(w.emitted("send")?.[0]).toEqual(["@everyone please review", [], [], { mentionsEveryone: true }]);
  });

  it("a typed @everyone (with punctuation, multiline) counts too", async () => {
    const w = mountComposer();
    await type(w, "Heads up\n(@everyone): deploy at 5");
    await key(w, "Enter");
    await flush();
    expect(w.emitted("send")?.[0][3]).toEqual({ mentionsEveryone: true });
  });

  it("@everyone deleted from the draft, inside code, or in a DM is not a mention", async () => {
    expect(draftMentionsEveryone("ping `@everyone` later")).toBe(false);
    expect(draftMentionsEveryone("mail team@everyone.dev")).toBe(false);
    expect(draftMentionsEveryone("@everyones")).toBe(false);
    const w = mountComposer("dm");
    await type(w, "@everyone hi");
    await key(w, "Enter");
    await flush();
    expect(w.emitted("send")?.[0][3]).toEqual({ mentionsEveryone: false });
  });

  it("keeps person mentions alongside it", async () => {
    const w = mountComposer();
    await type(w, "@dev");
    await key(w, "Enter");
    await type(w, `${value(w)}and @everyone please`);
    await key(w, "Enter");
    await flush();
    expect(w.emitted("send")?.[0]).toEqual(["@Devankit and @everyone please", [DEV], [], { mentionsEveryone: true }]);
  });

  it("is offered only in channels", () => {
    expect(everyoneAllowedIn({ kind: "channel" })).toBe(true);
    expect(everyoneAllowedIn({ kind: "dm" })).toBe(false);
    expect(everyoneAllowedIn(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

describe("26. semantic event representation", () => {
  it("a channel message carries the dedicated tag, distinct from p tags", () => {
    const event = buildMessageEvent({ channelId: "ch", content: "@everyone hi", mentionsEveryone: true, mentionPubkeys: [DEV] });
    expect(event.tags).toContainEqual([...EVERYONE_MENTION_TAG]);
    expect(event.tags.filter((t) => t[0] === "p")).toEqual([["p", DEV]]);
  });

  it("without the flag there is no tag — text alone is never the mention", () => {
    const event = buildMessageEvent({ channelId: "ch", content: "@everyone hi" });
    expect(hasEveryoneMentionTag(event)).toBe(false);
    expect(parseMessageEvent(raw({ tags: [["h", "ch"]] })).mentionsEveryone).toBe(false);
  });

  it("parses the tag back", () => {
    expect(parseMessageEvent(raw({ tags: [["h", "ch"], ["mention", "everyone"]] })).mentionsEveryone).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("27–29, 40–41. rendering", () => {
  it("renders the chip only for an event carrying the tag", () => {
    const tagged = mount(MessageContent, { props: { content: "@everyone please review", mentionsEveryone: true } });
    const chip = tagged.find("[data-testid=everyone-mention-chip]");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("@everyone");
    expect(chip.attributes("data-mention-kind")).toBe("everyone");
    expect(chip.attributes("aria-label")).toContain("Mentions everyone");
    expect(chip.attributes("tabindex")).toBe("0");

    const plain = mount(MessageContent, { props: { content: "@everyone please review", mentionsEveryone: false } });
    expect(plain.find("[data-testid=everyone-mention-chip]").exists()).toBe(false);
    expect(plain.text()).toBe("@everyone please review");
  });

  it("uses the same mention chip class and tokens as a person mention (theme-aware)", () => {
    const w = mount(MessageContent, { props: { content: "@everyone", mentionsEveryone: true } });
    expect(w.find(".mention-chip").exists()).toBe(true);
  });

  it("segments text, @everyone and links in order, without nesting", () => {
    const segments = segmentMessage("@everyone see https://example.com.", new Map(), { everyone: true });
    expect(segments.map((s) => s.kind)).toEqual(["everyone", "text", "link", "text"]);
    expect(segments.at(-1)).toEqual({ kind: "text", text: "." });
  });
});

// ---------------------------------------------------------------------------
// Notifications / unread / Inbox — the existing pipeline, reader-resolved
// ---------------------------------------------------------------------------

describe("30–34. classification", () => {
  it("31. a channel @everyone is a mention for every reader", () => {
    expect(classifyMessage(message(), { me: ME, isDm: false })).toBe("mention");
    expect(classifyMessage(message({ thread: { rootId: "root", parentId: "root" } }), { me: ME, isDm: false })).toBe(
      "thread_reply",
    );
  });

  it("32. the sender is never notified by their own @everyone", () => {
    expect(classifyMessage(message({ authorPubkey: ME }), { me: ME, isDm: false })).toBeNull();
    expect(messageMentionsMe(message({ authorPubkey: ME }), ME)).toBe(false);
  });

  it("text without the tag notifies nobody", () => {
    expect(classifyMessage(message({ mentionsEveryone: false }), { me: ME, isDm: false })).toBeNull();
  });

  it("a DM never treats it as an audience mention", () => {
    expect(messageMentionsMe(message(), ME, { isDm: true })).toBe(false);
  });

  it("a thread reply with @everyone counts toward unread (mentions me)", () => {
    expect(countsAsUnread(message({ thread: { rootId: "r", parentId: "r" } }), ME)).toBe(true);
    expect(countsAsUnread(message({ thread: { rootId: "r", parentId: "r" }, mentionsEveryone: false }), ME)).toBe(false);
  });

  it("30/34. Inbox: an accessible channel's @everyone becomes a mention row; DMs and my own don't", () => {
    const everyone = raw({ id: "1".padStart(64, "0"), tags: [["h", "ch"], ["mention", "everyone"]] });
    const mine = raw({ id: "2".padStart(64, "0"), pubkey: ME, tags: [["h", "ch"], ["mention", "everyone"]] });
    const inDm = raw({ id: "3".padStart(64, "0"), tags: [["h", "dm-1"], ["mention", "everyone"]] });
    const chatter = raw({ id: "4".padStart(64, "0"), content: "@everyone text only", tags: [["h", "ch"]] });
    const items = buildInboxItems({ mentions: [], needsAction: [], activity: [everyone, mine, inDm, chatter] }, ME, new Set(["dm-1"]));
    const byId = new Map(items.map((i) => [i.event.id, i]));
    expect(byId.get(everyone.id)?.mentionsMe).toBe(true);
    expect(byId.has(mine.id)).toBe(false);
    expect(byId.get(inDm.id)?.mentionsMe).toBe(false);
    expect(byId.has(chatter.id)).toBe(false);
  });

  it("33. dedup is the existing ledger's: classification is pure and idempotent", () => {
    const m = message();
    expect(classifyMessage(m, { me: ME, isDm: false })).toBe(classifyMessage(m, { me: ME, isDm: false }));
  });
});

// ---------------------------------------------------------------------------
// Edits / replies / threads
// ---------------------------------------------------------------------------

describe("35–37. preservation", () => {
  it("35. an edit keeps the original @everyone and may re-assert it", () => {
    const edit = buildMessageEditEvent({ channelId: "ch", targetEventId: "m1", content: "@everyone updated", mentionsEveryone: true });
    expect(hasEveryoneMentionTag(edit)).toBe(true);

    const classified = classifyTimelineEvent(
      raw({ id: "f".repeat(64), kind: 40003, content: "@everyone updated", tags: [["h", "ch"], ["e", "m1"], ["mention", "everyone"]] }),
    );
    expect(classified?.type).toBe("edit");
    const overlays = emptyOverlays();
    if (classified?.type === "edit") applyEdit(overlays, classified.edit);
    const [rendered] = renderTimeline([message({ id: "m1" })], overlays);
    expect(rendered.content).toBe("@everyone updated");
    expect(rendered.mentionsEveryone).toBe(true);
  });

  it("an edit from an older client without the tag does not strip it", () => {
    const overlays = emptyOverlays();
    applyEdit(overlays, { eventId: "x", targetId: "m1", authorPubkey: SENDER, content: "@everyone v2", createdAt: 200 });
    expect(renderTimeline([message({ id: "m1" })], overlays)[0].mentionsEveryone).toBe(true);
  });

  it("36/37. a thread reply carries the tag like any channel message", () => {
    const reply = buildMessageEvent({
      channelId: "ch",
      content: "@everyone thread update",
      mentionsEveryone: true,
      reply: { rootEventId: "9".repeat(64), parentEventId: "9".repeat(64), parentAuthorPubkey: DEV },
    });
    const parsed = parseMessageEvent(raw({ tags: reply.tags, content: reply.content }));
    expect(parsed.mentionsEveryone).toBe(true);
    expect(parsed.thread.rootId).toBe("9".repeat(64));
  });
});
