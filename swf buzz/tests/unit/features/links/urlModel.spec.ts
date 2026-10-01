/** Phase H — URL detection and safety (features/links/urlModel.ts). */
import { describe, expect, it } from "vitest";
import { findLinks, linkDisplay, normalizeExternalUrl, trimUrlCandidate } from "@/features/links/urlModel";

const hrefs = (text: string) => findLinks(text).map((l) => l.href);
const texts = (text: string) => findLinks(text).map((l) => l.text);

describe("detection", () => {
  it("15. https URLs", () => {
    expect(hrefs("see https://x.com/buzzdotxyz/status/2105343423570182282")).toEqual([
      "https://x.com/buzzdotxyz/status/2105343423570182282",
    ]);
  });

  it("16. http URLs", () => {
    expect(hrefs("http://example.com")).toEqual(["http://example.com/"]);
  });

  it("17. www. hosts open over https", () => {
    expect(hrefs("go to www.example.com now")).toEqual(["https://www.example.com/"]);
  });

  it("18. query parameters", () => {
    expect(texts("https://x.com/foo?bar=1&baz=two")).toEqual(["https://x.com/foo?bar=1&baz=two"]);
  });

  it("19. fragments and ports", () => {
    expect(texts("https://example.com:8443/docs#install")).toEqual(["https://example.com:8443/docs#install"]);
  });

  it("20. trailing sentence punctuation stays text", () => {
    expect(texts("Check this: https://example.com.")).toEqual(["https://example.com"]);
    expect(texts("Really? https://example.com/a?!")).toEqual(["https://example.com/a"]);
    expect(texts("https://example.com/x, and more")).toEqual(["https://example.com/x"]);
  });

  it("21. parentheses: balanced ones belong to the URL, wrapping ones do not", () => {
    expect(texts("(https://example.com)")).toEqual(["https://example.com"]);
    expect(texts("https://example.com)")).toEqual(["https://example.com"]);
    expect(texts("https://en.wikipedia.org/wiki/Rust_(programming_language)")).toEqual([
      "https://en.wikipedia.org/wiki/Rust_(programming_language)",
    ]);
  });

  it("22. several URLs, with offsets into the original text", () => {
    const text = "a https://one.com b https://github.com/user/repo c";
    const links = findLinks(text);
    expect(links.map((l) => l.text)).toEqual(["https://one.com", "https://github.com/user/repo"]);
    for (const link of links) expect(text.slice(link.start, link.end)).toBe(link.text);
  });

  it("25. URLs across lines", () => {
    expect(texts("line one\nhttps://a.com/x\nline three https://b.com")).toEqual(["https://a.com/x", "https://b.com"]);
  });

  it("does not treat email addresses or mid-word text as links", () => {
    expect(findLinks("mail me at dev@www.example.com")).toEqual([]);
    expect(findLinks("xhttps://example.com")).toEqual([]);
    expect(findLinks("just a sentence.")).toEqual([]);
  });
});

describe("26/27. schemes", () => {
  it("only http/https are ever opened", () => {
    expect(normalizeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(normalizeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(normalizeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeExternalUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("unsafe schemes in text never become links", () => {
    expect(findLinks("click javascript:alert(1) or data:text/html,x or file:///c:/x")).toEqual([]);
  });

  it("rejects credentials, control characters and host-less URLs", () => {
    expect(normalizeExternalUrl("https://user:pw@example.com")).toBeNull();
    expect(normalizeExternalUrl("https://exa\u0000mple.com")).toBeNull();
    expect(normalizeExternalUrl("https://nohost")).toBeNull();
    expect(normalizeExternalUrl("https://" + "a".repeat(3000) + ".com")).toBeNull();
  });
});

describe("display", () => {
  it("shows host + path, truncating long paths (32. no overflow)", () => {
    const d = linkDisplay("https://www.x.com/buzzdotxyz/status/2105343423570182282?ref=abc");
    expect(d.host).toBe("x.com");
    expect(d.truncated).toBe(true);
    expect([...d.rest].length).toBeLessThanOrEqual(36);
    expect(d.rest.endsWith("…")).toBe(true);
  });

  it("a bare host has no path", () => {
    expect(linkDisplay("https://example.com/")).toEqual({ host: "example.com", rest: "", truncated: false });
  });

  it("trims only unbalanced closers", () => {
    expect(trimUrlCandidate("https://a.com/(x)")).toBe("https://a.com/(x)");
    expect(trimUrlCandidate("https://a.com/x))")).toBe("https://a.com/x");
  });
});
