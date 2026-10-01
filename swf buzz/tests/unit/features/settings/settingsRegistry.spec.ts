/**
 * The Settings nav is an ALLOWLIST (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md §22):
 * exactly the approved sections exist (Phase E adds Communities and Send feedback), the excluded OLD BUZZ sections can
 * never appear, and Invites is for owners/admins only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_IDS,
  isSettingsSection,
  searchSettings,
  visibleSettingsSections,
} from "@/features/settings/settingsRegistry";

const EXCLUDED = [
  "agents",
  "compute",
  "experimental",
  "experiments",
  "hosted-communities",
  "channel-templates",
  "voice",
  "local-archive",
  "moderation",
  "doctor",
];

describe("settings allowlist", () => {
  it("contains exactly the approved sections, grouped Profile / App / Communities / Support (Phase E)", () => {
    expect([...SETTINGS_SECTION_IDS].sort()).toEqual(
      [
        "profile",
        "appearance",
        "notifications",
        "shortcuts",
        "custom-emoji",
        "mobile",
        "updates",
        "communities",
        "community",
        "invites",
        "feedback",
      ].sort(),
    );
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual(["Profile", "App", "Communities", "Support"]);
    const byGroup = (g: string) => SETTINGS_SECTIONS.filter((s) => s.group === g).map((s) => s.id);
    expect(byGroup("profile")).toEqual(["profile"]);
    expect(byGroup("app")).toEqual(["appearance", "notifications", "shortcuts", "custom-emoji", "mobile", "updates"]);
    expect(byGroup("communities")).toEqual(["communities", "community", "invites"]);
    expect(byGroup("support")).toEqual(["feedback"]);
    // Every section belongs to exactly one known group.
    expect(SETTINGS_SECTIONS.every((s) => SETTINGS_GROUPS.some((g) => g.id === s.group))).toBe(true);
    expect(DEFAULT_SETTINGS_SECTION).toBe("profile");
  });

  it("excluded OLD BUZZ sections are not valid sections and are never listed", () => {
    for (const id of EXCLUDED) {
      expect(isSettingsSection(id), id).toBe(false);
      expect(SETTINGS_SECTIONS.some((s) => s.id === id), id).toBe(false);
    }
  });

  it("no section component exists for an excluded feature", () => {
    const files = readdirSync("src/features/settings/ui/sections").map((f) => f.toLowerCase());
    for (const word of ["agent", "compute", "experiment", "hosted", "template", "voice", "archive"]) {
      expect(files.some((f) => f.includes(word)), word).toBe(false);
    }
  });

  it("Invites is shown only to owners/admins", () => {
    expect(visibleSettingsSections({ canManageCommunity: false }).map((s) => s.id)).not.toContain("invites");
    expect(visibleSettingsSections({ canManageCommunity: true }).map((s) => s.id)).toContain("invites");
  });

  it("search matches labels and keywords, case-insensitively", () => {
    const all = visibleSettingsSections({ canManageCommunity: true });
    expect(searchSettings("THEME", all).map((s) => s.id)).toEqual(["appearance"]);
    expect(searchSettings("qr", all).map((s) => s.id)).toEqual(["mobile"]);
    expect(searchSettings("npub", all).map((s) => s.id)).toEqual(["profile"]);
    expect(searchSettings("", all)).toHaveLength(all.length);
    expect(searchSettings("agents", all)).toHaveLength(0);
  });

  it("the Settings view renders sections only through the registry's component map", () => {
    const view = readFileSync("src/features/settings/ui/SettingsView.vue", "utf-8");
    for (const id of SETTINGS_SECTION_IDS) {
      expect(new RegExp(String.raw`(^|\s)"?${id}"?:\s*lazy\(`, "m").test(view), id).toBe(true);
    }
    expect(view.match(/:\s*lazy\(/g)).toHaveLength(SETTINGS_SECTION_IDS.length);
    expect(view).not.toMatch(/featureGate|getFeature|preview-features/);
  });
});
