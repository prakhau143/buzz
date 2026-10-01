import { beforeEach, describe, expect, it } from "vitest";
import {
  activeRelayUrl,
  addCommunity,
  clearCommunitiesForTests,
  communities,
  relayHost,
  relayHttpBase,
  setActiveRelay,
} from "@/features/communities/relayCommunities";
import { config } from "@/app/config";

describe("relay community list (addresses only — the relay owns membership)", () => {
  beforeEach(() => {
    localStorage.clear();
    clearCommunitiesForTests();
  });

  it("defaults to the build's relay until a community is chosen", () => {
    expect(activeRelayUrl.value).toBe(config.relayUrl);
  });

  it("adds a community once (deduplicated) and names it after its host", () => {
    addCommunity("ws://acme.localhost:3000");
    addCommunity("ws://acme.localhost:3000", "ignored second name");
    expect(communities.value).toHaveLength(1);
    expect(communities.value[0]).toMatchObject({ relayUrl: "ws://acme.localhost:3000", name: "acme.localhost:3000" });
  });

  it("switching the active community changes the relay the app connects to", () => {
    setActiveRelay("ws://acme.localhost:3000");
    expect(activeRelayUrl.value).toBe("ws://acme.localhost:3000");
  });

  it("persists the recent-community list on this device, but the SELECTED community only for this session", () => {
    addCommunity("ws://acme.localhost:3000");
    setActiveRelay("ws://acme.localhost:3000");
    expect(JSON.parse(localStorage.getItem("swf_relay_communities.v1") as string)).toHaveLength(1);
    // A session routing choice: survives a reload (sessionStorage), never an app restart.
    expect(localStorage.getItem("swf_active_relay.v1")).toBeNull();
    expect(JSON.parse(sessionStorage.getItem("swf_active_relay.v1") as string)).toBe("ws://acme.localhost:3000");
  });

  it("stores only addresses — no keys, roles or membership claims", () => {
    addCommunity("ws://acme.localhost:3000");
    const stored = localStorage.getItem("swf_relay_communities.v1") as string;
    expect(Object.keys(JSON.parse(stored)[0]).sort()).toEqual(["addedAt", "name", "relayUrl"]);
  });

  it("derives host and http base from a ws url", () => {
    expect(relayHost("ws://localhost:3000")).toBe("localhost:3000");
    expect(relayHttpBase("ws://localhost:3000")).toBe("http://localhost:3000");
    expect(relayHttpBase("wss://acme.example.com/")).toBe("https://acme.example.com");
    expect(relayHost("not a url")).toBe("not a url");
  });
});
