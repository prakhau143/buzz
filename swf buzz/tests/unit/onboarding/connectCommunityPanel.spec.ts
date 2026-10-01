/**
 * "Connect existing community": a typed relay address goes through the SAME
 * pipeline as a `swfbuzz://connect` link — address book + `switchCommunity`
 * (NIP-42 with the active identity, relay membership, role). The panel itself
 * grants nothing: a relay refusal is shown and the new address is dropped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { h, ref } from "vue";
import ConnectCommunityPanel from "@/features/onboarding/ui/ConnectCommunityPanel.vue";
import { useConnectionStore } from "@/stores/connection";
import { addCommunity, clearCommunitiesForTests, communities } from "@/features/communities/relayCommunities";

let router: Router;
let onSwitch: (relay: string) => Promise<void>;
const switchCommunity = vi.fn((relay: string) => onSwitch(relay));
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ switchCommunity, isLoading: ref(false), error: ref(null) }),
}));

const RELAY = "wss://buzz.lmdconsulting.com";

async function mountOnWelcome() {
  const page = { render: () => h("div") };
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/welcome", name: "welcome", component: page },
      { path: "/c", name: "community-channels", component: page },
    ],
  });
  await router.push("/welcome");
  return mount(ConnectCommunityPanel, { global: { plugins: [router] } });
}

async function submit(wrapper: Awaited<ReturnType<typeof mountOnWelcome>>, value: string) {
  await wrapper.find("[data-testid=connect-relay-input]").setValue(value);
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
  clearCommunitiesForTests();
  switchCommunity.mockClear();
});

describe("ConnectCommunityPanel", () => {
  it("accepts only a plain wss:// address (ws:// only for loopback)", async () => {
    const wrapper = await mountOnWelcome();
    const button = () => wrapper.find("[data-testid=connect-submit]");
    for (const bad of ["https://buzz.lmdconsulting.com", "ws://buzz.lmdconsulting.com", "wss://host/path", "wss://host?x=1", "npub1abc"]) {
      await wrapper.find("[data-testid=connect-relay-input]").setValue(bad);
      expect(button().attributes("disabled"), bad).toBeDefined();
      expect(wrapper.find("[data-testid=connect-relay-invalid]").exists(), bad).toBe(true);
    }
    for (const good of [RELAY, `${RELAY}/`, "  wss://buzz.lmdconsulting.com  ", "ws://localhost:3000"]) {
      await wrapper.find("[data-testid=connect-relay-input]").setValue(good);
      expect(button().attributes("disabled"), good).toBeUndefined();
    }
  });

  it("member: saves the address and signs in through switchCommunity", async () => {
    onSwitch = async () => void (await router.push({ name: "community-channels" }));
    const wrapper = await mountOnWelcome();
    await submit(wrapper, `${RELAY}/`);
    expect(switchCommunity).toHaveBeenCalledWith(RELAY);
    expect(communities.value.map((c) => c.relayUrl)).toEqual([RELAY]);
    expect(wrapper.emitted("connected")).toEqual([[RELAY]]);
  });

  it("non-member: shows the relay's verdict, never grants anything, drops the new address", async () => {
    onSwitch = async () => useConnectionStore().setAuthDenial("not_member");
    const wrapper = await mountOnWelcome();
    await submit(wrapper, RELAY);
    expect(wrapper.find("[data-testid=connect-problem]").text()).toBe("You're not a member of this community");
    expect(communities.value).toEqual([]);
    expect(wrapper.emitted("connected")).toBeUndefined();
  });

  it("a refusal never removes an address that was already in the address book", async () => {
    addCommunity(RELAY, "LMD");
    onSwitch = async () => useConnectionStore().setAuthDenial("banned");
    const wrapper = await mountOnWelcome();
    await submit(wrapper, RELAY);
    expect(wrapper.find("[data-testid=connect-problem]").text()).toBe("This community has blocked your identity");
    expect(communities.value.map((c) => c.name)).toEqual(["LMD"]);
  });
});
