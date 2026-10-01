import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import WelcomeView from "@/views/WelcomeView.vue";
import { useSessionStore } from "@/stores/session";
import { clearPendingLink, setPendingLink } from "@/features/deeplink/pendingLink";
import { clearCommunitiesForTests } from "@/features/communities/relayCommunities";
import { installFakeSigner, json, removeFakeSigner } from "../helpers/fakeSigner";

/** Flush promises, allow real timers/IO in the async chains to run, flush again. */
const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await flushPromises();
};

const PK = "5".repeat(64);
const CODE = "v2." + "C".repeat(43);
let identityPubkey: string | null = PK;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    if (command === "get_identity") {
      return { pubkey: "5".repeat(64), npub: "npub1example", storage: "system-keyring", recovery: "none" };
    }
    throw new Error("unexpected Tauri command: " + command);
  },
  isTauri: () => true,
}));

const switchCommunity = vi.fn();
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ switchCommunity }),
  ensureLocalSigner: async () => identityPubkey,
}));

function makeRouter() {
  const page = { render: () => h("div") };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", name: "login", component: page },
      { path: "/join", name: "join", component: page },
      { path: "/welcome", name: "welcome", component: page },
      { path: "/channels", name: "channels", component: page },
    ],
  });
}

async function mountWelcome() {
  const router = makeRouter();
  await router.push("/welcome");
  const wrapper = mount(WelcomeView, { global: { plugins: [router] }, attachTo: document.body });
  await settle();
  return { wrapper, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
  identityPubkey = PK;
  switchCommunity.mockReset();
  localStorage.clear();
  clearCommunitiesForTests();
  clearPendingLink();
  installFakeSigner(PK);
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: PK });
});
afterEach(() => removeFakeSigner());

describe("WelcomeView — signed in, member of no community, not an operator", () => {
  it("says so and offers 'Join with invite' — and nothing that creates a community", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = await mountWelcome();

    expect(wrapper.text()).toContain("Welcome to SWF Buzz");
    expect(wrapper.find("[data-testid=welcome-lead]").text()).toBe("You don't have any communities yet.");
    expect(wrapper.find("[data-testid=welcome-join-toggle]").text()).toBe("Join with invite");
    expect(wrapper.text()).not.toMatch(/create (your first )?community/i);
    expect(wrapper.text()).not.toMatch(/super[ _-]?admin/i);
    expect(fetchMock).not.toHaveBeenCalled(); // this screen asks the relay nothing
  });

  it("points at the public-key route: send your public key to an owner", async () => {
    const { wrapper } = await mountWelcome();
    expect(wrapper.text()).toContain("send them your public key");
    await wrapper.find("[data-testid=welcome-my-identity]").trigger("click");
    await settle();
    expect(document.body.textContent).toContain("Copy Public Key");
  });

  it("NO IDENTITY on the device: nothing to show — goes to sign-in", async () => {
    identityPubkey = null;
    const { router } = await mountWelcome();
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("an invite link that arrived meanwhile takes precedence: goes to the join screen", async () => {
    setPendingLink({ kind: "join", relay: "ws://localhost:3000", code: CODE });
    const { router } = await mountWelcome();
    expect(router.currentRoute.value.name).toBe("join");
  });

  it("JOIN WITH INVITE: reveals the paste box; a valid link is claimed and that community is opened", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return json({ status: "joined", community_id: "c-9", host: "acme.localhost:3000", role: "member" });
      }),
    );
    const { wrapper } = await mountWelcome();

    expect(wrapper.find("[data-testid=invite-input]").exists()).toBe(false);
    await wrapper.find("[data-testid=welcome-join-toggle]").trigger("click");
    await wrapper
      .find("[data-testid=invite-input]")
      .setValue(`swfbuzz://join/${CODE}?relay=ws%3A%2F%2Facme.localhost%3A3000`);
    // The invite paste box's own form — the community URL form is on the page too.
    const inviteForm = wrapper.findAll("form").find((f) => f.find("[data-testid=invite-input]").exists());
    await inviteForm!.trigger("submit");
    await settle();

    expect(calls).toContain("http://acme.localhost:3000/api/invites/claim");
    expect(switchCommunity).toHaveBeenCalledWith("ws://acme.localhost:3000");
  });

  it("shows the community URL field up front, and never a field that takes a public key", async () => {
    const { wrapper } = await mountWelcome();
    expect(wrapper.find("[data-testid=connect-relay-input]").exists()).toBe(true);
    await wrapper.find("[data-testid=welcome-join-toggle]").trigger("click");
    for (const input of wrapper.findAll("input")) {
      const described = `${input.attributes("placeholder") ?? ""} ${input.attributes("aria-label") ?? ""}`;
      expect(described).not.toMatch(/npub|public key|hex/i);
    }
    expect(wrapper.text()).not.toMatch(/enter (your|the|a) public key/i);
  });
});
