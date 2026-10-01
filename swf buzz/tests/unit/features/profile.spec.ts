import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildProfileEvent,
  buildProfileFilter,
  isAcceptablePictureUrl,
  parseProfileEvent,
} from "@/protocol/profile";

const fetchEventsOnce = vi.fn();
const signAndPublish = vi.fn();
vi.mock("@/services/relayQuery", () => ({ fetchEventsOnce: (...args: unknown[]) => fetchEventsOnce(...args) }));
vi.mock("@/services/publish", () => ({ signAndPublish: (...args: unknown[]) => signAndPublish(...args) }));

const PK = "b".repeat(64);

describe("profile (kind:0)", () => {
  beforeEach(() => {
    fetchEventsOnce.mockReset();
    signAndPublish.mockReset();
    localStorage.clear();
  });

  it("builds an unsigned kind:0 whose content matches the reference desktop's shape", () => {
    const event = buildProfileEvent({ displayName: "  Ada Lovelace ", about: " Analyst ", picture: "https://x.example/a.png" });
    expect(event.kind).toBe(0);
    expect(event.tags).toEqual([]);
    expect(JSON.parse(event.content)).toEqual({
      display_name: "Ada Lovelace",
      name: "Ada Lovelace",
      about: "Analyst",
      picture: "https://x.example/a.png",
      profile_version: 2,
    });
  });

  it("carries the designation (job title) and the schema version", () => {
    const event = buildProfileEvent({
      displayName: "Ada",
      designation: "  Solutions Architect ",
      picture: "https://x.example/a.png",
    });
    expect(JSON.parse(event.content)).toMatchObject({
      designation: "Solutions Architect",
      profile_version: 2,
    });
  });

  it("omits empty optional fields but always states the version", () => {
    expect(
      JSON.parse(
        buildProfileEvent({ displayName: "Ada", about: "  ", picture: "", designation: " " }).content,
      ),
    ).toEqual({
      display_name: "Ada",
      name: "Ada",
      profile_version: 2,
    });
  });

  it("reads designation and version back, defaulting an unversioned profile to v1", () => {
    const v2 = parseProfileEvent({
      id: "i", pubkey: PK, created_at: 1, kind: 0, sig: "s", tags: [],
      content: JSON.stringify({ display_name: "Ada", designation: "Architect", profile_version: 2 }),
    });
    expect(v2.designation).toBe("Architect");
    expect(v2.profileVersion).toBe(2);

    // A profile written before versioning existed is v1 — not "unknown".
    const legacy = parseProfileEvent({
      id: "i", pubkey: PK, created_at: 1, kind: 0, sig: "s", tags: [],
      content: JSON.stringify({ display_name: "Ada" }),
    });
    expect(legacy.profileVersion).toBe(1);
    expect(legacy.designation).toBeUndefined();
  });

  it("carries no pubkey — the profile belongs to whichever key signs it (the local identity)", () => {
    const event = buildProfileEvent({ displayName: "Ada" }) as unknown as Record<string, unknown>;
    expect(event.pubkey).toBeUndefined();
  });

  it("only https pictures are acceptable", () => {
    expect(isAcceptablePictureUrl("")).toBe(true);
    expect(isAcceptablePictureUrl("https://x.example/a.png")).toBe(true);
    for (const bad of ["http://x.example/a.png", "javascript:alert(1)", "data:image/png;base64,AAA", "not a url", "ftp://x/y"]) {
      expect(isAcceptablePictureUrl(bad), bad).toBe(false);
    }
  });

  it("loads a profile: display name, picture and about; falls back to a pubkey prefix", () => {
    const loaded = parseProfileEvent({
      id: "i", pubkey: PK, created_at: 1, kind: 0, sig: "s", tags: [],
      content: JSON.stringify({ display_name: "Ada", picture: "https://x/a.png", about: "hi" }),
    });
    expect(loaded).toMatchObject({ pubkey: PK, displayName: "Ada", avatarUrl: "https://x/a.png", about: "hi" });

    const broken = parseProfileEvent({ id: "i", pubkey: PK, created_at: 1, kind: 0, sig: "s", tags: [], content: "{nope" });
    expect(broken.displayName).toBe(PK.slice(0, 8));
  });

  it("the profile filter is keyed by public key", () => {
    expect(buildProfileFilter([PK])).toEqual({ kinds: [0], authors: [PK] });
  });

  it("publishProfile signs+publishes the built kind:0", async () => {
    const { profileService } = await import("@/services/ProfileService");
    // Saving is for the signed-in identity (features/profile/myProfile.ts).
    const { createPinia, setActivePinia } = await import("pinia");
    setActivePinia(createPinia());
    const { useSessionStore } = await import("@/stores/session");
    useSessionStore().$patch({ pubkey: PK });
    signAndPublish.mockResolvedValueOnce({ id: "e", pubkey: PK, kind: 0, created_at: 1, content: "{}", tags: [], sig: "s" });
    await profileService.publishProfile({ displayName: "Ada" });
    expect(signAndPublish).toHaveBeenCalledTimes(1);
    expect(signAndPublish.mock.calls[0][0]).toMatchObject({ kind: 0 });
  });

  it("hasProfile is true only when the relay has a kind:0 for that key", async () => {
    const { profileService } = await import("@/services/ProfileService");
    fetchEventsOnce.mockResolvedValueOnce([{ id: "e" }]);
    await expect(profileService.hasProfile(PK)).resolves.toBe(true);
    fetchEventsOnce.mockResolvedValueOnce([]);
    await expect(profileService.hasProfile(PK)).resolves.toBe(false);
    expect(fetchEventsOnce.mock.calls[0][0][0]).toMatchObject({ kinds: [0], authors: [PK], limit: 1 });
  });

  /**
   * The "skip" bypass was REMOVED with the mandatory-profile work: a
   * localStorage flag could permanently exempt an identity from having a
   * profile, which is exactly what left members showing raw hex keys to each
   * other. `features/onboarding/profileSetup.ts` no longer exists.
   */
  it("has no profile-setup bypass module", async () => {
    // Checked on disk, not via `import()`: Vite resolves imports statically, so
    // importing a deleted module fails the whole file rather than the assertion.
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(process.cwd(), "src/features/onboarding/profileSetup.ts"))).toBe(false);
  });
});
