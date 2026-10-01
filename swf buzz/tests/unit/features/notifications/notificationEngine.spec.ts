/**
 * Windows notification engine: classify → policy → action, dedup, safe
 * previews, click targets, taskbar attention, and the "no secrets" rules.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nip19 } from "nostr-tools";
import {
  FRESHNESS_WINDOW_SECONDS,
  NotificationLedger,
  classifyMessage,
  identityFingerprint,
  isFresh,
  ledgerKey,
  messageTarget,
  needsActionBody,
  needsAttention,
  notificationContext,
  notificationTitle,
  parseNotificationTarget,
  safePreview,
  targetRoute,
} from "@/features/notifications/notificationEngine";
import { shouldAlert } from "@/features/notifications/desktopNotifier";
import { DEFAULT_NOTIFICATION_SETTINGS, sanitizeNotificationSettings } from "@/features/notifications/notificationSettings";
import { WAVE_MESSAGE_MARKER } from "@/features/dm/wave";
import type { Message } from "@/types/domain";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);
const COMMUNITY = "wss://buzz.example.com";

function msg(over: Partial<Message> = {}): Message {
  return {
    id: "1".repeat(64),
    channelId: "chan-1",
    authorPubkey: OTHER,
    content: "hello",
    createdAt: Math.floor(Date.now() / 1000),
    thread: {},
    mentions: [],
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    attachments: [],
    ...over,
  } as Message;
}

describe("classify", () => {
  it("a DM from someone else is a dm alert", () => {
    expect(classifyMessage(msg(), { me: ME, isDm: true })).toBe("dm");
  });
  it("an @mention in a channel is a mention; plain chatter is nothing", () => {
    expect(classifyMessage(msg({ mentions: [ME] }), { me: ME, isDm: false })).toBe("mention");
    expect(classifyMessage(msg(), { me: ME, isDm: false })).toBeNull();
  });
  it("a thread reply that tags me is a thread_reply", () => {
    const reply = msg({ id: "2".repeat(64), thread: { rootId: "1".repeat(64) }, mentions: [ME] });
    expect(classifyMessage(reply, { me: ME, isDm: false })).toBe("thread_reply");
  });
  it("never alerts for my own messages, system messages, or without an identity", () => {
    expect(classifyMessage(msg({ authorPubkey: ME }), { me: ME, isDm: true })).toBeNull();
    expect(classifyMessage(msg({ isSystemMessage: true }), { me: ME, isDm: true })).toBeNull();
    expect(classifyMessage(msg(), { me: null, isDm: true })).toBeNull();
  });
});

describe("policy", () => {
  const s = sanitizeNotificationSettings(null);
  it("respects the category switches and the master switch", () => {
    expect(shouldAlert({ slot: "dm", viewing: false }, s)).toBe(true);
    expect(shouldAlert({ slot: "dm", viewing: false }, { ...s, slots: { ...s.slots, dm: false } })).toBe(false);
    expect(shouldAlert({ slot: "mention", viewing: false }, { ...s, desktopEnabled: false })).toBe(false);
  });
  it("Notify while viewing: off suppresses the focused open conversation only", () => {
    expect(shouldAlert({ slot: "dm", viewing: true }, s, true)).toBe(false);
    expect(shouldAlert({ slot: "dm", viewing: true }, s, false)).toBe(true); // app in background
    expect(shouldAlert({ slot: "dm", viewing: true }, { ...s, notifyWhileViewing: true }, true)).toBe(true);
  });
  it("only fresh events alert (a reconnect replay of history does not)", () => {
    const now = 1_000_000;
    expect(isFresh(now - 10, now)).toBe(true);
    expect(isFresh(now - FRESHNESS_WINDOW_SECONDS - 1, now)).toBe(false);
    expect(isFresh(now + 30, now)).toBe(true); // sender's clock slightly ahead
  });
  it("the ledger alerts once per event, per identity and community", () => {
    const ledger = new NotificationLedger();
    const id = "9".repeat(64);
    expect(ledger.claim(ledgerKey(ME, COMMUNITY, id))).toBe(true);
    expect(ledger.claim(ledgerKey(ME, COMMUNITY, id))).toBe(false); // resubscribe / reconnect / duplicate delivery
    expect(ledger.claim(ledgerKey(OTHER, COMMUNITY, id))).toBe(true); // another identity is separate
    expect(ledger.claim(ledgerKey(ME, "wss://other.example.com", id))).toBe(true);
    ledger.clear();
    expect(ledger.claim(ledgerKey(ME, COMMUNITY, id))).toBe(true);
  });
  it("the ledger is bounded", () => {
    const ledger = new NotificationLedger(3);
    ["a", "b", "c", "d"].forEach((k) => ledger.claim(k));
    expect(ledger.claim("a")).toBe(true); // evicted oldest
    expect(ledger.claim("d")).toBe(false);
  });
  it("the taskbar setting defaults on and is sanitized", () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS.taskbarIndicator).toBe(true);
    expect(sanitizeNotificationSettings({ taskbarIndicator: false }).taskbarIndicator).toBe(false);
    expect(sanitizeNotificationSettings({ taskbarIndicator: "yes" }).taskbarIndicator).toBe(true);
  });
});

describe("titles and previews", () => {
  it("titles: DM = sender; mention / thread reply = sender · #channel; needs-action = SWF Buzz", () => {
    expect(notificationTitle("dm", "Rahul")).toBe("Rahul");
    expect(notificationTitle("mention", "Rahul", "general")).toBe("Rahul · #general");
    expect(notificationTitle("thread_reply", "Rahul", "general")).toBe("Rahul · #general");
    expect(notificationTitle("mention", "Rahul")).toBe("Rahul");
    expect(notificationTitle("needs_action", "Rahul")).toBe("SWF Buzz");
    expect(needsActionBody("Rahul", "Approve the deploy")).toBe("Rahul needs your action: Approve the deploy");
    expect(needsActionBody("Rahul", "Standup", true)).toBe("Reminder: Standup");
  });
  it("context lines for the in-app card", () => {
    expect(notificationContext("dm")).toBe("Direct message");
    expect(notificationContext("mention", "general")).toBe("#general · Mentioned you");
    expect(notificationContext("thread_reply", "general")).toBe("#general · Thread reply");
    expect(notificationContext("needs_action", null, true)).toBe("Reminder");
  });
  it("a wave shows its sentence, never the marker", () => {
    expect(safePreview(`${WAVE_MESSAGE_MARKER}\nRahul waved at you.`)).toBe("Rahul waved at you.");
  });
  it("markdown and HTML are flattened to one line", () => {
    expect(safePreview("**Deploy** is `done`\n\n> see [notes](https://x.io/a)")).toBe("Deploy is done see notes");
    expect(safePreview("<b>hi</b> there")).toBe("hi there");
  });
  it("mentions become names; links become hosts; images become [image]", () => {
    const npub = nip19.npubEncode(OTHER);
    const nameOf = (ref: string) => (ref === npub ? "Amit" : null);
    expect(safePreview(`ping nostr:${npub}`, { nameOf })).toBe("ping @Amit");
    expect(safePreview("see https://docs.example.com/path?q=1")).toBe("see docs.example.com");
    expect(safePreview("https://cdn.example.com/p.png")).toBe("[image]");
  });
  it("secret-key-looking text never reaches the notification centre", () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(7));
    const out = safePreview(`my key is ${nsec} oops`);
    expect(out).not.toContain("nsec1");
    expect(out).toContain("[hidden]");
    expect(safePreview("ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p")).toBe("[hidden]");
  });
  it("is bounded and never empty", () => {
    expect([...safePreview("x".repeat(500))]).toHaveLength(140);
    expect(safePreview("", { attachments: 1 })).toBe("Sent an attachment");
    expect(safePreview("   ")).toBe("New message");
  });
});

describe("click targets", () => {
  it("a thread reply routes to its channel, message and thread root", () => {
    const root = "1".repeat(64);
    const reply = msg({ id: "2".repeat(64), thread: { rootId: root } });
    const target = messageTarget(reply, { identity: ME, community: COMMUNITY, isDm: false });
    expect(target).toEqual({
      v: "1",
      identity: identityFingerprint(ME),
      community: COMMUNITY,
      kind: "channel",
      channelId: "chan-1",
      messageId: "2".repeat(64),
      threadRootId: root,
    });
    expect(targetRoute(target)).toEqual({ name: "channels", query: { channelId: "chan-1", messageId: "2".repeat(64), threadRootId: root } });
  });
  it("a DM routes to the conversation and message", () => {
    const target = messageTarget(msg({ channelId: "dm-9" }), { identity: ME, community: COMMUNITY, isDm: true });
    expect(targetRoute(target)).toEqual({ name: "dm", query: { conversationId: "dm-9", messageId: "1".repeat(64) } });
  });
  it("a needs-action toast routes to its Inbox row", () => {
    expect(targetRoute({ v: "1", identity: "x", community: COMMUNITY, kind: "inbox", item: "event:abc" })).toEqual({
      name: "inbox",
      query: { item: "event:abc" },
    });
  });
  it("round-trips through JSON and rejects anything unexpected", () => {
    const target = messageTarget(msg(), { identity: ME, community: COMMUNITY, isDm: false });
    expect(parseNotificationTarget(JSON.stringify(target))).toEqual(target);
    expect(parseNotificationTarget("not json")).toBeNull();
    expect(parseNotificationTarget({ ...target, v: "2" })).toBeNull();
    expect(parseNotificationTarget({ ...target, community: "javascript:alert(1)" })).toBeNull();
    expect(parseNotificationTarget({ ...target, kind: "settings" })).toBeNull();
    expect(parseNotificationTarget({ ...target, channelId: "../../etc" })).toBeNull(); // no channel → not routable
  });
  it("carries only ids — no key, token or secret material", () => {
    const target = messageTarget(msg(), { identity: ME, community: COMMUNITY, isDm: true });
    const json = JSON.stringify(target);
    expect(json).not.toMatch(/nsec|ncryptsec|token|secret|password|Authorization/i);
    expect(target.identity).toHaveLength(16); // a public-key fingerprint, not the key
    expect(Object.values(target).every((v) => typeof v === "string")).toBe(true); // native layer accepts strings only
  });
});

describe("taskbar attention", () => {
  const dmIds = new Set(["dm-1"]);
  it("unread DM, unread mention, or unread needs-action lights it", () => {
    expect(needsAttention({ unread: { "dm-1": 1 }, hasMention: {}, dmIds, needsActionUnread: 0 })).toBe(true);
    expect(needsAttention({ unread: { c: 2 }, hasMention: { c: true }, dmIds, needsActionUnread: 0 })).toBe(true);
    expect(needsAttention({ unread: {}, hasMention: {}, dmIds, needsActionUnread: 1 })).toBe(true);
  });
  it("ordinary channel chatter alone, or read items, do not", () => {
    expect(needsAttention({ unread: { c: 5 }, hasMention: {}, dmIds, needsActionUnread: 0 })).toBe(false);
    expect(needsAttention({ unread: { "dm-1": 0 }, hasMention: { c: true }, dmIds, needsActionUnread: 0 })).toBe(false);
  });
});

describe("wiring (source guards)", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "../../../../src", p), "utf8");
  it("the pipeline is session-wide (works in Settings), not in the sidebar", () => {
    expect(src("app/SessionServices.vue")).toContain("useNotificationService()");
    const sidebar = src("layouts/AppSidebar.vue");
    expect(sidebar).not.toContain("alertIfAllowed");
    expect(sidebar).not.toContain("useUnreadTracking(");
  });
  it("native toast, one sound: the chime is not played after a native toast", () => {
    const notifier = src("features/notifications/desktopNotifier.ts");
    const nativeBranch = notifier.slice(notifier.indexOf('await invoke("show_notification"'), notifier.indexOf("new Notification("));
    expect(nativeBranch).toContain(`return "native"`);
    expect(nativeBranch).not.toContain("playChime");
    expect(notifier).not.toMatch(/console\.(log|info|debug)/);
  });
  it("no HTML imitation popup and no payload logging in the service", () => {
    const service = src("features/notifications/useNotificationService.ts");
    expect(service).not.toMatch(/console\.(log|info|debug|warn)/);
    expect(service).toContain("setTaskbarIndicator(false)"); // cleared on sign-out/unmount
  });
});
