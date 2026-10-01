/**
 * Composer @mentions — picker, keyboard, tokens and what is sent
 * (docs/OLD_BUZZ_MENTION_AUDIT.md §1–2). People and agents share every path.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import MessageComposer from "@/components/MessageComposer.vue";
import { usePresenceStore } from "@/stores/presence";
import type { MentionCandidate } from "@/features/mentions/mentionModel";

const DEV = "d".repeat(64);
const DEV2 = "e".repeat(64);
const AGENT = "a".repeat(64);
const SONIA = "5".repeat(64);

const CANDIDATES: MentionCandidate[] = [
  { pubkey: DEV, displayName: "Devankit", inChannel: true },
  { pubkey: AGENT, displayName: "Scout", isAgent: true, inChannel: true },
  { pubkey: SONIA, displayName: "Sonia Malik", inChannel: true },
];

function mountComposer(candidates = CANDIDATES) {
  return mount(MessageComposer, {
    props: { mentionCandidates: candidates },
    attachTo: document.body,
  });
}

async function type(wrapper: VueWrapper, value: string) {
  const textarea = wrapper.find("textarea");
  await textarea.setValue(value);
  (textarea.element as HTMLTextAreaElement).setSelectionRange(value.length, value.length);
  await textarea.trigger("keyup");
}

const key = (wrapper: VueWrapper, name: string, extra: KeyboardEventInit = {}) =>
  wrapper.find("textarea").trigger("keydown", { key: name, ...extra });

const options = (wrapper: VueWrapper) => wrapper.findAll("[data-testid=mention-option]");
const activeName = (wrapper: VueWrapper) =>
  wrapper.find("[data-testid=mention-option][aria-selected=true] .option-name").text();
const value = (wrapper: VueWrapper) => (wrapper.find("textarea").element as HTMLTextAreaElement).value;

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
});

describe("mention picker", () => {
  it("opens on @ with everyone relevant, people and agents together", async () => {
    const w = mountComposer();
    await type(w, "@");
    expect(w.find("[data-testid=mention-picker]").exists()).toBe(true);
    expect(options(w).map((o) => o.attributes("data-pubkey"))).toEqual([DEV, AGENT, SONIA]);
    expect(options(w)[1].text()).toContain("Agent");
    expect(options(w)[0].text()).toContain("Member");
  });

  it("filters as you type", async () => {
    const w = mountComposer();
    await type(w, "hi @so");
    expect(options(w).map((o) => o.attributes("data-pubkey"))).toEqual([SONIA]);
  });

  it("does not open inside an email address", async () => {
    const w = mountComposer();
    await type(w, "mail devankit@exa");
    expect(w.find("[data-testid=mention-picker]").exists()).toBe(false);
  });

  it("arrow keys move the highlight and wrap", async () => {
    const w = mountComposer();
    await type(w, "@");
    expect(activeName(w)).toBe("Devankit");
    await key(w, "ArrowDown");
    expect(activeName(w)).toBe("Scout");
    await key(w, "ArrowUp");
    await key(w, "ArrowUp");
    expect(activeName(w)).toBe("Sonia Malik");
  });

  it("Enter selects the highlighted identity instead of sending", async () => {
    const w = mountComposer();
    await type(w, "ping @dev");
    await key(w, "Enter");
    expect(value(w)).toBe("ping @Devankit ");
    expect(w.emitted("send")).toBeUndefined();
    expect(w.find("[data-testid=mention-picker]").exists()).toBe(false);
  });

  it("Tab selects too; Escape closes without inserting", async () => {
    const w = mountComposer();
    await type(w, "@sc");
    await key(w, "Tab");
    expect(value(w)).toBe("@Scout ");

    await type(w, "@Scout @so");
    await key(w, "Escape");
    expect(w.find("[data-testid=mention-picker]").exists()).toBe(false);
    expect(value(w)).toBe("@Scout @so");
  });

  it("mouse selection works", async () => {
    const w = mountComposer();
    await type(w, "@");
    await options(w)[2].trigger("mousedown");
    expect(value(w)).toBe("@Sonia Malik ");
  });

  it("the textarea exposes the picker as an ARIA combobox", async () => {
    const w = mountComposer();
    const textarea = w.find("textarea");
    await type(w, "@");
    expect(textarea.attributes("aria-expanded")).toBe("true");
    expect(textarea.attributes("aria-activedescendant")).toBe(options(w)[0].attributes("id"));
  });

  it("shows presence from the one presence store", async () => {
    usePresenceStore().apply(DEV, { status: "online", updatedAt: 1, source: "snapshot" });
    const w = mountComposer();
    await type(w, "@dev");
    expect(options(w)[0].find("[data-presence=online]").exists()).toBe(true);
  });
});

describe("what is sent", () => {
  it("sends picked people and agents as pubkeys, never by display name", async () => {
    const w = mountComposer();
    await type(w, "@dev");
    await key(w, "Enter");
    await type(w, `${value(w)}and @sc`);
    await key(w, "Enter");
    await type(w, `${value(w)}please check`);
    await key(w, "Enter");
    await new Promise((r) => setTimeout(r));
    expect(w.emitted("send")?.[0]).toEqual([
      "@Devankit and @Scout please check",
      [DEV, AGENT],
      [],
      { mentionsEveryone: false },
    ]);
  });

  it("a mention edited away is not sent", async () => {
    const w = mountComposer();
    await type(w, "@dev");
    await key(w, "Enter");
    await type(w, "@Devan hello");
    await key(w, "Enter");
    await new Promise((r) => setTimeout(r));
    expect(w.emitted("send")?.[0][1]).toEqual([]);
  });

  it("two members with one name: the second pick is qualified by key, each resolves to its own identity", async () => {
    const twins: MentionCandidate[] = [
      { pubkey: DEV, displayName: "Devankit", inChannel: true },
      { pubkey: DEV2, displayName: "Devankit", inChannel: true },
    ];
    const w = mountComposer(twins);
    await type(w, "@dev");
    await key(w, "Enter");
    await type(w, `${value(w)}@dev`);
    await key(w, "ArrowDown");
    await key(w, "Enter");
    expect(value(w)).toBe(`@Devankit @Devankit (${DEV2}) `);
    await key(w, "Enter");
    await new Promise((r) => setTimeout(r));
    expect(w.emitted("send")?.[0][1]).toEqual([DEV, DEV2]);
  });

  it("refuses a typed name two members share instead of guessing", async () => {
    const twins: MentionCandidate[] = [
      { pubkey: DEV, displayName: "Devankit", inChannel: true },
      { pubkey: DEV2, displayName: "Devankit", inChannel: true },
    ];
    const w = mountComposer(twins);
    await type(w, "hey @Devankit ok");
    await key(w, "Enter");
    await new Promise((r) => setTimeout(r));
    expect(w.emitted("send")).toBeUndefined();
    expect(w.find("[data-testid=composer-mention-error]").text()).toContain("@Devankit is ambiguous");
  });

  it("an email address in the text sends no mention", async () => {
    const w = mountComposer();
    await type(w, "write to devankit@company.com");
    await key(w, "Enter");
    await new Promise((r) => setTimeout(r));
    expect(w.emitted("send")?.[0][1]).toEqual([]);
  });

  it("draws picked mentions as tokens behind the text", async () => {
    const w = mountComposer();
    await type(w, "@sc");
    await key(w, "Enter");
    expect(w.find(".composer-backdrop .draft-mention").text()).toBe("@Scout");
  });
});
