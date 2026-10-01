/**
 * The one definition of "complete profile". Every gate asks this, so it is
 * pinned hard: a v1 profile must NOT be waved through, and nothing may be
 * accepted without a name, a designation and a photo.
 */
import { describe, expect, it } from "vitest";
import {
  completenessOfFields,
  completenessOfProfile,
  isProfileComplete,
  validateDesignation,
  validateDisplayName,
  validatePicture,
} from "@/features/profile/profileCompleteness";
import type { UserProfile } from "@/types/domain";

const PK = "a".repeat(64);

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    pubkey: PK,
    displayName: "Ada Lovelace",
    designation: "Solutions Architect",
    avatarUrl: "https://media.example/a.webp",
    profileVersion: 2,
    isAgent: false,
    ...overrides,
  };
}

describe("completenessOfProfile", () => {
  it("accepts a full v2 profile", () => {
    expect(isProfileComplete(profile())).toBe(true);
    expect(completenessOfProfile(profile()).missing).toEqual([]);
  });

  it("treats a missing profile as incomplete", () => {
    const result = completenessOfProfile(null);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("version");
  });

  /**
   * THE upgrade case: someone who filled in a profile before designation
   * existed. It may look fine — name and picture present — but it cannot carry
   * a designation, so it must come back through onboarding rather than being
   * silently accepted.
   */
  it("rejects a v1 profile even when name and picture are present", () => {
    const legacy = profile({ profileVersion: 1, designation: undefined });
    const result = completenessOfProfile(legacy);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("version");
    expect(result.missing).toContain("designation");
  });

  it("rejects a profile with no version recorded (pre-versioning)", () => {
    expect(isProfileComplete(profile({ profileVersion: undefined }))).toBe(false);
  });

  it("rejects a missing designation", () => {
    expect(completenessOfProfile(profile({ designation: undefined })).missing).toContain(
      "designation",
    );
  });

  /**
   * The photo is OPTIONAL. Requiring it blocked sign-in behind an upload that
   * can fail for reasons the person cannot fix; a name and a job title already
   * identify a colleague, and `AvatarCircle` draws initials when there is no
   * photo — so a raw public key is never shown either way.
   */
  it("accepts a profile with no picture", () => {
    expect(isProfileComplete(profile({ avatarUrl: undefined }))).toBe(true);
  });

  it("still rejects a picture that is present but not https", () => {
    expect(completenessOfProfile(profile({ avatarUrl: "http://x/a.png" })).missing).toContain(
      "picture",
    );
  });

  it("rejects a one-character display name", () => {
    expect(completenessOfProfile(profile({ displayName: "A" })).missing).toContain("displayName");
  });

  it("accepts a future schema version", () => {
    expect(isProfileComplete(profile({ profileVersion: 3 }))).toBe(true);
  });

  it("does not require About", () => {
    expect(isProfileComplete(profile({ about: undefined }))).toBe(true);
  });
});

describe("field validation", () => {
  it("requires 2-40 characters for a display name, after trimming", () => {
    expect(validateDisplayName("A")).toBeTruthy();
    expect(validateDisplayName(" A ")).toBeTruthy();
    expect(validateDisplayName("Ab")).toBeNull();
    expect(validateDisplayName("x".repeat(40))).toBeNull();
    expect(validateDisplayName("x".repeat(41))).toBeTruthy();
    expect(validateDisplayName(undefined)).toBeTruthy();
  });

  it("requires a designation of at most 40 characters", () => {
    expect(validateDesignation("")).toBeTruthy();
    expect(validateDesignation("   ")).toBeTruthy();
    expect(validateDesignation("Solutions Architect")).toBeNull();
    expect(validateDesignation("x".repeat(41))).toBeTruthy();
  });

  it("accepts any free text as a designation — it is not a fixed list", () => {
    expect(validateDesignation("Chief Bee Keeper")).toBeNull();
    expect(validateDesignation("インフラ")).toBeNull();
  });

  it("allows no picture, but requires https when one is given", () => {
    expect(validatePicture("")).toBeNull();
    expect(validatePicture(undefined)).toBeNull();
    expect(validatePicture("http://x/a.png")).toBeTruthy();
    expect(validatePicture("https://x/a.png")).toBeNull();
  });

  /**
   * REGRESSION: a photo uploaded successfully was then rejected by the form.
   * The development relay serves what it stored over plain http on a loopback
   * host, so an unconditional https rule refused the client's own upload URL.
   */
  it("accepts a loopback http URL — that is what the local relay returns", () => {
    expect(validatePicture("http://localhost:3000/media/abc.jpg")).toBeNull();
    expect(validatePicture("http://swf-dev.localhost:3000/media/abc.jpg")).toBeNull();
    expect(validatePicture("http://127.0.0.1:3000/media/abc.jpg")).toBeNull();
  });

  it("still refuses a script or data payload dressed up as a picture", () => {
    expect(validatePicture("javascript:alert(1)")).toBeTruthy();
    expect(validatePicture("data:image/png;base64,AAAA")).toBeTruthy();
    expect(validatePicture("not a url at all")).toBeTruthy();
    // Not loopback, however much it would like to be.
    expect(validatePicture("http://localhost.evil.example/a.png")).toBeTruthy();
  });
});

describe("completenessOfFields — what the form asks", () => {
  it("reports every unmet requirement at once", () => {
    const result = completenessOfFields({ displayName: "", designation: "", picture: "" });
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(["displayName", "designation"]);
  });

  it("is complete with a name and a designation, with or without a photo", () => {
    expect(completenessOfFields({ displayName: "Ada", designation: "Architect" }).complete).toBe(
      true,
    );
    expect(
      completenessOfFields({
        displayName: "Ada",
        designation: "Architect",
        picture: "https://x/a.png",
      }).complete,
    ).toBe(true);
  });
});
