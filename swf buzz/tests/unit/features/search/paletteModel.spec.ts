/** "Search anything" palette model: sections, ranking, thresholds, and the product boundary. */
import { describe, expect, it } from "vitest";
import { buildPalette, flatten, matchScore, MIN_QUERY, snippet, type PaletteInput } from "@/features/search/paletteModel";

const base: PaletteInput = {
  query: "",
  channels: [
    { id: "c1", name: "general" },
    { id: "c2", name: "engineering" },
    { id: "c3", name: "announcements" },
  ],
  dms: [{ id: "d1", name: "Niti" }],
  people: [
    { pubkey: "p1", name: "Rahul Sharma" },
    { pubkey: "p2", name: "Niti Verma" },
  ],
  messages: [],
  canCreateChannel: true,
};
const labels = (input: Partial<PaletteInput>) =>
  flatten(buildPalette({ ...base, ...input })).map((i) => i.label);

describe("palette model", () => {
  it("empty query: quick access to channels and DMs, plus Create channel only when permitted", () => {
    const sections = buildPalette(base);
    expect(sections.map((s) => s.title)).toEqual(["Channels", "Direct messages", "Actions"]);
    expect(buildPalette({ ...base, canCreateChannel: false }).map((s) => s.title)).toEqual(["Channels", "Direct messages"]);
  });

  it("never offers 'Create a new agent' (SWF creates no agents) — in any state", () => {
    for (const query of ["", "ag", "agent", "create", "new"]) {
      expect(labels({ query }).some((l) => /agent/i.test(l)), query).toBe(false);
    }
  });

  it(`needs at least ${MIN_QUERY} characters before it searches`, () => {
    expect(buildPalette({ ...base, query: "e" }).map((s) => s.title)).toEqual(["Channels", "Direct messages", "Actions"]);
    expect(buildPalette({ ...base, query: "en" }).map((s) => s.title)).toContain("Channels");
  });

  it("groups results by section: channels, DMs, people, messages", () => {
    const sections = buildPalette({
      ...base,
      query: "niti",
      messages: [{ id: "m1", content: "ask niti about the deploy", channelId: "c2", channelName: "engineering" }],
    });
    expect(sections.map((s) => s.title)).toEqual(["Direct messages", "People", "Messages"]);
    expect(sections.at(-1)?.items[0]).toMatchObject({ kind: "message", channelId: "c2", sub: "#engineering" });
  });

  it("ranks a word-start match above a mid-word match", () => {
    expect(matchScore("engineering", "eng")).toBeGreaterThan(matchScore("general engine", "ine"));
    expect(labels({ query: "an" })[0]).toBe("announcements");
  });

  it("matching is case- and accent-insensitive", () => {
    expect(matchScore("Réunion", "reu")).toBeGreaterThan(0);
  });

  it("a message snippet keeps the hit in view", () => {
    const long = `${"x ".repeat(100)}deployment completed ${"y ".repeat(100)}`;
    expect(snippet(long, "deployment")).toContain("deployment");
  });
});
