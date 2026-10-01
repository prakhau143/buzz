import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import CloseButton from "@/components/CloseButton.vue";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const TESTS = join(ROOT, "tests");

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) filesUnder(path, out);
    else if (/\.(vue|ts|css)$/.test(entry)) out.push(path);
  }
  return out;
}
/** `src/` only — for rules about how components are written. */
const sourceFiles = () => filesUnder(SRC);
/** `src/` + `tests/` — encoding damage is not confined to shipped code, and the
 *  PowerShell edits that cause it hit spec files just as readily. */
const allAuthoredFiles = () => [...filesUnder(SRC), ...filesUnder(TESTS)];
const rel = (path: string) => path.slice(ROOT.length + 1).replace(/\\/g, "/");
const read = (path: string) => readFileSync(path, "utf8");

describe("CloseButton", () => {
  it("is a real button with an accessible name and an inline SVG (no icon font, no glyph)", () => {
    const wrapper = mount(CloseButton);
    const button = wrapper.find("[data-testid=close-button]");
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.attributes("type")).toBe("button");
    expect(button.attributes("aria-label")).toBe("Close");
    expect(wrapper.find("svg").exists()).toBe(true);
    // the icon is decorative; the button carries the name
    expect(wrapper.find("svg").attributes("aria-hidden")).toBe("true");
    // no text content to be garbled by an encoding round trip
    expect(button.text()).toBe("");
  });

  it("takes a custom label and emits click", async () => {
    const wrapper = mount(CloseButton, { props: { label: "Close thread" } });
    expect(wrapper.find("[data-testid=close-button]").attributes("aria-label")).toBe("Close thread");
    await wrapper.find("[data-testid=close-button]").trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });
});

/**
 * The bug this guards against: `✕` in five dialogs was re-saved in a
 * single-byte encoding, so its UTF-8 bytes (E2 9C 95) became three junk
 * characters and every close control rendered as garbage at once. It looked
 * like a CSS problem and was an encoding problem.
 */
describe("source encoding — no mojibake anywhere in src/", () => {
  // Sequences that only appear when UTF-8 bytes were decoded as cp1252/latin-1.
  // Written with escapes so the pattern itself contains no non-ASCII bytes.
  //
  // The example sequences are described in words rather than written out:
  // now that this check covers tests/ as well as src/, a literal example would
  // make this file its own first offender.
  const MOJIBAKE = new RegExp(
    [
      "\\u00e2\\u20ac", // a mangled en/em dash, ellipsis or curly quote
      "\\u00e2\\u0153", // a mangled check/cross mark
      "\\u00c3[\\u0080-\\u00bf]", // A-tilde + continuation byte
      "\\u00c2[\\u00a0-\\u00bf]", // A-circumflex + continuation byte
    ].join("|"),
  );

  /** U+FFFD, written as an escape for the same reason as above. */
  const REPLACEMENT_CHAR = "\uFFFD";

  it("no authored file contains double-encoded characters", () => {
    const offenders = allAuthoredFiles()
      .filter((path) => MOJIBAKE.test(read(path)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("every authored file is valid UTF-8 (no replacement characters)", () => {
    const offenders = allAuthoredFiles()
      .filter((path) => read(path).includes(REPLACEMENT_CHAR))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  /**
   * A BOM is the other half of the same accident: the editor that re-encodes a
   * file as cp1252 is usually the one that prepends `EF BB BF`. It is invisible
   * in a diff, survives review, and `readFileSync(path, "utf8")` leaves it as a
   * leading U+FEFF rather than stripping it — so the mojibake checks above sail
   * straight past it. It broke `just relay` once in this repo when it landed in
   * an `.env`. Cheap to assert, so assert it.
   */
  it("no authored file starts with a UTF-8 BOM", () => {
    const offenders = allAuthoredFiles()
      .filter((path) => read(path).charCodeAt(0) === 0xfeff)
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("close controls are consistent app-wide", () => {
  it("no dialog hand-rolls a close button from a Unicode glyph", () => {
    // A raw glyph is what broke; CloseButton's SVG is the one sanctioned form.
    const glyphClose = /<button[^>]*(?:class="close|aria-label="Close)[^>]*>\s*[✕×✖⨯]\s*<\/button>/;
    const offenders = sourceFiles()
      .filter((path) => path.endsWith(".vue") && glyphClose.test(read(path)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("no CSS pseudo-element draws a close icon via `content`", () => {
    const contentGlyph = /content:\s*["'][✕×✖⨯]["']/;
    const offenders = sourceFiles()
      .filter((path) => contentGlyph.test(read(path)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
