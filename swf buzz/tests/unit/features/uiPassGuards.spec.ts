/**
 * Guards for the UI pass: the details-pane coupling, the icon system, and the
 * accessibility/token invariants that had no test before.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { useUiStore } from "@/stores/ui";
import AppIcon from "@/components/AppIcon.vue";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

function vueFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) vueFiles(p, out);
    else if (entry.endsWith(".vue")) out.push(p);
  }
  return out;
}

beforeEach(() => setActivePinia(createPinia()));

describe("details pane — visibility derives from the panel", () => {
  /**
   * REGRESSION: `detailsPaneOpen` was an independent flag, so
   * `closeContextPanel()` cleared the content and left the frame visible — an
   * empty pane that only the now-removed "Hide details" toggle could dismiss.
   */
  it("is closed when no context panel is open", () => {
    expect(useUiStore().detailsPaneOpen).toBe(false);
  });

  it("opens when a panel opens, and closes when the panel closes", () => {
    const ui = useUiStore();
    ui.openThread("root-1");
    expect(ui.detailsPaneOpen).toBe(true);

    ui.closeContextPanel();
    expect(ui.detailsPaneOpen, "closing the panel must close the pane").toBe(false);
  });

  it("cannot be left open with nothing in it, from any panel kind", () => {
    const ui = useUiStore();
    for (const open of [() => ui.openThread("r"), () => ui.openProfile("pk"), () => ui.openChannelDetails()]) {
      open();
      expect(ui.detailsPaneOpen).toBe(true);
      ui.closeContextPanel();
      expect(ui.detailsPaneOpen).toBe(false);
    }
  });

  it("closes when the selection changes to another channel or conversation", () => {
    const ui = useUiStore();
    ui.openThread("root-1");
    ui.selectChannel("c2");
    expect(ui.detailsPaneOpen).toBe(false);

    ui.openProfile("pk");
    ui.selectConversation("dm1");
    expect(ui.detailsPaneOpen).toBe(false);
  });
});

describe("the details toggle is gone", () => {
  it("AppShell renders no Show/Hide details control", () => {
    // Comments are stripped first: the note explaining WHY the toggle was
    // removed legitimately names it, and must not count as the toggle itself.
    const shell = read("layouts", "AppShell.vue")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(shell).not.toContain("Hide details");
    expect(shell).not.toContain("Show details");
    expect(shell).not.toContain("details-toggle-bar");
  });

  it("no view still passes the toggle prop", () => {
    for (const view of ["ChannelsView.vue", "DmView.vue"]) {
      expect(read("views", view)).not.toContain("show-details-toggle");
    }
  });

  it("the store exposes no manual toggle action", () => {
    expect(read("stores", "ui.ts")).not.toContain("toggleDetailsPane");
  });
});

describe("AppIcon", () => {
  it("renders an accessible-by-omission svg at the requested size", () => {
    const wrapper = mount(AppIcon, { props: { name: "users", size: 16 } });
    const svg = wrapper.find("svg");
    expect(svg.exists()).toBe(true);
    // Decorative: the BUTTON carries the name, so the icon must be hidden.
    expect(svg.attributes("aria-hidden")).toBe("true");
    expect(svg.attributes("width")).toBe("16");
    expect(svg.attributes("stroke")).toBe("currentColor");
  });

  it("draws at least one path for every icon in the set", () => {
    const names = [
      "menu", "close", "users", "lock", "hash", "plus", "settings", "copy",
      "leave", "reply", "link", "warning", "check", "trash", "more", "search",
      "filter", "edit", "send",
    ] as const;
    for (const name of names) {
      const wrapper = mount(AppIcon, { props: { name } });
      expect(wrapper.findAll("path").length, name).toBeGreaterThan(0);
    }
  });

  /**
   * The whole point of the component: emoji glyphs in markup are what turn into
   * mojibake when a tool re-saves a file in a single-byte encoding. ASCII path
   * data cannot be corrupted that way.
   */
  it("contains no non-ASCII byte at all", () => {
    const source = read("components", "AppIcon.vue");
    const nonAscii = [...source].filter((ch) => ch.charCodeAt(0) > 126);
    expect(nonAscii).toEqual([]);
  });

  it("inherits colour rather than hard-coding one", () => {
    expect(read("components", "AppIcon.vue")).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe("design tokens and focus", () => {
  const tokens = () => read("app", "theme", "tokens.css");

  /** REGRESSION: `--color-accent` was used in 11 places and defined nowhere. */
  it("defines every colour token that components reference", () => {
    const defined = new Set([...tokens().matchAll(/(--color-[a-z-]+):/g)].map((m) => m[1]));
    const used = new Set<string>();
    for (const file of vueFiles()) {
      for (const m of readFileSync(file, "utf8").matchAll(/var\((--color-[a-z-]+)/g)) {
        used.add(m[1]);
      }
    }
    const undefinedTokens = [...used].filter((t) => !defined.has(t));
    expect(undefinedTokens).toEqual([]);
  });

  it("has a global focus-visible rule, so no control is left without a ring", () => {
    expect(tokens()).toContain(":focus-visible");
    expect(tokens()).toContain("--focus-ring-color");
  });
});

describe("avatar upload format", () => {
  /**
   * REGRESSION: avatars were encoded with `canvas.toBlob(..., "image/webp")`
   * and every upload failed with HTTP 422. The relay validates image bytes
   * strictly and rejects unexpected chunks
   * (`buzz-media/src/validation.rs:702-707`), which browser-encoded WebP
   * carries. The identical picture as JPEG or PNG uploads fine — verified
   * against the running relay.
   */
  it("encodes avatars as JPEG, not WebP", () => {
    const media = read("services", "MediaService.ts");
    expect(media).toContain('canvas.toBlob(resolve, "image/jpeg"');
    // Only the OUTPUT must not be WebP. Accepting a WebP the user picks is
    // fine and intended — it gets re-encoded before upload.
    expect(media).not.toContain('canvas.toBlob(resolve, "image/webp"');
  });

  /**
   * The input side used to be a three-entry allow-list (JPEG/PNG/WebP), which
   * refused ordinary files (GIF, AVIF, HEIC) before they were ever decoded.
   * Since every upload is re-encoded to JPEG, the only real requirement is that
   * the browser can decode it, so any `image/*` is accepted and an undecodable
   * file is reported by `prepareAvatar` instead.
   */
  it("accepts any image format the browser can decode", () => {
    const media = read("services", "MediaService.ts");
    expect(media).toContain('file.type.startsWith("image/")');
    expect(media).not.toContain("ACCEPTED_IMAGE_TYPES");
    expect(read("views", "ProfileSetupView.vue")).toContain('accept="image/*"');
  });

  it("paints a background before drawing, so transparency does not become black", () => {
    expect(read("services", "MediaService.ts")).toContain("fillRect");
  });

  it("surfaces the relay's own failure reason", () => {
    const media = read("services", "MediaService.ts");
    expect(media).toContain("relayReason");
    expect(media).toContain("422");
  });
});

describe("profile setup is mandatory", () => {
  it("the bypass module no longer exists", () => {
    expect(existsSync(join(SRC, "features", "onboarding", "profileSetup.ts"))).toBe(false);
  });

  it("the setup view offers no skip", () => {
    // Comments stripped, as above: the doc block explains that the skip was
    // removed and names it while doing so.
    const view = read("views", "ProfileSetupView.vue")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(view).not.toContain("Skip for now");
    expect(view).not.toContain("profile-skip");
  });

  it("the landing gate judges completeness, not mere existence", () => {
    const useAuth = read("features", "auth", "useAuth.ts");
    expect(useAuth).toContain("isProfileComplete");
    expect(useAuth).not.toContain("isProfileSetupSkipped");
  });
});
