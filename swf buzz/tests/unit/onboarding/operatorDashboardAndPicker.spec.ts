import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { h, ref } from "vue";
import OperatorDashboardView from "@/views/OperatorDashboardView.vue";
import CommunityPickerView from "@/views/CommunityPickerView.vue";
import { useAccessStore } from "@/stores/access";
import { useSessionStore } from "@/stores/session";
import { clearPendingLink, setPendingLink } from "@/features/deeplink/pendingLink";
import { addCommunity, clearCommunitiesForTests, communities } from "@/features/communities/relayCommunities";
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
  invoke: async () => {
    throw new Error("no Tauri command is expected here");
  },
  isTauri: () => true,
}));

const switchCommunity = vi.fn();
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ switchCommunity, isLoading: ref(false), error: ref<string | null>(null) }),
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
      { path: "/operator", name: "operator", component: page },
      { path: "/communities", name: "communities", component: page },
      { path: "/channels", name: "channels", component: page },
    ],
  });
}

interface RelayOptions {
  operator: boolean;
  /** Communities the operator owns, as the relay would list them. */
  owned?: string[];
  /** Hosts whose `/query` says "member" for this identity. */
  memberOf?: string[];
  listStatus?: number;
}

/** A relay that answers the operator probe, the owned-list, creation, invite minting and membership probes. */
function relay(opts: RelayOptions) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body as string | undefined });
      const notOperator = json({ error: "actor not authorized: not a relay operator" }, 403);

      if (url.includes("/operator/communities/availability")) {
        return opts.operator ? json({ available: true, normalized_host: "operator-probe.invalid" }) : notOperator;
      }
      if (url.includes("/operator/communities?owner_pubkey=")) {
        if (!opts.operator) return notOperator;
        if (opts.listStatus) return json({ error: "boom" }, opts.listStatus);
        return json({
          owner_pubkey: PK,
          communities: (opts.owned ?? []).map((host, i) => ({ community_id: `c-${i}`, host, created_at: 1, archived_at: null })),
        });
      }
      if (url.endsWith("/operator/communities") && method === "POST") {
        if (!opts.operator) return notOperator;
        const body = JSON.parse(init?.body as string);
        return json({ community_id: "c-new", host: body.host, owner_pubkey: body.initial_owner_pubkey, status: "created" });
      }
      if (url.endsWith("/api/invites") && method === "POST") {
        return json({ code: CODE, expires_at: 1_900_000_000, max_uses: null, uses_remaining: null, url: `http://x/invite/${CODE}` });
      }
      if (url.endsWith("/query") && method === "POST") {
        const host = new URL(url).host;
        return (opts.memberOf ?? []).includes(host)
          ? json([{ id: "r".repeat(64), pubkey: "0".repeat(64), kind: 13534, created_at: 1, content: "", sig: "s", tags: [["member", PK, "member"]] }])
          : json({ error: "restricted" }, 403);
      }
      return json({ error: "unexpected " + url }, 500);
    }),
  );
  return calls;
}

async function mountView(component: typeof OperatorDashboardView | typeof CommunityPickerView) {
  const router = makeRouter();
  await router.push("/operator");
  const wrapper = mount(component, { global: { plugins: [router] }, attachTo: document.body });
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

describe("Operator dashboard", () => {
  it("only for an operator: the relay's answer is asked again on arrival, and a refusal goes back to sign-in", async () => {
    relay({ operator: false });
    const { router } = await mountView(OperatorDashboardView);
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("OPERATOR AUTHORITY comes from the relay, not from state: a forged store flag does not open the dashboard", async () => {
    useAccessStore().$patch({ isOperator: true }); // what a tampered/stale Pinia state would say
    relay({ operator: false }); // the relay says no
    const { router } = await mountView(OperatorDashboardView);
    expect(router.currentRoute.value.name).toBe("login");
  });

  it("OPERATOR AUTHORITY is asked of the relay with a signed request to /operator/* (NIP-98), every time it arrives", async () => {
    const calls = relay({ operator: true });
    await mountView(OperatorDashboardView);
    const probe = calls.find((c) => c.url.includes("/operator/communities/availability"));
    expect(probe?.url.startsWith("http://localhost:3000/operator/")).toBe(true);
    expect(probe?.method).toBe("GET");
  });

  it("is called 'Operator Dashboard' and shows deployment-level scope — never 'Super Admin'", async () => {
    relay({ operator: true });
    const { wrapper } = await mountView(OperatorDashboardView);
    expect(wrapper.find("h1").text()).toBe("Operator Dashboard");
    expect(wrapper.find("[data-testid=operator-identity]").text()).toContain("Signed in as");
    expect(wrapper.find("[data-testid=operator-scope]").text()).toContain("does not make you a member or owner");
    expect(wrapper.text()).not.toMatch(/super[ _-]?admin/i);
  });

  it("OPERATOR ≠ OWNER: an operator who owns and belongs to nothing sees no communities (no implicit membership)", async () => {
    relay({ operator: true, owned: [], memberOf: [] });
    const { wrapper } = await mountView(OperatorDashboardView);
    expect(wrapper.find("[data-testid=operator-communities]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=operator-empty]").exists()).toBe(true);
  });

  it("NO COMMUNITIES: 'You don't have any communities yet.' and 'Create your first community' (+ Join with invite)", async () => {
    relay({ operator: true });
    const { wrapper } = await mountView(OperatorDashboardView);

    expect(wrapper.text()).toContain("Operator Dashboard");
    expect(wrapper.find("[data-testid=operator-empty]").text()).toBe("You don't have any communities yet.");
    expect(wrapper.find("[data-testid=operator-create-community]").text()).toBe("Create your first community");
    expect(wrapper.find("[data-testid=operator-join-toggle]").text()).toBe("Join with invite");
  });

  it("lists the communities they OWN (relay's list) and belong to (membership probes), one row each, and opens one", async () => {
    addCommunity("ws://team.localhost:3000", "Team");
    relay({ operator: true, owned: ["swf.localhost:3000", "team.localhost:3000"], memberOf: ["team.localhost:3000"] });
    const { wrapper } = await mountView(OperatorDashboardView);

    const names = wrapper.findAll("[data-testid=operator-community-name]").map((n) => n.text());
    expect(names).toEqual(["swf.localhost:3000", "Team"]); // deduped: team is owned AND a membership
    expect(wrapper.find("[data-testid=operator-create-community]").text()).toBe("Create Community");

    await wrapper.findAll("[data-testid=operator-open]")[1].trigger("click");
    expect(switchCommunity).toHaveBeenCalledWith("ws://team.localhost:3000");
  });

  it("the owned-list request is an operator request for MY key — signed, to the configured relay", async () => {
    const calls = relay({ operator: true });
    await mountView(OperatorDashboardView);
    const list = calls.find((c) => c.url.includes("/operator/communities?owner_pubkey="));
    expect(list?.url).toBe(`http://localhost:3000/operator/communities?owner_pubkey=${PK}`);
    expect(list?.method).toBe("GET");
  });

  it("a failing list shows an error but the dashboard still works (Create remains)", async () => {
    relay({ operator: true, listStatus: 500 });
    const { wrapper } = await mountView(OperatorDashboardView);
    expect(wrapper.find("[data-testid=operator-load-error]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=operator-create-community]").exists()).toBe(true);
  });

  it("no identity → sign-in; a waiting invite link → the join screen", async () => {
    relay({ operator: true });
    identityPubkey = null;
    expect((await mountView(OperatorDashboardView)).router.currentRoute.value.name).toBe("login");

    identityPubkey = PK;
    setPendingLink({ kind: "join", relay: "ws://localhost:3000", code: CODE });
    expect((await mountView(OperatorDashboardView)).router.currentRoute.value.name).toBe("join");
  });

  describe("Create Community (after authentication)", () => {
    async function openDialog(calls: ReturnType<typeof relay>) {
      const { wrapper } = await mountView(OperatorDashboardView);
      await wrapper.find("[data-testid=operator-create-community]").trigger("click");
      await settle();
      return { wrapper, calls, dialog: wrapper.findComponent({ name: "CreateCommunityDialog" }) };
    }

    it("the address follows the name until it is edited", async () => {
      const { dialog } = await openDialog(relay({ operator: true }));
      const host = () => (dialog.find("[data-testid=community-host]").element as HTMLInputElement).value;

      await dialog.find("[data-testid=community-name]").setValue("SWF Developers");
      expect(host()).toBe("swf-developers.localhost:3000");
      await dialog.find("[data-testid=community-host]").setValue("custom.example.com");
      await dialog.find("[data-testid=community-name]").setValue("Renamed");
      expect(host()).toBe("custom.example.com");
    });

    it("creates it with the signed-in identity as OWNER, shows the owner, and can then invite members", async () => {
      const { dialog, calls } = await openDialog(relay({ operator: true }));

      await dialog.find("[data-testid=community-name]").setValue("SWF Developers");
      expect((dialog.find("[data-testid=community-owner]").element as HTMLInputElement).value).toBe(PK); // defaults to me
      await dialog.find("[data-testid=community-create]").trigger("click");
      await settle();

      const create = calls.find((c) => c.url.endsWith("/operator/communities") && c.method === "POST");
      expect(JSON.parse(create!.body as string)).toEqual({
        host: "swf-developers.localhost:3000",
        initial_owner_pubkey: PK,
        create_only: true,
      });
      expect(dialog.find("[data-testid=community-created]").text()).toContain("SWF Developers");
      expect(dialog.find("[data-testid=community-owner-line]").text()).toContain("your identity");
      expect(communities.value.map((c) => [c.relayUrl, c.name])).toEqual([["ws://swf-developers.localhost:3000", "SWF Developers"]]);

      await dialog.find("[data-testid=community-invite-members]").trigger("click");
      await dialog.find("[data-testid=invite-create]").trigger("click");
      await settle();
      const link = dialog.find("[data-testid=invite-link]").text();
      expect(link.startsWith(`swfbuzz://join/${CODE}?relay=ws%3A%2F%2Fswf-developers.localhost%3A3000`)).toBe(true);
      expect(link).toContain("name=SWF+Developers");
      expect(link).toContain(`by=${PK}`);
      expect(link.startsWith("buzz://")).toBe(false);
    });

    it("says outright that an operator is not automatically a member or owner of the new community", async () => {
      const { dialog } = await openDialog(relay({ operator: true }));
      expect(dialog.find("[data-testid=owner-hint]").text()).toContain("not automatically a member or owner");
    });

    it("OPERATOR ≠ OWNER: a community created for someone else does not appear as the operator's (not owned, not a member)", async () => {
      const calls = relay({ operator: true, owned: [], memberOf: [] });
      const { wrapper, dialog } = await openDialog(calls);
      const OWNER = "cd".repeat(32);
      await dialog.find("[data-testid=community-name]").setValue("Rahul HQ");
      await dialog.find("[data-testid=community-owner]").setValue(OWNER);
      await dialog.find("[data-testid=community-create]").trigger("click");
      await settle();

      const create = calls.find((c) => c.url.endsWith("/operator/communities") && c.method === "POST");
      expect(JSON.parse(create!.body as string)).toEqual({
        host: "rahul-hq.localhost:3000",
        initial_owner_pubkey: OWNER, // the named owner — not the operator
        create_only: true,
      });
      // Close controls are the shared CloseButton component app-wide (no
      // hand-rolled glyph buttons — see tests/unit/components/closeButton.spec.ts).
      await wrapper
        .findComponent({ name: "CreateCommunityDialog" })
        .find("[data-testid=close-button]")
        .trigger("click");
      await settle();
      // the relay lists no community owned by, or joined by, this operator identity
      expect(wrapper.find("[data-testid=operator-communities]").exists()).toBe(false);
    });

    it("naming ANOTHER person as owner stores their key as owner and signs nobody in as them", async () => {
      const { dialog, calls } = await openDialog(relay({ operator: true }));
      const OWNER = "ab".repeat(32);

      await dialog.find("[data-testid=community-name]").setValue("Rahul HQ");
      await dialog.find("[data-testid=community-owner]").setValue(OWNER);
      await dialog.find("[data-testid=community-create]").trigger("click");
      await settle();

      const create = calls.find((c) => c.url.endsWith("/operator/communities") && c.method === "POST");
      expect(JSON.parse(create!.body as string).initial_owner_pubkey).toBe(OWNER);
      expect(dialog.find("[data-testid=community-owner-line]").text()).toContain("the identity you named");
      expect(dialog.find("[data-testid=connect-link]").text().startsWith("swfbuzz://connect?relay=")).toBe(true);
      expect(dialog.find("[data-testid=community-open]").exists()).toBe(false);
      expect(communities.value).toHaveLength(0);
      expect(switchCommunity).not.toHaveBeenCalled();
    });

    it("if the relay refuses, nothing is created and the reason is shown", async () => {
      const { dialog } = await openDialog(relay({ operator: true }));
      relay({ operator: false }); // the relay changes its mind
      await dialog.find("[data-testid=community-name]").setValue("Nope");
      await dialog.find("[data-testid=community-create]").trigger("click");
      await settle();
      expect(dialog.find("[data-testid=community-error]").exists()).toBe(true);
      expect(dialog.find("[data-testid=community-created]").exists()).toBe(false);
      expect(communities.value).toHaveLength(0);
    });
  });
});

describe("Community picker — the identity's actual memberships, not a URL selector", () => {
  const ACME = "ws://acme.localhost:3000";
  const TEAM = "ws://team.localhost:3000";

  function twoMemberships() {
    addCommunity(ACME, "Acme HQ");
    addCommunity(TEAM, "Team");
    relay({ operator: false, memberOf: ["acme.localhost:3000", "team.localhost:3000"] });
  }

  it("'Where would you like to work?': the relay-confirmed recent communities, plus one community URL field", async () => {
    twoMemberships();
    const { wrapper } = await mountView(CommunityPickerView);

    expect(wrapper.text()).toContain("Where would you like to work?");
    expect(wrapper.text()).toContain("Identity verified");
    expect(wrapper.findAll("[data-testid=picker-name]").map((n) => n.text()).sort()).toEqual(["Acme HQ", "Team"]);
    expect(wrapper.find("select").exists()).toBe(false);
    // The only text field is the community URL — never a public key.
    const inputs = wrapper.findAll("input[type=text],input[type=url]");
    expect(inputs.map((i) => i.attributes("data-testid"))).toEqual(["picker-url-input"]);
    expect(inputs[0].attributes("placeholder")).toMatch(/^wss:\/\//);
  });

  it("choosing one opens it", async () => {
    twoMemberships();
    const { wrapper } = await mountView(CommunityPickerView);
    const acme = wrapper.findAll("[data-testid=picker-item]").find((b) => b.text().includes("Acme HQ"));
    await acme!.trigger("click");
    expect(switchCommunity).toHaveBeenCalledWith(ACME);
  });

  it("a community that removed this identity does not appear (memberships are re-asked on arrival)", async () => {
    addCommunity(ACME, "Acme HQ");
    addCommunity(TEAM, "Team");
    addCommunity("ws://third.localhost:3000", "Third");
    relay({ operator: false, memberOf: ["acme.localhost:3000", "third.localhost:3000"] }); // Team says no
    const { wrapper } = await mountView(CommunityPickerView);
    expect(wrapper.findAll("[data-testid=picker-name]").map((n) => n.text()).sort()).toEqual(["Acme HQ", "Third"]);
  });

  it("says when some communities could not be reached", async () => {
    addCommunity(ACME, "Acme HQ");
    addCommunity(TEAM, "Team");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("http://team.")) throw new TypeError("Failed to fetch");
        return json([{ id: "r".repeat(64), pubkey: "0".repeat(64), kind: 13534, created_at: 1, content: "", sig: "s", tags: [["member", PK, "member"]] }]);
      }),
    );
    const { wrapper } = await mountView(CommunityPickerView);
    expect(wrapper.find("[data-testid=picker-unreachable]").text()).toContain("couldn't be reached");
  });

  it("no memberships left after re-asking → welcome; no identity → sign-in", async () => {
    relay({ operator: false, memberOf: [] });
    expect((await mountView(CommunityPickerView)).router.currentRoute.value.name).toBe("welcome");

    identityPubkey = null;
    expect((await mountView(CommunityPickerView)).router.currentRoute.value.name).toBe("login");
  });

  it("'Join with invite' is available from the picker", async () => {
    twoMemberships();
    const { wrapper } = await mountView(CommunityPickerView);
    await wrapper.find("[data-testid=picker-join-toggle]").trigger("click");
    expect(wrapper.find("[data-testid=invite-input]").exists()).toBe(true);
    expect(useAccessStore().memberships.length).toBe(2);
  });
});
