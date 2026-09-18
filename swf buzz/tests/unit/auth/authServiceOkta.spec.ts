import { describe, expect, it } from "vitest";
import { oktaLoginErrorMessage } from "@/features/auth/authService.okta";

describe("oktaLoginErrorMessage", () => {
  it("maps 'okta_not_configured' to a Development-Mode-aware message", () => {
    expect(oktaLoginErrorMessage("okta_not_configured")).toBe(
      "Okta isn't configured for this build yet. Ask an admin, or use Development Mode.",
    );
  });

  it("maps a timeout to a redirect-URI-aware message — the exact bug class this exists to explain", () => {
    expect(oktaLoginErrorMessage("timed out waiting for sign-in to complete")).toContain(
      "redirect URI",
    );
  });

  it("maps state mismatch, browser-open, token-exchange, and token-verification failures distinctly", () => {
    expect(oktaLoginErrorMessage("sign-in could not be verified — please try again")).toBe(
      "sign-in could not be verified — please try again",
    );
    expect(oktaLoginErrorMessage("could not open the system browser: some os error")).toMatch(
      /browser/i,
    );
    expect(oktaLoginErrorMessage("token exchange failed: 400 Bad Request")).toMatch(/exchange/i);
    expect(oktaLoginErrorMessage("could not verify the identity token: bad signature")).toMatch(
      /verified/i,
    );
  });

  it("falls back to a generic message for an unrecognized error shape", () => {
    expect(oktaLoginErrorMessage(new Error("boom"))).toBe("Sign-in with Okta failed.");
    expect(oktaLoginErrorMessage(undefined)).toBe("Sign-in with Okta failed.");
  });
});
