/**
 * Source-level guards for the Community modal's responsive contract.
 *
 * These assert the RULES EXIST, not that they render correctly — jsdom has no
 * layout engine, so it cannot report a real overflow. Visual confirmation at
 * the six breakpoints still needs a human at a real window; that is recorded as
 * outstanding rather than claimed here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const modal = readFileSync(
  resolve(__dirname, "../../../../src/features/community-members/ui/CommunityManagementModal.vue"),
  "utf8",
);
const panel = readFileSync(
  resolve(__dirname, "../../../../src/features/community-members/ui/CommunityMembersPanel.vue"),
  "utf8",
);

describe("Community modal responsive rules", () => {
  it("goes full-screen at 768px and below", () => {
    const mobileBlock = modal.slice(modal.indexOf("@media (max-width: 768px)"));
    expect(mobileBlock).toContain("border-radius: 0");
    expect(mobileBlock).toMatch(/width:\s*100%/);
    expect(mobileBlock).toMatch(/height:\s*100%/);
  });

  it("hides horizontal overflow in the scrolling body", () => {
    // Long pubkeys and invite links are the usual cause of a modal growing
    // wider than a phone viewport.
    expect(modal).toContain("overflow-x: hidden");
  });

  it("lets the card shrink so it scrolls internally instead of overflowing", () => {
    expect(modal).toMatch(/\.modal-card\s*\{[^}]*min-height:\s*0/s);
  });

  it("stacks the roster toolbar rather than squeezing both controls", () => {
    const mobileBlock = panel.slice(panel.indexOf("@media (max-width: 768px)"));
    expect(mobileBlock).toContain("flex-direction: column");
  });
});
