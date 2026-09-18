import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

describe("currentCommunity", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("resolves to null when nothing is cached and no env default is set", async () => {
    const { currentCommunityId } = await import("@/features/communities/currentCommunity");
    expect(currentCommunityId.value).toBeNull();
  });

  it("resolves to a previously cached community id on a fresh module load", async () => {
    localStorage.setItem("swf_current_community_id", "c-cached");
    const { currentCommunityId } = await import("@/features/communities/currentCommunity");
    expect(currentCommunityId.value).toBe("c-cached");
  });

  it("setCurrentCommunityId updates the reactive value and persists it", async () => {
    const { currentCommunityId, setCurrentCommunityId } = await import(
      "@/features/communities/currentCommunity"
    );

    setCurrentCommunityId("c-new");

    expect(currentCommunityId.value).toBe("c-new");
    expect(localStorage.getItem("swf_current_community_id")).toBe("c-new");
  });
});
