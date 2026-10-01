import { CURRENT_PROFILE_VERSION, isAcceptablePictureUrl } from "@/protocol/profile";
import type { UserProfile } from "@/types/domain";

/**
 * THE definition of "is this profile complete?".
 *
 * One function, used by the login gate, the community-entry gate, the setup
 * form's submit button and the tests. Scattering this rule is how a profile
 * ends up accepted by one screen and rejected by another.
 *
 * A profile is complete at schema v2 or later with a valid display name and
 * designation. The photo and About are optional — see `validatePicture`.
 */

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;
export const DESIGNATION_MAX = 40;

export type ProfileField = "displayName" | "designation" | "picture" | "version";

export interface ProfileCompleteness {
  complete: boolean;
  /** Which requirements are unmet — drives inline validation, not just a boolean. */
  missing: ProfileField[];
}

export function validateDisplayName(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length < DISPLAY_NAME_MIN) {
    return `Your name needs at least ${DISPLAY_NAME_MIN} characters.`;
  }
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return `Your name can be at most ${DISPLAY_NAME_MAX} characters.`;
  }
  return null;
}

export function validateDesignation(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return "Add your role or job title.";
  if (trimmed.length > DESIGNATION_MAX) {
    return `Your title can be at most ${DESIGNATION_MAX} characters.`;
  }
  return null;
}

/**
 * A photo is OPTIONAL.
 *
 * It was briefly required, on the theory that everyone should have a face. In
 * practice that blocks sign-in on an upload that can fail for reasons the
 * person cannot fix, and a name plus a job title already tell colleagues who
 * someone is. Anyone without a photo gets the generated initials avatar
 * (`AvatarCircle`), so no raw public key is ever shown either way.
 *
 * A picture that IS supplied must still be a valid https URL.
 */
export function validatePicture(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return null;
  if (!isAcceptablePictureUrl(trimmed)) {
    return "That doesn't look like an image link. Use an https:// address.";
  }
  return null;
}

/** Completeness of the FIELDS being edited (no version — the form always writes the current one). */
export function completenessOfFields(fields: {
  displayName?: string;
  designation?: string;
  picture?: string;
}): ProfileCompleteness {
  const missing: ProfileField[] = [];
  if (validateDisplayName(fields.displayName)) missing.push("displayName");
  if (validateDesignation(fields.designation)) missing.push("designation");
  if (validatePicture(fields.picture)) missing.push("picture");
  return { complete: missing.length === 0, missing };
}

/**
 * Completeness of a RESOLVED profile — what the gates ask.
 *
 * `null` means no profile has been published at all, which is incomplete by
 * definition. A v1 profile is incomplete even if it happens to carry a name and
 * picture, because it cannot carry a designation — that is the whole point of
 * the version bump, and it is what makes existing users upgrade rather than
 * being silently let through.
 */
export function completenessOfProfile(profile: UserProfile | null): ProfileCompleteness {
  if (!profile) {
    return { complete: false, missing: ["version", "displayName", "designation", "picture"] };
  }
  const missing: ProfileField[] = [];
  if ((profile.profileVersion ?? 1) < CURRENT_PROFILE_VERSION) missing.push("version");
  if (validateDisplayName(profile.displayName)) missing.push("displayName");
  if (validateDesignation(profile.designation)) missing.push("designation");
  if (validatePicture(profile.avatarUrl)) missing.push("picture");
  return { complete: missing.length === 0, missing };
}

export function isProfileComplete(profile: UserProfile | null): boolean {
  return completenessOfProfile(profile).complete;
}
