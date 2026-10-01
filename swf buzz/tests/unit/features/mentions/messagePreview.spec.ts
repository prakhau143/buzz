/**
 * Phase G — semantic message previews: Inbox rows, Search results, in-app
 * notifications and the action-sheet context draw a message with the SAME
 * tokens as the message itself (`p`-tag mentions, the semantic `@everyone`,
 * links, in order), compact and non-interactive. One tokenizer, one profile
 * registry, batched lookups, no `v-html`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { defineComponent, h, nextTick } from "vue";
import type { RawNostrEvent } from "@/protocol/types";

const fetchProfiles = vi.fn(async (_pubkeys: readonly string[]) => new Map());
vi.mock("@/services/ProfileService", () => ({ profileService: { fetchProfiles: (p: readonly string[]) => fetchProfiles(p) } }));

const MessagePreviewMod = await import("@/features/mentions/MessagePreview");
const MessagePreview = MessagePreviewMod.default;
const { previewText } = MessagePreviewMod;
const tokens = await import("@/features/mentions/messageTokens");
const { absorbProfileEvents, clearProfileStore } = await import("@/features/profile/profileStore");
const { EVERYONE_MENTION_TAG } = await import("@/protocol/messages");
const InboxListPane = (await import("@/features/inbox/ui/InboxListPane.vue")).default;
const { safePreview } = await import("@/features/notifications/notificationEngine");

const PRAKHAR = "a".repeat(64);
const DEV = "b".repeat(64);
const LONG = "c".repeat(64);
const UNKNOWN = "f".repeat(64);
const LONG_NAME = "Venkata Subramanian Raghunathan Iyer-Krishnamurthy (Platform Engineering)";

function profile(pubkey: string, name: string): RawNostrEvent {
  return { id: pubkey.slice(0, 8).padEnd(64, "0"), pubkey, created_at: 1, kind: 0, tags: [], content: JSON.stringify({ display_name: name }), sig: "" };
}

let pinia: Pinia;
const mounted: { unmount: () => void }[] = [];
function preview(content: string, mentions: string[] = [], opts: { everyone?: boolean; raw?: boolean; max?: number } = {}) {
  const w = mount(MessagePreview, {
    props: { content, mentions, mentionsEveryone: !!opts.everyone, raw: !!opts.raw, ...(opts.max ? { max: opts.max } : {}) },
    attachTo: document.body,
    global: { plugins: [pinia] },
  });
  mounted.push(w);
  return w;
}
/** Mount inside a host so the fragment's nodes have one parent to read. */
function inHost(content: string, mentions: string[] = [], opts: { everyone?: boolean; raw?: boolean } = {}) {
  const Host = defineComponent({
    setup: () => () => h("p", { class: "host" }, [h(MessagePreview, { content, mentions, mentionsEveryone: !!opts.everyone, raw: !!opts.raw })]),
  });
  const w = mount(Host, { attachTo: document.body, global: { plugins: [pinia] } });
  mounted.push(w);
  const host = w.find(".host").element as HTMLElement;
  return {
    w,
    host,
    text: () =>
      [...host.childNodes]
        .map((n) => {
          if (n.nodeType === Node.TEXT_NODE) return n.textContent;
          const el = n as HTMLElement;
          if (el.dataset.testid === "preview-link") return `🔗${el.textContent}`;
          return `[${el.textContent}]`;
        })
        .join(""),
  };
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  clearProfileStore();
  absorbProfileEvents([profile(PRAKHAR, "Prakhar Mittal"), profile(DEV, "Devankit"), profile(LONG, LONG_NAME)]);
  tokens.resetMentionProfileRequestsForTests();
  fetchProfiles.mockClear();
  document.body.innerHTML = "";
});
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe("semantic tokens in a preview", () => {
  it("1. a single person mention is a chip; the rest stays normal text", () => {
    const { text, host } = inHost("@Prakhar Mittal Good question — here's a straight read", [PRAKHAR]);
    expect(text()).toBe("[@Prakhar Mittal] Good question — here's a straight read");
    const chip = host.querySelector("[data-testid=preview-mention]")!;
    expect(chip.getAttribute("data-mention-pubkey")).toBe(PRAKHAR);
    expect(chip.className).toBe("mp-chip");
  });

  it("2. multiple mentions stay separate chips with their spaces", () => {
    expect(inHost("@Prakhar Mittal @Devankit please check", [PRAKHAR, DEV]).text()).toBe("[@Prakhar Mittal] [@Devankit] please check");
  });

  it("3. @everyone with the semantic tag is a chip (same family, group glyph)", () => {
    const { text, host } = inHost("@everyone Please review this before 5 PM.", [], { everyone: true });
    expect(text()).toBe("[@everyone] Please review this before 5 PM.");
    const chip = host.querySelector("[data-testid=preview-everyone]")!;
    expect(chip.classList).toContain("mp-chip");
    expect(chip.querySelector(".mp-glyph")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("4. person mentions + @everyone together", () => {
    expect(inHost("@Prakhar Mittal @Devankit @everyone ship it", [PRAKHAR, DEV], { everyone: true }).text()).toBe(
      "[@Prakhar Mittal] [@Devankit] [@everyone] ship it",
    );
  });

  it("5–6. mentions + a URL: the link is a link token, compact host/path", () => {
    const { text } = inHost("@Prakhar Mittal @Devankit https://x.com/buzzdotxyz/status/2105348", [PRAKHAR, DEV]);
    expect(text()).toBe("[@Prakhar Mittal] [@Devankit] 🔗x.com/buzzdotxyz/status/2105348");
    const single = inHost("@Devankit see https://example.com/a", [DEV]).text();
    expect(single).toBe("[@Devankit] see 🔗example.com/a");
  });

  it("7. plain text stays plain text (no tokens)", () => {
    const { host } = inHost("Just a normal sentence, nothing special.");
    expect(host.querySelectorAll("span").length).toBe(0);
    expect(host.textContent).toBe("Just a normal sentence, nothing special.");
  });

  it("8–9. token order is the message order", () => {
    expect(inHost("Hello @Prakhar Mittal check https://example.com @Devankit", [PRAKHAR, DEV]).text()).toBe(
      "Hello [@Prakhar Mittal] check 🔗example.com [@Devankit]",
    );
  });

  it("10–11. long names stay whole inside their chip (the full name is the title)", () => {
    const { host } = inHost(`@${LONG_NAME} and @Prakhar Mittal`, [LONG, PRAKHAR]);
    const chips = host.querySelectorAll("[data-testid=preview-mention]");
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe(`@${LONG_NAME}`);
    expect(chips[0].getAttribute("title")).toBe(LONG_NAME);
  });

  it("12. the preview is normalised and capped before tokenizing", () => {
    expect(previewText("a  <!-- hidden -->\n\n b")).toBe("a b");
    const long = previewText("x".repeat(500), 280);
    expect([...long]).toHaveLength(280);
    expect(long.endsWith("…")).toBe(true);
    // A chip cut by the cap is not half a chip: it simply stays text.
    const w = preview("@Prakhar Mittal hi", [PRAKHAR], { max: 6 });
    expect(w.findAll("[data-testid=preview-mention]")).toHaveLength(0);
  });

  it("is not interactive: no buttons, links, roles or tab stops inside a row", () => {
    const { host } = inHost("@Prakhar Mittal @everyone https://example.com", [PRAKHAR], { everyone: true });
    expect(host.querySelectorAll("a, button, [tabindex], [role]").length).toBe(0);
    // Each token is readable text for screen readers.
    expect(host.textContent).toContain("@Prakhar Mittal");
    expect(host.textContent).toContain("@everyone");
    expect(host.textContent).toContain("example.com");
  });
});

describe("tags are the source of truth", () => {
  it("26. mentionTagsOf reads p tags and the semantic @everyone tag (memoised per event)", () => {
    const ev = { tags: [["p", PRAKHAR], ["p", DEV], ["h", "c1"], [...EVERYONE_MENTION_TAG]] };
    const t = tokens.mentionTagsOf(ev);
    expect(t).toEqual({ mentions: [PRAKHAR, DEV], everyone: true });
    expect(tokens.mentionTagsOf(ev)).toBe(t);
    expect(tokens.mentionTagsOf({ tags: [["p", PRAKHAR]] }).everyone).toBe(false);
  });

  it("25. text alone never makes a mention: untagged @name, @everyone without its tag, malformed tags", () => {
    expect(inHost("@Prakhar Mittal hi", []).text()).toBe("@Prakhar Mittal hi");
    expect(inHost("@everyone hi", [], { everyone: false }).text()).toBe("@everyone hi");
    expect(inHost("@Prakhar Mittal hi", ["not-a-pubkey"]).text()).toBe("@Prakhar Mittal hi");
    expect(tokens.mentionTagsOf({ tags: [["p"], ["mention"], ["mention", "everyone-ish"]] })).toEqual({ mentions: [], everyone: false });
  });

  it("22. a DM preview: participant p tags without an @name in the text stay plain", () => {
    const { host } = inHost("Binod Taterway is inviting you to join", [PRAKHAR, DEV]);
    expect(host.querySelectorAll("span").length).toBe(0);
  });

  it("20. an edited message re-tokenizes from its new content", async () => {
    const w = preview("@Devankit old text", [DEV]);
    expect(w.findAll("[data-testid=preview-mention]")).toHaveLength(1);
    await w.setProps({ content: "no mention any more" });
    expect(w.findAll("[data-testid=preview-mention]")).toHaveLength(0);
  });
});

describe("profiles: the one registry, batched", () => {
  it("18. known people render from the registry with no fetch", async () => {
    preview("@Prakhar Mittal @Devankit", [PRAKHAR, DEV]);
    await Promise.resolve();
    expect(fetchProfiles).not.toHaveBeenCalled();
  });

  it("19. fifty rows mentioning an unknown person → ONE lookup, not fifty", async () => {
    for (let i = 0; i < 50; i++) preview(`@someone row ${i}`, [UNKNOWN, DEV]);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchProfiles).toHaveBeenCalledTimes(1);
    expect(fetchProfiles).toHaveBeenCalledWith([UNKNOWN]);
  });

  it("an unknown person stays safe plain text until the registry has them, then becomes a chip", async () => {
    const w = preview("@Sonia Malik please check", [UNKNOWN]);
    expect(w.findAll("[data-testid=preview-mention]")).toHaveLength(0);
    absorbProfileEvents([profile(UNKNOWN, "Sonia Malik")]);
    await nextTick();
    expect(w.findAll("[data-testid=preview-mention]")).toHaveLength(1);
  });
});

describe("Inbox row (desktop)", () => {
  const event = (content: string, tags: string[][]): RawNostrEvent => ({ id: "e".repeat(64), pubkey: DEV, created_at: 1_700_000_000, kind: 9, tags, content, sig: "" });
  function inbox(ev: RawNostrEvent) {
    const item = { key: "k1", event: ev, type: "mention", channelId: "c1", rootId: null, createdAt: ev.created_at, count: 1, mentionsMe: true };
    const w = mount(InboxListPane, {
      attachTo: document.body,
      global: { plugins: [pinia] },
      props: {
        items: [item as never],
        filter: "all",
        unreadOnly: false,
        unreadCount: 1,
        selectedKey: null,
        isUnread: () => true,
        senderName: () => "binod",
        senderAvatar: () => undefined,
        context: () => "Mentioned in #SWF Project",
        isLoading: false,
        isError: false,
        partialError: false,
      },
    });
    mounted.push(w);
    return w;
  }

  it("draws the preview as semantic tokens (the screenshot case)", () => {
    const w = inbox(event("@Prakhar Mittal @Devankit https://x.com/buzzdotxyz/status/2105348", [["h", "c1"], ["p", PRAKHAR], ["p", DEV]]));
    const pv = w.find("[data-testid=inbox-row-preview]");
    expect(pv.findAll("[data-testid=preview-mention]").map((c) => c.text())).toEqual(["@Prakhar Mittal", "@Devankit"]);
    expect(pv.find("[data-testid=preview-link]").text()).toContain("x.com");
    expect(w.find(".context").text()).toBe("Mentioned in #SWF Project");
  });

  it("17. tapping a chip opens the message — the whole row is the one target", async () => {
    const w = inbox(event("@Prakhar Mittal @everyone look", [["p", PRAKHAR], [...EVERYONE_MENTION_TAG]]));
    await w.find("[data-testid=preview-mention]").trigger("click");
    await w.find("[data-testid=preview-everyone]").trigger("click");
    expect(w.emitted("select")).toHaveLength(2);
    expect(w.emitted("open-profile")).toBeUndefined();
  });

  it("no text → the existing '(no text)' fallback", () => {
    const w = inbox(event("<!-- only a marker -->", []));
    expect(w.find("[data-testid=inbox-row-preview]").text()).toBe("(no text)");
  });
});

describe("notifications", () => {
  it("24. the OS / plain body keeps readable text — no markup — and the in-app card tokenizes that same safe text", () => {
    const body = safePreview("@Prakhar Mittal @Devankit please review https://example.com/x nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq");
    expect(body).toContain("@Prakhar Mittal @Devankit please review");
    expect(body).not.toMatch(/[<>]/);
    expect(body).not.toContain("nsec1");
    const { text } = inHost(body, [PRAKHAR, DEV], { raw: true });
    expect(text().startsWith("[@Prakhar Mittal] [@Devankit] please review")).toBe(true);
  });
});

describe("wiring contract (one renderer on every preview surface)", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("21/23. Inbox (desktop + mobile), Search (mobile + palette), toasts and the action sheet use MessagePreview", () => {
    for (const f of [
      "src/features/inbox/ui/InboxListPane.vue",
      "src/features/mobile/views/MobileInboxView.vue",
      "src/features/mobile/views/MobileSearchView.vue",
      "src/features/search/ui/CommandPalette.vue",
      "src/features/notifications/ui/InAppToastStack.vue",
      "src/features/mobile/ui/MobileMessageActions.vue",
    ]) {
      expect(src(f), f).toContain("<MessagePreview");
    }
    // Full messages (channel, DM, thread, Inbox detail) and previews share ONE tokenizer.
    expect(src("src/features/mentions/MessageContent.ts")).toContain("useMessageTokens");
    expect(src("src/features/mentions/MessagePreview.ts")).toContain("useMessageTokens");
  });

  it("G20. no v-html / innerHTML in the renderers; G15. no hard-coded colours in the preview styles", () => {
    for (const f of ["src/features/mentions/MessagePreview.ts", "src/features/mentions/messageTokens.ts", "src/features/mentions/MessageContent.ts"]) {
      expect(src(f)).not.toMatch(/v-html=|innerHTML\s*=|insertAdjacentHTML/);
    }
    const css = src("src/features/mentions/messagePreview.css");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(css).toContain("var(--color-mention-text)");
    expect(css).toMatch(/white-space: nowrap/);
    expect(css).toMatch(/text-overflow: ellipsis/);
  });
});
