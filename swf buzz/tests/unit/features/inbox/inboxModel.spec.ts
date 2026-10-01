/** The Inbox model: relay feed rows → OLD BUZZ-style grouped items, filters, unread, scoping. */
import { describe, expect, it } from "vitest";
import { buildInboxItems, contextLabel, INBOX_FILTERS, isUnread, matchesFilter } from "@/features/inbox/inboxModel";
import type { RawNostrEvent } from "@/protocol/types";

const ME = "a".repeat(64);
const BOB = "b".repeat(64);
/** An external participant (e.g. OLD BUZZ's Poseidon agent) — just another pubkey to SWF. */
const EXTERNAL = "c".repeat(64);
const DM = "dm-channel";
const CH = "swf-project";

let n = 0;
const hex = (label: string) => Buffer.from(label).toString("hex").padEnd(64, "0").slice(0, 64);
function ev(over: Partial<RawNostrEvent> & { h?: string; root?: string; p?: string } = {}): RawNostrEvent {
  n += 1;
  const tags: string[][] = [];
  if (over.h ?? CH) tags.push(["h", over.h ?? CH]);
  // NIP-10 as the relay resolves it: a lone "reply" marker = direct reply to that root; ids are 64-hex.
  if (over.root) tags.push(["e", hex(over.root), "", "reply"]);
  if (over.p) tags.push(["p", over.p]);
  return { id: over.id ?? `e${n}`, pubkey: over.pubkey ?? BOB, created_at: over.created_at ?? 100 + n, kind: over.kind ?? 9, tags, content: over.content ?? `m${n}`, sig: "s" };
}
/** My own reply in a thread — what makes that thread "mine". */
const myReplyIn = (root: string) => ev({ pubkey: ME, root });

describe("buildInboxItems", () => {
  it("keeps mentions, DMs and replies in my threads; drops plain chatter and my own events", () => {
    const mention = ev({ p: ME });
    const dm = ev({ h: DM });
    const thread = ev({ root: "root-1" });
    const chatter = ev();
    const mine = ev({ pubkey: ME, h: DM });
    const items = buildInboxItems(
      { mentions: [mention], needsAction: [], activity: [dm, thread, chatter, mine] },
      ME,
      new Set([DM]),
      [myReplyIn("root-1")],
    );
    expect(items.map((i) => i.type).sort()).toEqual(["dm", "mention", "thread"]);
  });

  it("groups one row per DM and per thread root, keeping the newest event", () => {
    const a = ev({ h: DM, created_at: 10 });
    const b = ev({ h: DM, created_at: 20 });
    const r1 = ev({ root: "r", created_at: 5 });
    const r2 = ev({ root: "r", created_at: 30 });
    const items = buildInboxItems({ mentions: [], needsAction: [], activity: [a, b, r1, r2] }, ME, new Set([DM]), [myReplyIn("r")]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ key: `thread:${hex("r")}`, count: 2, createdAt: 30 });
    expect(items[1]).toMatchObject({ key: `dm:${DM}`, count: 2, createdAt: 20 });
  });

  it("the same event in two categories is one row", () => {
    const m = ev({ p: ME });
    expect(buildInboxItems({ mentions: [m], needsAction: [], activity: [m] }, ME, new Set())).toHaveLength(1);
  });

  it("needs_action splits into approvals and reminders; a job event that doesn't concern me is not a row", () => {
    const approval = ev({ kind: 46010, p: ME });
    const reminder = ev({ kind: 40007, p: ME });
    const job = ev({ kind: 43004 });
    const items = buildInboxItems({ mentions: [], needsAction: [approval, reminder], activity: [job] }, ME, new Set());
    expect(items.map((i) => i.type).sort()).toEqual(["needs_action", "reminder"]);
  });
});

describe("Inbox scoping — activity must concern me (Master Spec §2)", () => {
  const scoped = (activity: RawNostrEvent[], myEvents: RawNostrEvent[] = []) =>
    buildInboxItems({ mentions: [], needsAction: [], activity }, ME, new Set([DM]), myEvents);

  it("an external participant replying in SOMEONE ELSE'S thread I never touched → not in my Inbox", () => {
    expect(scoped([ev({ pubkey: EXTERNAL, root: "bobs-thread" })])).toEqual([]);
  });

  it("…the same reply in a thread I PARTICIPATED in → appears", () => {
    const items = scoped([ev({ pubkey: EXTERNAL, root: "bobs-thread" })], [myReplyIn("bobs-thread")]);
    expect(items.map((i) => i.type)).toEqual(["thread"]);
  });

  it("…a reply in a thread whose ROOT I authored → appears", () => {
    const root = ev({ pubkey: ME, id: hex("my-root") });
    const items = scoped([ev({ pubkey: EXTERNAL, root: "my-root" })], [root]);
    expect(items.map((i) => i.type)).toEqual(["thread"]);
  });

  it("an external participant p-tagging me → appears", () => {
    expect(scoped([ev({ pubkey: EXTERNAL, root: "bobs-thread", p: ME })])).toHaveLength(1);
  });

  it("a DM to me → appears", () => {
    expect(scoped([ev({ pubkey: EXTERNAL, h: DM })]).map((i) => i.type)).toEqual(["dm"]);
  });

  it("who the author is plays no part: a human in someone else's thread is filtered the same way", () => {
    expect(scoped([ev({ pubkey: BOB, root: "bobs-thread" })])).toEqual([]);
  });

  it("my own feed rows count as participation even without a separate fetch", () => {
    const items = buildInboxItems(
      { mentions: [], needsAction: [], activity: [myReplyIn("t"), ev({ pubkey: EXTERNAL, root: "t" })] },
      ME,
      new Set(),
    );
    expect(items).toHaveLength(1);
  });
});

describe("filters (SWF product boundary: no Agents or Projects)", () => {
  it("offers All · Mentions · Threads · Needs action | Reminders — never Agents or Projects", () => {
    expect(INBOX_FILTERS.map((f) => f.label)).toEqual(["All", "Mentions", "Threads", "Needs action", "Reminders"]);
    expect(INBOX_FILTERS.find((f) => f.value === "reminders")?.separatorBefore).toBe(true);
  });

  it("each filter selects the right rows", () => {
    const rows = buildInboxItems(
      {
        mentions: [ev({ p: ME }), ev({ p: ME, root: "t1" }), ev({ kind: 1618, p: ME })],
        needsAction: [ev({ kind: 46010, p: ME }), ev({ kind: 40007, p: ME })],
        activity: [ev({ h: DM }), ev({ kind: 43001 })],
      },
      ME,
      new Set([DM]),
    );
    const count = (f: Parameters<typeof matchesFilter>[1]) => rows.filter((r) => matchesFilter(r, f)).length;
    expect(count("mentions")).toBe(3); // a project event that mentions me is still a mention
    expect(count("threads")).toBe(1);
    expect(count("needs_action")).toBe(1);
    expect(count("reminders")).toBe(1);
    expect(count("all")).toBe(5); // 3 mentions + needs action + DM; the unrelated job event is not a row
  });
});

describe("unread and labels", () => {
  it("unread = newer than the channel's synced read frontier", () => {
    const [item] = buildInboxItems({ mentions: [ev({ p: ME, created_at: 500 })], needsAction: [], activity: [] }, ME, new Set());
    expect(isUnread(item, () => 499)).toBe(true);
    expect(isUnread(item, () => 500)).toBe(false);
  });

  it("context lines follow the item type", () => {
    const [dm] = buildInboxItems({ mentions: [], needsAction: [], activity: [ev({ h: DM })] }, ME, new Set([DM]));
    const [thread] = buildInboxItems({ mentions: [], needsAction: [], activity: [ev({ root: "r" })] }, ME, new Set(), [
      myReplyIn("r"),
    ]);
    expect(contextLabel(dm, null, "Devankit")).toBe("DM from Devankit");
    expect(contextLabel(thread, "SWF Project", "Devankit")).toBe("Thread in #SWF Project");
  });
});
