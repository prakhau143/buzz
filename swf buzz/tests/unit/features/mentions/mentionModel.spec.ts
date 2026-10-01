/**
 * The @mention model — every rule mirrors OLD BUZZ (docs/OLD_BUZZ_MENTION_AUDIT.md).
 */
import { describe, expect, it } from "vitest";
import {
  agentMentionDisplayLabel,
  detectMentionQuery,
  extractMentionPubkeys,
  findMentionOccurrences,
  formatMentionDisplayLabel,
  mentionLabelFor,
  normalizeMentionPubkeys,
  profileAliases,
  rankMentionCandidates,
  resolveMentionBindings,
  segmentMentions,
  type MentionCandidate,
} from "@/features/mentions/mentionModel";

const DEV = "d".repeat(64);
const DEV2 = "e".repeat(64);
const AGENT = "a".repeat(64);
const SONIA = "5".repeat(64);

const devankit: MentionCandidate = { pubkey: DEV, displayName: "Devankit", inChannel: true };
const agent: MentionCandidate = { pubkey: AGENT, displayName: "Scout", isAgent: true, inChannel: true };
const sonia: MentionCandidate = { pubkey: SONIA, displayName: "Sonia Malik", inChannel: true };

describe("detectMentionQuery", () => {
  it("opens on @ at the start or after whitespace / an opening bracket", () => {
    expect(detectMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(detectMentionQuery("hi @dev", 7)).toEqual({ start: 3, query: "dev" });
    expect(detectMentionQuery("(@dev", 5)).toEqual({ start: 1, query: "dev" });
  });

  it("never opens inside an email address", () => {
    expect(detectMentionQuery("hello@example", 13)).toBeNull();
    expect(detectMentionQuery("mail email@company.com", 22)).toBeNull();
  });

  it("follows the caret, not the end of the draft", () => {
    const text = "ping @dev please";
    expect(detectMentionQuery(text, 9)).toEqual({ start: 5, query: "dev" });
    expect(detectMentionQuery(text, text.length)).toBeNull();
  });

  it("keeps a multi-word query open only while it prefixes a known name", () => {
    const names = ["Sonia Malik"];
    expect(detectMentionQuery("@Sonia Ma", 9, names)).toEqual({ start: 0, query: "Sonia Ma" });
    expect(detectMentionQuery("@Sonia went home", 16, names)).toBeNull();
    // A completed name followed by a space closes it.
    expect(detectMentionQuery("@Sonia Malik ", 13, names)).toBeNull();
  });

  it("never crosses a newline", () => {
    expect(detectMentionQuery("@Sonia\nMa", 9, ["Sonia Malik"])).toBeNull();
  });
});

describe("rankMentionCandidates", () => {
  const outsider: MentionCandidate = { pubkey: "0".repeat(64), displayName: "Devansh", inChannel: false };
  const outsideAgent: MentionCandidate = { pubkey: "1".repeat(64), displayName: "Dev Bot", isAgent: true, inChannel: false };

  it("puts conversation members first, then people, then other agents", () => {
    const ranked = rankMentionCandidates([outsideAgent, outsider, devankit], "dev");
    expect(ranked.map((c) => c.displayName)).toEqual(["Devankit", "Devansh", "Dev Bot"]);
  });

  it("prefers exact, then prefix, then word matches", () => {
    const ranked = rankMentionCandidates(
      [
        { pubkey: "1".repeat(64), displayName: "Big Sam" },
        { pubkey: "2".repeat(64), displayName: "Samantha" },
        { pubkey: "3".repeat(64), displayName: "Sam" },
      ],
      "sam",
    );
    expect(ranked.map((c) => c.displayName)).toEqual(["Sam", "Samantha", "Big Sam"]);
  });

  it("offers everyone for a bare @ and nobody for a non-match", () => {
    expect(rankMentionCandidates([devankit, agent, sonia], "")).toHaveLength(3);
    expect(rankMentionCandidates([devankit, agent], "zzz")).toEqual([]);
  });

  it("offers people and agents from the same list", () => {
    const ranked = rankMentionCandidates([devankit, agent], "");
    expect(ranked.map((c) => c.pubkey)).toEqual([DEV, AGENT]);
  });
});

describe("mentionLabelFor", () => {
  it("uses the display name, qualified by key only when the draft already binds it to someone else", () => {
    const bindings = new Map<string, string>();
    expect(mentionLabelFor(devankit, bindings)).toBe("Devankit");
    bindings.set("Devankit", DEV);
    expect(mentionLabelFor(devankit, bindings)).toBe("Devankit");
    expect(mentionLabelFor({ pubkey: DEV2, displayName: "Devankit" }, bindings)).toBe(`Devankit (${DEV2})`);
  });

  it("an agent's trailing role parenthetical is shown by the glyph, not the chip text", () => {
    expect(agentMentionDisplayLabel("Scout (Support Agent)")).toBe("Scout");
    expect(agentMentionDisplayLabel("Scout (agent)")).toBe("Scout");
    // Anything that is not a role label is left alone.
    expect(agentMentionDisplayLabel("Scout (EU)")).toBe("Scout (EU)");
    expect(agentMentionDisplayLabel("Scout (abcd…wxyz)")).toBe("Scout (abcd…wxyz)");
    expect(agentMentionDisplayLabel("(Agent)")).toBe("(Agent)");
  });

  it("shortens a qualified key for display", () => {
    expect(formatMentionDisplayLabel(`Devankit (${DEV2})`)).toBe("Devankit (eeee…eeee)");
    expect(formatMentionDisplayLabel("Devankit")).toBe("Devankit");
  });
});

describe("findMentionOccurrences", () => {
  it("matches the longest label and respects word boundaries", () => {
    const found = findMentionOccurrences("hi @Sonia Malik, and @Sonia.", ["Sonia", "Sonia Malik"]);
    expect(found.map((f) => f.label)).toEqual(["Sonia Malik", "Sonia"]);
  });

  it("ignores emails, URLs and code", () => {
    const labels = ["example", "Devankit"];
    expect(findMentionOccurrences("mail hello@example.com", labels)).toEqual([]);
    expect(findMentionOccurrences("see https://x.com/@Devankit now", labels)).toEqual([]);
    expect(findMentionOccurrences("run `@Devankit` here", labels)).toEqual([]);
    expect(findMentionOccurrences("```\n@Devankit\n```", labels)).toEqual([]);
  });

  it("requires the label to end at whitespace or punctuation", () => {
    expect(findMentionOccurrences("@Devankitx", ["Devankit"])).toEqual([]);
    expect(findMentionOccurrences("@Devankit\nnext", ["Devankit"])).toHaveLength(1);
  });
});

describe("extractMentionPubkeys", () => {
  it("returns the pubkeys of picked labels still in the text", () => {
    const picked = new Map([["Devankit", DEV], ["Scout", AGENT]]);
    expect(extractMentionPubkeys("@Devankit and @Scout, check", picked).pubkeys).toEqual([DEV, AGENT]);
    // A label edited away drops its mention.
    expect(extractMentionPubkeys("@Devan and @Scout", picked).pubkeys).toEqual([AGENT]);
  });

  it("binds a typed name that is exactly one member's", () => {
    expect(extractMentionPubkeys("hey @sonia malik", new Map(), [sonia]).pubkeys).toEqual([SONIA]);
  });

  it("never binds a typed name to someone outside the conversation", () => {
    const outsider = { ...sonia, inChannel: false };
    expect(extractMentionPubkeys("hey @Sonia Malik", new Map(), [outsider]).pubkeys).toEqual([]);
  });

  it("refuses a typed name shared by two members instead of guessing", () => {
    const twin = { pubkey: DEV2, displayName: "Devankit", inChannel: true };
    const result = extractMentionPubkeys("@Devankit hi", new Map(), [devankit, twin]);
    expect(result.pubkeys).toEqual([]);
    expect(result.ambiguous).toEqual(["Devankit"]);
  });

  it("a picked label resolves a name collision", () => {
    const twin = { pubkey: DEV2, displayName: "Devankit", inChannel: true };
    const picked = new Map([["Devankit", DEV], [`Devankit (${DEV2})`, DEV2]]);
    const result = extractMentionPubkeys(`@Devankit and @Devankit (${DEV2}) hi`, picked, [devankit, twin]);
    expect(result).toEqual({ pubkeys: [DEV, DEV2], ambiguous: [] });
  });

  it("does not turn an email into a mention", () => {
    expect(extractMentionPubkeys("mail devankit@company.com", new Map(), [devankit]).pubkeys).toEqual([]);
  });
});

describe("normalizeMentionPubkeys", () => {
  it("lowercases, dedupes and excludes", () => {
    expect(normalizeMentionPubkeys([DEV.toUpperCase(), DEV, AGENT], [AGENT])).toEqual([DEV]);
  });
});

describe("resolveMentionBindings + segmentMentions (render side)", () => {
  const aliases: Record<string, string[]> = {
    [DEV]: ["Devankit"],
    [DEV2]: ["Devankit"],
    [AGENT]: ["Scout", "scout-bot"],
  };
  const aliasesOf = (pubkey: string) => aliases[pubkey] ?? [];

  it("draws only identities tagged on the event", () => {
    const content = "@Devankit please ask @Scout";
    const segments = segmentMentions(content, resolveMentionBindings([AGENT], aliasesOf, content));
    expect(segments).toEqual([
      { kind: "text", text: "@Devankit please ask " },
      { kind: "mention", text: "@Scout", label: "Scout", pubkey: AGENT },
    ]);
  });

  it("matches any alias of a tagged identity", () => {
    const content = "cc @scout-bot";
    const segments = segmentMentions(content, resolveMentionBindings([AGENT], aliasesOf, content));
    expect(segments[1]).toMatchObject({ kind: "mention", pubkey: AGENT });
  });

  it("leaves a name two tagged identities share as plain text", () => {
    const content = "@Devankit hi";
    const segments = segmentMentions(content, resolveMentionBindings([DEV, DEV2], aliasesOf, content));
    expect(segments).toEqual([{ kind: "text", text: content }]);
  });

  it("binds a qualified label to exactly the tagged key", () => {
    const content = `@Devankit (${DEV2}) hi`;
    const segments = segmentMentions(content, resolveMentionBindings([DEV, DEV2], aliasesOf, content));
    expect(segments[0]).toMatchObject({ kind: "mention", pubkey: DEV2 });
  });

  it("never binds inside an email or URL even when the name is tagged", () => {
    const content = "write to x@Devankit or https://a.b/@Devankit";
    const segments = segmentMentions(content, resolveMentionBindings([DEV], aliasesOf, content));
    expect(segments).toEqual([{ kind: "text", text: content }]);
  });

  it("handles punctuation and line breaks around a mention", () => {
    const content = "(@Devankit),\n@Scout!";
    const segments = segmentMentions(content, resolveMentionBindings([DEV, AGENT], aliasesOf, content));
    expect(segments.filter((s) => s.kind === "mention").map((s) => s.kind === "mention" && s.pubkey)).toEqual([
      DEV,
      AGENT,
    ]);
    expect(segments.map((s) => s.text).join("")).toBe(content);
  });
});

describe("profileAliases", () => {
  it("collects display_name, name and the NIP-05 local part", () => {
    const content = JSON.stringify({ display_name: "Devankit", name: "dev", nip05: "dk@swf.example" });
    expect(profileAliases(content)).toEqual(["Devankit", "dev", "dk"]);
    // Case-insensitive duplicates are one alias.
    expect(profileAliases(JSON.stringify({ display_name: "Dev", name: "dev" }))).toEqual(["Dev"]);
  });

  it("skips the NIP-05 root identifier and survives malformed content", () => {
    expect(profileAliases(JSON.stringify({ name: "dev", nip05: "_@swf.example" }))).toEqual(["dev"]);
    expect(profileAliases("{not json", "Fallback")).toEqual(["Fallback"]);
  });
});
