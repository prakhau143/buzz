import { describe, expect, it } from "vitest";
import { AppError, userMessageFor } from "@/services/errors";

describe("userMessageFor", () => {
  it("surfaces an AppError's own deliberately-authored message, not the generic per-code fallback", () => {
    const err = new AppError(
      "auth_failed",
      "Okta isn't configured for this build yet. Ask an admin, or use Development Mode.",
    );
    expect(userMessageFor(err)).toBe(
      "Okta isn't configured for this build yet. Ask an admin, or use Development Mode.",
    );
  });

  it("falls back to the generic per-code message for a raw Error", () => {
    expect(userMessageFor(new Error("ECONNRESET at 10.0.0.1:5432"))).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("falls back to the generic per-code message for a raw string/unknown value", () => {
    expect(userMessageFor("some raw internal string")).toBe("Something went wrong. Please try again.");
    expect(userMessageFor(null)).toBe("Something went wrong. Please try again.");
  });
});
