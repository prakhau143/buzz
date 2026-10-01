/**
 * Community isolation: A → B → A with the same identity.
 *
 * Switching community is not sign-out, but everything the relay answered is
 * per tenant. Every community-scoped cache key carries the community, so what B
 * shows can never be A's cached answer — channels, members, messages, DMs,
 * roles, inbox, search. Returning to A reads A's own scope, never B's.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient } from "@tanstack/vue-query";
import { queryKeys } from "@/app/providers/queryKeys";
import { clearCommunitiesForTests, setActiveRelay } from "@/features/communities/relayCommunities";
import { useSessionStore } from "@/stores/session";

const A = "wss://community-a.example";
const B = "wss://community-b.example";
const ME = "a".repeat(64);

/** Every key a community switch must not carry across. */
const perCommunity = () => [
  queryKeys.channels(),
  queryKeys.channelMessages("chan-1"),
  queryKeys.dmList(),
  queryKeys.relayMembers(),
  queryKeys.members("chan-1"),
  queryKeys.inbox("raw:mentions"),
  queryKeys.messageSearch("deploy"),
  queryKeys.thread("root-1"),
  queryKeys.presence(),
];

beforeEach(() => {
  setActivePinia(createPinia());
  clearCommunitiesForTests();
  useSessionStore().$patch({ pubkey: ME });
});

describe("community isolation (same identity, A → B → A)", () => {
  it("B sees none of A's cached answers, under any community-scoped key", () => {
    const cache = new QueryClient();
    setActiveRelay(A);
    for (const key of perCommunity()) cache.setQueryData(key, [`A:${key.join("/")}`]);

    setActiveRelay(B);
    for (const key of perCommunity()) {
      expect(cache.getQueryData(key), key.join("/")).toBeUndefined();
    }
  });

  it("back to A reads A's own scope — never B's", () => {
    const cache = new QueryClient();
    setActiveRelay(A);
    cache.setQueryData(queryKeys.channels(), ["a-general"]);
    setActiveRelay(B);
    cache.setQueryData(queryKeys.channels(), ["b-general"]);

    setActiveRelay(A);
    expect(cache.getQueryData(queryKeys.channels())).toEqual(["a-general"]);
    setActiveRelay(B);
    expect(cache.getQueryData(queryKeys.channels())).toEqual(["b-general"]);
  });

  it("every community-scoped key names its community", () => {
    setActiveRelay(A);
    for (const key of perCommunity()) {
      expect(key.slice(0, 4), key.join("/")).toEqual(["identity", ME, "community", A]);
    }
  });
});
