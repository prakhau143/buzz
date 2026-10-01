import { describe, expect, it } from "vitest";
import { canEditMessage, messageDeleteMode } from "@/features/channels/channelPermissions";

const ME = "me";
const OTHER = "other";

describe("canEditMessage", () => {
  it("allows the author who is still a member", () => {
    expect(
      canEditMessage({ myPubkey: ME, authorPubkey: ME, myRole: "member", visibility: "private" }),
    ).toBe(true);
  });

  it("refuses editing someone else's message, even as owner", () => {
    // OLD BUZZ has no "admin edit": `validate_edit_ownership` requires the
    // actor to BE the author (or the author agent's owner).
    expect(
      canEditMessage({ myPubkey: ME, authorPubkey: OTHER, myRole: "owner", visibility: "open" }),
    ).toBe(false);
  });

  it("refuses an author who has lost access to a private channel", () => {
    expect(
      canEditMessage({ myPubkey: ME, authorPubkey: ME, myRole: null, visibility: "private" }),
    ).toBe(false);
  });

  it("allows a non-member author in an open channel", () => {
    expect(
      canEditMessage({ myPubkey: ME, authorPubkey: ME, myRole: null, visibility: "open" }),
    ).toBe(true);
  });

  it("refuses when signed out", () => {
    expect(
      canEditMessage({ myPubkey: null, authorPubkey: ME, myRole: "owner", visibility: "open" }),
    ).toBe(false);
  });
});

describe("messageDeleteMode", () => {
  it("gives the author the self path (kind:5)", () => {
    expect(
      messageDeleteMode({ myPubkey: ME, authorPubkey: ME, myRole: "member", visibility: "private" }),
    ).toBe("self");
  });

  it("gives an owner/admin the ADMIN path for another person's message", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(
        messageDeleteMode({ myPubkey: ME, authorPubkey: OTHER, myRole: role, visibility: "private" }),
      ).toBe("admin");
    }
  });

  it("gives a plain member nothing for another person's message", () => {
    expect(
      messageDeleteMode({ myPubkey: ME, authorPubkey: OTHER, myRole: "member", visibility: "open" }),
    ).toBeNull();
  });

  it("falls back to the admin path for an author who lost private-channel access but holds a role", () => {
    expect(
      messageDeleteMode({ myPubkey: ME, authorPubkey: ME, myRole: "admin", visibility: "private" }),
    ).toBe("self");
  });

  it("gives a signed-out viewer nothing", () => {
    expect(
      messageDeleteMode({ myPubkey: null, authorPubkey: ME, myRole: "owner", visibility: "open" }),
    ).toBeNull();
  });
});
