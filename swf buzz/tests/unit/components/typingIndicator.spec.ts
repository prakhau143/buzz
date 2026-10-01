/**
 * Typing indicator: real names (up to 5, then "+N others"), avatar stack, a
 * strip that is zero-height when idle, deterministic order, meaningful-only
 * screen-reader announcements.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import { compactTypingLabel, typingAnnouncement, typingLabel } from "@/features/presence/typingLabel";

const NAMES = ["Prakhar", "Rahul", "Amit", "Neha", "Vikram", "Sonia", "Tanishq", "Hardik", "Himanshu", "Devankit"];
const pk = (i: number) => i.toString(16).padStart(64, "0");
const knownNames = ref(new Map<string, string>());
vi.mock("@/composables/useProfile", () => ({
  useProfileMap: (pubkeys: () => string[]) => ({
    profiles: ref(new Map()),
    displayNames: computed(() => new Map(pubkeys().map((p) => [p, knownNames.value.get(p) ?? `${p.slice(0, 8)}…`]))),
  }),
}));
const TypingIndicator = (await import("@/components/TypingIndicator.vue")).default;

beforeEach(() => {
  setActivePinia(createPinia());
  knownNames.value = new Map(NAMES.map((n, i) => [pk(i), n]));
});

describe("typing wording", () => {
  it.each([
    [1, "Prakhar is typing"],
    [2, "Prakhar and Rahul are typing"],
    [3, "Prakhar, Rahul and Amit are typing"],
    [4, "Prakhar, Rahul, Amit and Neha are typing"],
    [5, "Prakhar, Rahul, Amit, Neha and Vikram are typing"],
    [6, "Prakhar, Rahul, Amit, Neha, Vikram +1 other are typing"],
    [10, "Prakhar, Rahul, Amit, Neha, Vikram +5 others are typing"],
  ])("%i typing → %s", (n, expected) => {
    expect(typingLabel(NAMES.slice(0, n))).toBe(expected);
  });

  it("compact form keeps two names", () => {
    expect(compactTypingLabel(NAMES.slice(0, 2))).toBe("Prakhar and Rahul are typing");
    expect(compactTypingLabel(NAMES.slice(0, 5))).toBe("Prakhar, Rahul +3 others are typing");
    expect(compactTypingLabel(NAMES.slice(0, 3))).toBe("Prakhar, Rahul +1 other are typing");
  });

  it("screen readers hear names for 1–2 people, a count beyond — never the animation", () => {
    expect(typingAnnouncement([])).toBe("");
    expect(typingAnnouncement(["Prakhar"])).toBe("Prakhar is typing");
    expect(typingAnnouncement(["Prakhar", "Rahul"])).toBe("Prakhar and Rahul are typing");
    expect(typingAnnouncement(NAMES.slice(0, 7))).toBe("7 people are typing");
  });
});

describe("TypingIndicator", () => {
  const mountWith = (n: number) =>
    mount(TypingIndicator, {
      props: { pubkeys: Array.from({ length: n }, (_, i) => pk(i)) },
      global: { stubs: { AvatarCircle: { props: ["name"], template: "<span class='avatar-stub'>{{ name }}</span>" } } },
    });

  it("nobody typing: the strip is collapsed (0fr, no indicator, silent)", () => {
    const w = mountWith(0);
    const strip = w.find("[data-testid=typing-strip]");
    expect(strip.classes()).not.toContain("open");
    expect(strip.attributes("data-visible")).toBe("false");
    expect(w.find("[data-testid=typing-indicator]").exists()).toBe(false);
    expect(w.find("[data-testid=typing-announcement]").text()).toBe("");
  });

  it("first typist opens it; the last one leaving collapses it again", async () => {
    const w = mountWith(0);
    await w.setProps({ pubkeys: [pk(0)] });
    expect(w.find("[data-testid=typing-strip]").classes()).toContain("open");
    expect(w.find("[data-testid=typing-indicator]").exists()).toBe(true);
    await w.setProps({ pubkeys: [] });
    expect(w.find("[data-testid=typing-strip]").classes()).not.toContain("open");
  });

  it("names every typist (not '2 people are typing')", () => {
    const w = mountWith(2);
    expect(w.find("[data-testid=typing-label]").text()).toBe("Prakhar and Rahul are typing");
    expect(w.findAll("[data-testid=typing-avatar]")).toHaveLength(2);
  });

  it("caps avatars at 5; +N's tooltip lists the rest", () => {
    const w = mountWith(8);
    expect(w.findAll("[data-testid=typing-avatar]")).toHaveLength(5);
    const more = w.find("[data-testid=typing-more]");
    expect(more.text()).toBe("+3");
    expect(more.attributes("title")).toBe("Sonia, Tanishq, Hardik");
    expect(more.attributes("tabindex")).toBe("0");
  });

  it("keeps the order people started typing in (no reshuffle when events repeat)", async () => {
    const w = mountWith(3);
    const order = () => w.findAll("[data-testid=typing-avatar]").map((a) => a.attributes("aria-label"));
    const before = order();
    await w.setProps({ pubkeys: [pk(0), pk(1), pk(2)] }); // Amit typed again — same list from the store
    expect(order()).toEqual(before);
    expect(before).toEqual(["Prakhar", "Rahul", "Amit"]);
  });

  it("someone whose typing expired disappears; the last one leaving empties the strip", async () => {
    const w = mountWith(2);
    await w.setProps({ pubkeys: [pk(1)] });
    expect(w.find("[data-testid=typing-label]").text()).toBe("Rahul is typing");
    await w.setProps({ pubkeys: [] });
    expect(w.find("[data-testid=typing-announcement]").text()).toBe("");
  });

  it("an unknown name falls back to the shortened key, never raw key material beyond it", () => {
    knownNames.value = new Map();
    const w = mountWith(1);
    expect(w.find("[data-testid=typing-label]").text()).toBe(`${pk(0).slice(0, 8)}… is typing`);
  });

  it("avatars expose name (and presence when known) to keyboard and hover", () => {
    const w = mountWith(1);
    const avatar = w.find("[data-testid=typing-avatar]");
    expect(avatar.attributes("tabindex")).toBe("0");
    expect(avatar.attributes("title")).toBe("Prakhar");
  });
});

describe("layout guard: zero space when idle (docs/TYPING_INDICATOR_LAYOUT_FIX.md)", () => {
  const css = readFileSync(join(process.cwd(), "src/components/TypingIndicator.vue"), "utf8");
  const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";
  it("the collapsed strip has no min-height, height, padding or margin and a 0fr row", () => {
    const strip = rule(".typing-strip");
    expect(strip).toMatch(/grid-template-rows: 0fr/);
    expect(strip).not.toMatch(/min-height|(^|\s)height|padding|margin/);
    expect(rule(".typing-clip")).toMatch(/min-height: 0/);
    expect(rule(".typing-clip")).toMatch(/overflow: hidden/);
  });
  it("no negative-margin / translate hacks, and reduced motion is instant", () => {
    expect(css).not.toMatch(/margin(-top|-bottom)?:\s*-(?!1px;)/); // sr-only's -1px is the standard clip pattern
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.typing-strip \{\s*transition: none/);
  });
  it("the live region takes no space (absolutely positioned)", () => {
    expect(rule(".sr-only")).toMatch(/position: absolute/);
  });
  it("MessageList keeps a bottom reader anchored when its viewport shrinks", () => {
    const list = readFileSync(join(process.cwd(), "src/components/MessageList.vue"), "utf8");
    expect(list).toMatch(/resizeObserver\.observe\(scrollEl\.value\)/);
  });
});
