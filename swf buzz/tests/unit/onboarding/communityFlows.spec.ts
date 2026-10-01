import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { h } from "vue";
import JoinCommunityView from "@/views/JoinCommunityView.vue";
import CreateRelayInvitePanel from "@/features/communities/ui/CreateRelayInvitePanel.vue";
import CreateCommunityDialog from "@/features/communities/ui/CreateCommunityDialog.vue";
import ProfileSetupView from "@/views/ProfileSetupView.vue";
import { useSessionStore } from "@/stores/session";
import { useConnectionStore } from "@/stores/connection";
import { clearPendingLink, pendingLink, setPendingLink } from "@/features/deeplink/pendingLink";
import { clearCommunitiesForTests, communities } from "@/features/communities/relayCommunities";
import { relayInviteService, InviteError } from "@/features/communities/RelayInviteService";
import { operatorService, OperatorError } from "@/features/communities/OperatorService";
import { installFakeSigner, json, removeFakeSigner } from "../helpers/fakeSigner";

/** Flush promises, allow real timers/IO in the async claim chain to run, flush again. */
const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await flushPromises();
};

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => true,
}));

const switchCommunity = vi.fn();
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({
    switchCommunity,
    // the real one signs the old identity out and calls Rust; here only the Rust call matters
    replaceIdentityLocal: async (input: string, password?: string) => {
      const { replaceIdentity } = await import("@/features/identity/identityApi");
      await replaceIdentity(input, password);
      return true;
    },
  }),
  ensureLocalSigner: async () => "5".repeat(64),
}));

const publishProfile = vi.fn();
vi.mock("@/features/profile/identityProfile", () => ({
  hasIdentityProfileAnywhere: vi.fn(async () => true),
  rememberProfileEvent: vi.fn(),
  replicateProfileToKnownCommunities: vi.fn(async () => undefined),
}));
vi.mock("@/services/ProfileService", () => ({
  profileService: { publishProfile: (...a: unknown[]) => publishProfile(...a) },
}));

const PK = "5".repeat(64);
const RELAY = "ws://localhost:3000";
const CODE = "v2." + "C".repeat(43);
const IDENTITY = { pubkey: PK, npub: "npub1x", storage: "system-keyring", recovery: "none" };
const NONE = { pubkey: null, npub: null, storage: "none", recovery: "none" };

function router() {
  const page = { render: () => h("div") };
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", name: "login", component: page },
      { path: "/join", name: "join", component: page },
      { path: "/channels", name: "channels", component: page },
    ],
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "get_identity") return IDENTITY;
    throw new Error(`unexpected Tauri command: ${command}`);
  });
  switchCommunity.mockReset();
  publishProfile.mockReset();
  localStorage.clear();
  clearCommunitiesForTests();
  clearPendingLink();
  installFakeSigner(PK);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountJoin() {
  const r = router();
  await r.push("/join");
  const wrapper = mount(JoinCommunityView, { global: { plugins: [r] } });
  await settle();
  return { wrapper, r };
}

afterEach(() => removeFakeSigner());

describe("JoinCommunityView — deep-link landing", () => {
  it("VALID invite: shows where it points, does nothing until confirmed, then claims and signs in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ status: "joined", community_id: "c-1", host: "localhost:3000", role: "member" })),
    );
    setPendingLink({ kind: "join", relay: RELAY, code: CODE, policyReceipt: null });
    const { wrapper } = await mountJoin();

    expect(wrapper.find("[data-testid=join-target]").text()).toBe("localhost:3000");
    expect(fetch).not.toHaveBeenCalled(); // the link alone triggers nothing
    expect(switchCommunity).not.toHaveBeenCalled();

    await wrapper.find("[data-testid=accept-join]").trigger("click");
    await settle();

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://localhost:3000/api/invites/claim");
    expect(switchCommunity).toHaveBeenCalledWith(RELAY); // NIP-42 sign-in follows the claim
    expect(communities.value.map((c) => c.relayUrl)).toEqual([RELAY]);
    expect(pendingLink.value).toBeNull();
  });

  it("ALREADY CLAIMED: already_member still proceeds into the community (idempotent)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ status: "already_member", community_id: "c-1", host: "localhost:3000", role: "member" })),
    );
    setPendingLink({ kind: "join", relay: RELAY, code: CODE });
    const { wrapper } = await mountJoin();
    await wrapper.find("[data-testid=accept-join]").trigger("click");
    await settle();
    expect(switchCommunity).toHaveBeenCalledWith(RELAY);
    expect(wrapper.find("[data-testid=join-error]").exists()).toBe(false);
  });

  it.each([
    ["invite_invalid", "isn't valid"],
    ["invite_expired", "expired"],
    ["invite_exhausted", "use limit"],
  ])("%s: a clear error, no sign-in, and the link is kept so the user can retry or go back", async (relayError, phrase) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: relayError }, 403)));
    setPendingLink({ kind: "join", relay: RELAY, code: CODE });
    const { wrapper } = await mountJoin();

    await wrapper.find("[data-testid=accept-join]").trigger("click");
    await settle();

    expect(wrapper.find("[data-testid=join-error]").text()).toContain(phrase);
    expect(switchCommunity).not.toHaveBeenCalled();
    expect(communities.value).toHaveLength(0);
    expect(pendingLink.value).not.toBeNull();
  });

  it("CONNECT refused as NOT A MEMBER: says so and offers the invite box instead of a dead end", async () => {
    switchCommunity.mockImplementation(async () => {
      useConnectionStore().setAuthDenial("not_member");
    });
    setPendingLink({ kind: "connect", relay: "ws://acme.localhost:3000" });
    const { wrapper } = await mountJoin();

    await wrapper.find("[data-testid=accept-connect]").trigger("click");
    await settle();

    expect(wrapper.find("[data-testid=signin-error]").text()).toContain("not a member");
    expect(wrapper.find("[data-testid=invite-input]").exists()).toBe(true);
  });

  it("a NEW link replaces the previous attempt's messages (an old 'expired' is not the answer for the new link)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invite_expired" }, 403)));
    setPendingLink({ kind: "join", relay: RELAY, code: CODE });
    const { wrapper } = await mountJoin();
    await wrapper.find("[data-testid=accept-join]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=join-error]").text()).toContain("expired");

    setPendingLink({ kind: "join", relay: RELAY, code: "v2." + "E".repeat(43) });
    await settle();
    expect(wrapper.find("[data-testid=join-error]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=accept-join]").exists()).toBe(true);
  });

  it("INVALID link (malformed): shows Rust's reason and offers no action", async () => {
    setPendingLink({ kind: "invalid", reason: "Invalid link: the invite code is malformed." });
    const { wrapper } = await mountJoin();
    expect(wrapper.find("[data-testid=link-invalid]").text()).toContain("malformed");
    expect(wrapper.find("[data-testid=accept-join]").exists()).toBe(false);
    expect(switchCommunity).not.toHaveBeenCalled();
  });

  it("CONNECT link (e.g. a community owner): adds the community and signs in — the relay decides the role", async () => {
    setPendingLink({ kind: "connect", relay: "ws://acme.localhost:3000" });
    const { wrapper } = await mountJoin();
    expect(wrapper.find("[data-testid=connect-name]").text()).toBe("acme.localhost:3000");

    await wrapper.find("[data-testid=accept-connect]").trigger("click");
    await settle();

    expect(switchCommunity).toHaveBeenCalledWith("ws://acme.localhost:3000");
    expect(communities.value.map((c) => c.relayUrl)).toEqual(["ws://acme.localhost:3000"]);
  });

  it("NO IDENTITY: offers identity setup first — cannot claim or connect without a key", async () => {
    invokeMock.mockImplementation(async () => NONE);
    setPendingLink({ kind: "join", relay: RELAY, code: CODE });
    const { wrapper } = await mountJoin();

    expect(wrapper.find("[data-testid=create-identity]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=accept-join]").exists()).toBe(false);
    expect(wrapper.text()).toContain("you need an identity");
    expect(wrapper.find("[data-testid=show-import]").exists()).toBe(true);
    // the invite preview is still shown, so the person knows what they are joining
    expect(wrapper.find("[data-testid=invite-preview]").exists()).toBe(true);
  });

  it("INVITE PREVIEW: community name, server, and inviter are shown — and labelled as coming from the link", async () => {
    const by = "ab".repeat(32);
    setPendingLink({ kind: "join", relay: "ws://swf.localhost:3000", code: CODE, communityName: "SWF Developers", invitedBy: by });
    const { wrapper } = await mountJoin();

    expect(wrapper.text()).toContain("You've been invited to join:");
    expect(wrapper.find("[data-testid=join-name]").text()).toBe("SWF Developers");
    expect(wrapper.find("[data-testid=join-target]").text()).toBe("swf.localhost:3000");
    expect(wrapper.text()).toContain("isn't verified");
    expect(wrapper.find("[data-testid=join-inviter]").text()).toMatch(/^Invited by npub1[a-z0-9]+…[a-z0-9]+ [(]from the link, not verified[)]$/);
    expect(wrapper.find("[data-testid=accept-join]").text()).toBe("Join Community");
  });

  it("INVITE PREVIEW without a name falls back to the server address (the part the relay stands behind)", async () => {
    setPendingLink({ kind: "join", relay: RELAY, code: CODE });
    const { wrapper } = await mountJoin();
    expect(wrapper.find("[data-testid=join-name]").text()).toBe("localhost:3000");
    expect(wrapper.find("[data-testid=join-inviter]").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("isn't verified");
  });

  it("IDENTITY FOUND: names it, offers Join Community and 'Import existing identity' — never asks for a public key", async () => {
    setPendingLink({ kind: "join", relay: RELAY, code: CODE });
    const { wrapper } = await mountJoin();
    expect(wrapper.find("[data-testid=join-as]").text()).toContain(PK.slice(0, 8));
    expect(wrapper.find("[data-testid=import-another]").exists()).toBe(true);
    expect(wrapper.findAll("input[type=text]")).toHaveLength(0);
  });

  it("IMPORT ANOTHER from an invite: replaces the identity, then the claim is signed by the chosen one", async () => {
    const OTHER = { ...IDENTITY, pubkey: "cd".repeat(32) };
    let current = IDENTITY;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_identity") return current;
      // Import is two-step: "Check key" resolves which identity the input is
      // (storing nothing) before it can be imported.
      if (command === "preview_identity_input") {
        return { pubkey: OTHER.pubkey, npub: "npub1other", looksLikeBareHex: false };
      }
      if (command === "replace_identity") {
        current = OTHER;
        return OTHER;
      }
      throw new Error(`unexpected Tauri command: ${command}`);
    });
    setPendingLink({ kind: "join", relay: RELAY, code: CODE });
    const { wrapper } = await mountJoin();

    await wrapper.find("[data-testid=import-another]").trigger("click");
    await wrapper.find("[data-testid=import-secret]").setValue("nsec1other");
    await wrapper.find("[data-testid=import-check]").trigger("click");
    await settle();
    await wrapper.find("[data-testid=import-confirm]").setValue(true);
    await wrapper.find("form").trigger("submit");
    await settle();

    expect(invokeMock).toHaveBeenCalledWith("replace_identity", { input: "nsec1other", password: null, allowRawHex: false });
    expect(wrapper.find("[data-testid=join-as]").text()).toContain("cdcdcdcd");
    expect(pendingLink.value).not.toBeNull(); // the invite is still waiting for the new identity's confirmation
  });

  it("with no link at all it is the manual 'join with invite' screen", async () => {
    const { wrapper } = await mountJoin();
    expect(wrapper.find("[data-testid=invite-input]").exists()).toBe(true);
  });

  it("'Not now' drops the link and goes back to sign-in", async () => {
    setPendingLink({ kind: "join", relay: RELAY, code: CODE });
    const { wrapper, r } = await mountJoin();
    await wrapper.findAll("button").find((b) => b.text() === "Not now")?.trigger("click");
    await settle();
    expect(pendingLink.value).toBeNull();
    expect(r.currentRoute.value.name).toBe("login");
  });
});

describe("Invite creation — who can create (authorization matrix)", () => {
  function panel(role: "owner" | "admin" | "member" | null) {
    const session = useSessionStore();
    session.setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: PK });
    session.setCommunityRole(role);
    return mount(CreateRelayInvitePanel);
  }

  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
    [null, false], // authenticated, but not a member of this community
  ] as const)("role %s → can create invites: %s", (role, allowed) => {
    const wrapper = panel(role);
    expect(wrapper.find("[data-testid=invite-create]").exists()).toBe(allowed);
    expect(wrapper.find("[data-testid=invites-not-allowed]").exists()).toBe(!allowed);
  });

  it("an owner creates an invite with the chosen expiry and max uses, and gets a swfbuzz:// link", async () => {
    const create = vi.spyOn(relayInviteService, "createInvite").mockResolvedValueOnce({
      code: CODE, expiresAt: 1_900_000_000, maxUses: 3, usesRemaining: 3,
      link: `swfbuzz://join/${CODE}?relay=${encodeURIComponent(RELAY)}`,
    });
    const wrapper = panel("owner");
    await wrapper.find("[data-testid=invite-ttl]").setValue(86_400);
    await wrapper.find("[data-testid=invite-max-uses]").setValue("3");

    await wrapper.find("[data-testid=invite-create]").trigger("click");
    await settle();

    // the inviter's public key rides along as an (unverified) hint; the name only if one is known
    expect(create).toHaveBeenCalledWith(expect.stringMatching(/^wss?:\/\//), {
      ttlSecs: 86_400,
      maxUses: 3,
      hints: { communityName: undefined, invitedBy: PK },
    });
    expect(wrapper.find("[data-testid=invite-link]").text()).toMatch(/^swfbuzz:\/\/join\/v2\./);
    expect(wrapper.find("[data-testid=invite-result]").text()).toContain("3 of 3 uses left");
  });

  it("leaving max uses empty means unlimited (nothing sent for it)", async () => {
    const create = vi.spyOn(relayInviteService, "createInvite").mockResolvedValueOnce({
      code: CODE, expiresAt: 1_900_000_000, maxUses: null, usesRemaining: null, link: "swfbuzz://join?relay=x&code=y",
    });
    const wrapper = panel("admin");
    await wrapper.find("[data-testid=invite-create]").trigger("click");
    await settle();
    expect(create.mock.calls[0][1]).toMatchObject({ maxUses: undefined });
    expect(wrapper.find("[data-testid=invite-result]").text()).toContain("unlimited uses");
  });

  it("invalid max uses disables creation and explains", async () => {
    const create = vi.spyOn(relayInviteService, "createInvite");
    const wrapper = panel("owner");
    for (const bad of ["0", "10001", "1.5", "abc", "-2"]) {
      await wrapper.find("[data-testid=invite-max-uses]").setValue(bad);
      expect(wrapper.find("[data-testid=invite-max-problem]").exists(), bad).toBe(true);
      expect(wrapper.find("[data-testid=invite-create]").attributes("disabled"), bad).toBeDefined();
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("if the RELAY refuses (the real check) the panel shows why — even if the UI let the click through", async () => {
    vi.spyOn(relayInviteService, "createInvite").mockRejectedValueOnce(
      new InviteError("forbidden", "Only a community owner or admin can create invites."),
    );
    const wrapper = panel("admin");
    await wrapper.find("[data-testid=invite-create]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=invite-error]").text()).toContain("owner or admin");
    expect(wrapper.find("[data-testid=invite-result]").exists()).toBe(false);
  });
});

describe("Create community (Operator)", () => {
  const OWNER = "a".repeat(64);
  const created = (owner: string) => ({
    communityId: "c-9",
    host: "acme.localhost:3000",
    ownerPubkey: owner,
    relayUrl: "ws://acme.localhost:3000",
    connectLink: "swfbuzz://connect?relay=ws%3A%2F%2Facme.localhost%3A3000",
  });

  function dialog() {
    const session = useSessionStore();
    session.setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: PK });
    session.setCommunityRole("owner");
    return mount(CreateCommunityDialog);
  }

  it("the owner field defaults to the signed-in identity's own public key", () => {
    const wrapper = dialog();
    expect((wrapper.find("[data-testid=community-owner]").element as HTMLInputElement).value).toBe(PK);
  });

  it("validates address and owner before enabling Create", async () => {
    const wrapper = dialog();
    expect(wrapper.find("[data-testid=community-create]").attributes("disabled")).toBeDefined(); // no host yet
    await wrapper.find("[data-testid=community-host]").setValue("not a host!");
    expect(wrapper.find("[data-testid=host-problem]").exists()).toBe(true);
    await wrapper.find("[data-testid=community-host]").setValue("acme.localhost:3000");
    expect(wrapper.find("[data-testid=community-create]").attributes("disabled")).toBeUndefined();
    await wrapper.find("[data-testid=community-owner]").setValue("nonsense");
    expect(wrapper.find("[data-testid=owner-problem]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=community-create]").attributes("disabled")).toBeDefined();
  });

  it("OWNER IS ANOTHER PERSON: their public key is stored as owner, the link is for them to sign in — nothing is signed in as them", async () => {
    const create = vi.spyOn(operatorService, "createCommunity").mockResolvedValueOnce(created(OWNER));
    const wrapper = dialog();
    await wrapper.find("[data-testid=community-host]").setValue("acme.localhost:3000");
    await wrapper.find("[data-testid=community-owner]").setValue(OWNER);

    await wrapper.find("[data-testid=community-create]").trigger("click");
    await settle();

    expect(create).toHaveBeenCalledWith(expect.any(String), { host: "acme.localhost:3000", ownerPubkey: OWNER });
    expect(wrapper.find("[data-testid=community-created]").text()).toContain("acme.localhost:3000");
    expect(wrapper.find("[data-testid=connect-link]").text()).toMatch(/^swfbuzz:\/\/connect\?/);
    expect(wrapper.text()).toContain("sign in with their own identity");
    expect(wrapper.find("[data-testid=community-open]").exists()).toBe(false); // I am not its owner
    expect(communities.value).toHaveLength(0); // not added to *my* list
    expect(switchCommunity).not.toHaveBeenCalled(); // and I did not become anyone else
  });

  it("OWNER IS ME: the community is remembered and can be opened", async () => {
    vi.spyOn(operatorService, "createCommunity").mockResolvedValueOnce(created(PK));
    const wrapper = dialog();
    await wrapper.find("[data-testid=community-host]").setValue("acme.localhost:3000");
    await wrapper.find("[data-testid=community-create]").trigger("click");
    await settle();

    expect(communities.value.map((c) => c.relayUrl)).toEqual(["ws://acme.localhost:3000"]);
    await wrapper.find("[data-testid=community-open]").trigger("click");
    await settle();
    expect(switchCommunity).toHaveBeenCalledWith("ws://acme.localhost:3000");
  });

  it("a relay refusal (not an operator) is shown, and nothing is created", async () => {
    vi.spyOn(operatorService, "createCommunity").mockRejectedValueOnce(
      new OperatorError("forbidden", "This identity isn't a community operator on this server."),
    );
    const wrapper = dialog();
    await wrapper.find("[data-testid=community-host]").setValue("acme.localhost:3000");
    await wrapper.find("[data-testid=community-create]").trigger("click");
    await settle();
    expect(wrapper.find("[data-testid=community-error]").text()).toContain("isn't a community operator");
    expect(wrapper.find("[data-testid=community-created]").exists()).toBe(false);
  });

  it("explains that a public key is an identifier, not a login", () => {
    expect(dialog().text()).toContain("does not sign anyone in");
  });
});

describe("ProfileSetupView (kind:0)", () => {
  async function mountProfile() {
    const r = router();
    await r.push("/channels");
    const session = useSessionStore();
    session.setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: PK });
    session.setCommunityRole("member");
    const wrapper = mount(ProfileSetupView, { global: { plugins: [r] } });
    return { wrapper, r };
  }

  /** A photo normally arrives from a Blossom upload; the tests set the URL directly. */
  async function fillValid(wrapper: Awaited<ReturnType<typeof mountProfile>>["wrapper"]) {
    await wrapper.find("[data-testid=profile-name]").setValue("Ada");
    await wrapper.find("[data-testid=profile-designation]").setValue("Solutions Architect");
    (wrapper.vm as unknown as { picture: string }).picture = "https://x.example/a.png";
    await wrapper.vm.$nextTick();
  }

  it("publishes name, designation and photo under the local identity, then continues", async () => {
    publishProfile.mockResolvedValueOnce(undefined);
    const { wrapper, r } = await mountProfile();
    await fillValid(wrapper);
    await wrapper.find("[data-testid=profile-about]").setValue("Analyst");

    await wrapper.find("form").trigger("submit");
    await settle();

    expect(publishProfile).toHaveBeenCalledWith({
      displayName: "Ada",
      designation: "Solutions Architect",
      about: "Analyst",
      picture: "https://x.example/a.png",
    });
    expect(r.currentRoute.value.name).toBe("channels");
  });

  /** Name and designation are required; the photo is optional. */
  it("requires name and designation, and can be saved without a photo", async () => {
    const { wrapper } = await mountProfile();
    const save = () => wrapper.find("[data-testid=profile-save]").attributes("disabled");
    expect(save()).toBeDefined();

    await wrapper.find("[data-testid=profile-name]").setValue("Ada");
    expect(save(), "a name alone is not enough").toBeDefined();

    await wrapper.find("[data-testid=profile-designation]").setValue("Solutions Architect");
    expect(save(), "name + designation is enough; the photo is optional").toBeUndefined();
  });

  it("publishes without a photo when none was uploaded", async () => {
    publishProfile.mockResolvedValueOnce(undefined);
    const { wrapper, r } = await mountProfile();
    await wrapper.find("[data-testid=profile-name]").setValue("Ada");
    await wrapper.find("[data-testid=profile-designation]").setValue("Solutions Architect");
    await wrapper.find("form").trigger("submit");
    await settle();

    expect(publishProfile).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Ada", designation: "Solutions Architect", picture: "" }),
    );
    expect(r.currentRoute.value.name).toBe("channels");
  });

  it("rejects a name that is too short and a title that is too long", async () => {
    const { wrapper } = await mountProfile();
    await wrapper.find("[data-testid=profile-name]").setValue("A");
    await wrapper.find("[data-testid=profile-name]").trigger("blur");
    expect(wrapper.find("[data-testid=profile-name-problem]").exists()).toBe(true);

    await wrapper.find("[data-testid=profile-name]").setValue("Ada");
    await wrapper.find("[data-testid=profile-designation]").setValue("x".repeat(41));
    await wrapper.find("[data-testid=profile-designation]").trigger("blur");
    expect(wrapper.find("[data-testid=profile-designation-problem]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=profile-save]").attributes("disabled")).toBeDefined();
  });

  /** REGRESSION: the "Skip for now" bypass was removed — this screen is blocking. */
  it("offers no way to skip", async () => {
    const { wrapper } = await mountProfile();
    expect(wrapper.find("[data-testid=profile-skip]").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Skip for now");
  });

  it("shows a live preview of the name and designation", async () => {
    const { wrapper } = await mountProfile();
    await wrapper.find("[data-testid=profile-name]").setValue("Ada");
    await wrapper.find("[data-testid=profile-designation]").setValue("Solutions Architect");
    const preview = wrapper.find("[data-testid=profile-preview]");
    expect(preview.text()).toContain("Ada");
    expect(preview.text()).toContain("Solutions Architect");
  });

  it("a publish failure is shown and the user stays on the form, able to retry", async () => {
    publishProfile.mockRejectedValueOnce(new Error("relay said no"));
    const { wrapper } = await mountProfile();
    await fillValid(wrapper);
    await wrapper.find("form").trigger("submit");
    await settle();
    expect(wrapper.find("[data-testid=profile-error]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=profile-retry]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=profile-save]").exists()).toBe(true); // still on the form
  });
});

