/**
 * Rendered mentions: one component for people and agents, bound only through
 * the event's `p` tags, opening the one profile system
 * (docs/OLD_BUZZ_MENTION_AUDIT.md §3–4).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import MessageContent from "@/features/mentions/MessageContent";
import { absorbProfileEvents, clearProfileStore, markAgents } from "@/features/profile/profileStore";
import { useUiStore } from "@/stores/ui";
import { usePresenceStore } from "@/stores/presence";
import type { RawNostrEvent } from "@/protocol/types";

const DEV = "d".repeat(64);
const DEV2 = "e".repeat(64);
const AGENT = "a".repeat(64);

function profile(pubkey: string, content: Record<string, string>): RawNostrEvent {
  return { id: pubkey.slice(0, 8).padEnd(64, "0"), pubkey, created_at: 1, kind: 0, tags: [], content: JSON.stringify(content), sig: "" };
}

let pinia: Pinia;
function render(content: string, mentions: string[]) {
  return mount(MessageContent, {
    props: { content, mentions },
    attachTo: document.body,
    global: { plugins: [pinia, [VueQueryPlugin, { queryClient: new QueryClient() }]] },
  });
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  clearProfileStore();
  absorbProfileEvents([
    profile(DEV, { display_name: "Devankit" }),
    profile(DEV2, { display_name: "Devankit" }),
    profile(AGENT, { display_name: "Scout", name: "scout-bot" }),
  ]);
  markAgents([AGENT]);
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

const chips = (w: ReturnType<typeof render>) => w.findAll("[data-testid=mention-chip]");

describe("rendered mentions", () => {
  it("draws a tagged person and a tagged agent with the same component", () => {
    const w = render("@Devankit please ask @Scout about it", [DEV, AGENT]);
    const [person, agent] = chips(w);
    expect(person.text()).toBe("@Devankit");
    expect(person.attributes("data-mention-kind")).toBe("human");
    expect(person.attributes("data-mention-pubkey")).toBe(DEV);
    expect(agent.text()).toBe("@Scout");
    expect(agent.attributes("data-mention-kind")).toBe("agent");
    expect(agent.classes()).toContain("mention-chip");
    expect(person.classes()).toContain("mention-chip");
    // The text around the mentions is untouched.
    expect(w.element.parentElement?.textContent).toBe("@Devankit please ask @Scout about it");
  });

  it("people and agents share the chip base; only the agent carries the glyph and says so to screen readers", () => {
    absorbProfileEvents([{ ...profile(AGENT, { display_name: "Scout (Support Agent)" }), created_at: 2 }]);
    const w = render("@Devankit and @Scout (Support Agent), please check", [DEV, AGENT]);
    const [person, agent] = chips(w);
    expect(person.classes()).toEqual(["mention-chip"]);
    expect(agent.classes()).toEqual(["mention-chip", "agent"]);
    expect(person.find("[data-testid=mention-agent-glyph]").exists()).toBe(false);
    expect(agent.find("[data-testid=mention-agent-glyph]").exists()).toBe(true);
    // The role parenthetical is carried by the glyph; the full name stays in title / aria.
    expect(agent.text()).toBe("@Scout");
    expect(agent.attributes("title")).toBe("Scout (Support Agent)");
    expect(agent.attributes("aria-label")).toBe("Scout (Support Agent), agent, open profile");
    expect(person.attributes("aria-label")).toBe("Devankit, member, open profile");
    expect(person.attributes("tabindex")).toBe("0");
    expect(person.attributes("role")).toBe("button");
  });

  it("Space opens the profile too", async () => {
    const w = render("hi @Devankit", [DEV]);
    await chips(w)[0].trigger("keydown", { key: " " });
    expect(useUiStore().contextPanel).toEqual({ kind: "profile", pubkey: DEV });
  });

  it("several mentions in one message each bind to their own identity", () => {
    const w = render("@Devankit @Scout please review.", [DEV, AGENT]);
    expect(chips(w).map((c) => c.attributes("data-mention-pubkey"))).toEqual([DEV, AGENT]);
  });

  it("an untagged @name stays plain text (text is never an authority)", () => {
    const w = render("@Devankit hello", []);
    expect(chips(w)).toHaveLength(0);
  });

  it("does not depend on whether the mentioned person replied — only on the event", () => {
    // Same event rendered twice (e.g. live, then after reload/history): same result.
    expect(chips(render("@Scout go", [AGENT]))).toHaveLength(1);
    expect(chips(render("@Scout go", [AGENT]))).toHaveLength(1);
  });

  it("a display-name collision never resolves to the wrong person", () => {
    const w = render("@Devankit hi", [DEV, DEV2]);
    expect(chips(w)).toHaveLength(0);
    const qualified = render(`@Devankit (${DEV2}) hi`, [DEV, DEV2]);
    expect(chips(qualified)[0].attributes("data-mention-pubkey")).toBe(DEV2);
    expect(chips(qualified)[0].text()).toBe("@Devankit (eeee…eeee)");
  });

  it("emails and URLs are never mentions", () => {
    const w = render("mail x@Devankit or https://a.b/@Devankit", [DEV]);
    expect(chips(w)).toHaveLength(0);
  });

  it("click and keyboard open the same profile drawer as an author avatar", async () => {
    const w = render("hi @Scout", [AGENT]);
    await chips(w)[0].trigger("click");
    expect(useUiStore().contextPanel).toEqual({ kind: "profile", pubkey: AGENT });

    useUiStore().closeContextPanel();
    await chips(w)[0].trigger("keydown", { key: "Enter" });
    expect(useUiStore().contextPanel).toEqual({ kind: "profile", pubkey: AGENT });
  });

  it("hover shows the identity card with presence from the one store", async () => {
    vi.useFakeTimers();
    usePresenceStore().apply(DEV, { status: "online", updatedAt: 1, source: "snapshot" });
    const w = render("ask @Devankit", [DEV]);
    await chips(w)[0].trigger("mouseenter");
    await vi.advanceTimersByTimeAsync(400);
    const card = document.querySelector("[data-testid=mention-hover-card]");
    expect(card?.textContent).toContain("Devankit");
    expect(card?.textContent).toContain("Online");
    (document.querySelector("[data-testid=mention-card-profile]") as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(useUiStore().contextPanel).toEqual({ kind: "profile", pubkey: DEV });
    expect(document.querySelector("[data-testid=mention-hover-card]")).toBeNull();
    w.unmount();
  });

  it("every message surface renders content through the one mention renderer, every composer offers mentions", () => {
    const src = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");
    // Channel feed, DMs, thread root/replies and the Inbox all render MessageItem.
    expect(src("components/MessageItem.vue")).toMatch(/<MessageContent :content="displayContent" :mentions="message.mentions"/);
    for (const file of [
      "views/ChannelsView.vue",
      "views/DmView.vue",
      "components/ThreadPanel.vue",
      "features/inbox/ui/InboxDetailPane.vue",
    ]) {
      expect(src(file), file).toMatch(/:mention-scope="/);
    }
  });

  it("the chip is styled only through Appearance tokens, defined for light AND dark, all accent-derived", () => {
    const chip = readFileSync(join(process.cwd(), "src/features/mentions/MentionChip.vue"), "utf8");
    const style = chip.slice(chip.indexOf("<style"));
    // No literal colours in the chip — every colour comes from a theme token.
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    for (const token of ["--color-mention-bg", "--color-mention-text", "--color-mention-border", "--color-mention-bg-hover", "--color-mention-border-hover"]) {
      expect(style).toContain(`var(${token})`);
    }
    // Inline, so wrapping follows the sentence and the line box never grows.
    expect(style).toMatch(/\.mention-chip \{[^}]*display: inline;/);
    expect(style).toMatch(/box-decoration-break: clone/);

    const tokens = readFileSync(join(process.cwd(), "src/app/theme/tokens.css"), "utf8");
    const appearance = readFileSync(join(process.cwd(), "src/app/theme/appearance.css"), "utf8");
    const dark = appearance.match(/html\[data-color-scheme="dark"\] \{([^}]*)\}/)?.[1] ?? "";
    for (const token of ["--color-mention-bg", "--color-mention-bg-hover", "--color-mention-border", "--color-mention-border-hover"]) {
      expect(tokens).toMatch(new RegExp(`${token}: color-mix\\(in srgb, var\\(--color-primary\\)`));
      expect(dark).toMatch(new RegExp(`${token}: color-mix\\(in srgb, var\\(--color-primary\\)`));
    }
    expect(tokens).toMatch(/--color-mention-text: color-mix\(in srgb, var\(--color-primary\) \d+%, var\(--color-text\)\)/);
  });

  it("an agent's card says Agent", async () => {
    vi.useFakeTimers();
    const w = render("ask @Scout", [AGENT]);
    await chips(w)[0].trigger("mouseenter");
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector("[data-testid=mention-hover-card]")?.textContent).toContain("Agent");
    w.unmount();
  });
});
