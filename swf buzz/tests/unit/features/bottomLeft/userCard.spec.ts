/**
 * The bottom-left control centre: compact card → profile menu → community
 * submenu, dialogs, and the rules behind them (presence/status from the shared
 * stores, operator-only items, leave only after the relay's OK, Send feedback
 * above Settings, Settings opens the full-screen page, no developer-only
 * entries, community settings lock what the server owns).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, ref } from "vue";
import type { UnsignedEvent } from "@/features/signing/types";

const ME = "8".repeat(64);
const RELAY = "wss://buzz.lmdconsulting.com";

const caps = ref({ canAccessOperatorDashboard: false, canCreateCommunity: false });
vi.mock("@/features/access/capabilities", () => ({ useCapabilities: () => computed(() => caps.value) }));
vi.mock("@/composables/useProfile", () => ({
  useDisplayName: () => ({ profile: ref({ avatarUrl: undefined }), displayName: ref("Prakhar Mittal") }),
}));
const push = vi.fn();
vi.mock("vue-router", () => ({ useRouter: () => ({ push }), useRoute: () => ({ fullPath: "/channels?channelId=c1" }) }));

const published: UnsignedEvent[] = [];
vi.mock("@/services/publish", () => ({
  signAndPublish: async (event: UnsignedEvent) => {
    published.push(event);
    return { ...event, id: "e", pubkey: ME, created_at: 1_790_000_000, sig: "s" };
  },
}));
const leave = vi.fn<() => Promise<string>>();
vi.mock("@/features/communities/leaveCommunity", () => ({ leaveCommunity: () => leave() }));
const endSession = vi.fn();
vi.mock("@/features/auth/identitySession", () => ({ endIdentitySession: () => endSession() }));
vi.mock("@/services/RelayConnectionService", () => ({
  relayConnectionService: { subscribe: () => ({ close: () => undefined }) },
}));

const { usePresenceStore } = await import("@/stores/presence");
const { useUserStatusStore } = await import("@/stores/userStatus");
const { useSessionStore } = await import("@/stores/session");
const rc = await import("@/features/communities/relayCommunities");
const SidebarUserCard = (await import("@/layouts/SidebarUserCard.vue")).default;
const CommunitySettingsDialog = (await import("@/features/communities/ui/CommunitySettingsDialog.vue")).default;

function mountCard() {
  return mount(SidebarUserCard, { attachTo: document.body });
}
const body = () => document.body;
const q = (sel: string) => body().querySelector<HTMLElement>(sel);

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = "";
  useSessionStore().$patch({ pubkey: ME, communityRole: "member" });
  rc.clearCommunitiesForTests();
  rc.addCommunity(RELAY, "buzz");
  rc.setActiveRelay(RELAY);
  caps.value = { canAccessOperatorDashboard: false, canCreateCommunity: false };
  published.length = 0;
  push.mockClear();
  leave.mockReset();
  endSession.mockClear();
});

describe("user card", () => {
  it("shows name, live presence, custom status and the current community", () => {
    usePresenceStore().apply(ME, { status: "online", updatedAt: 1, source: "snapshot" });
    const w = mountCard();
    expect(w.find("[data-testid=user-card-name]").text()).toBe("Prakhar Mittal");
    expect(w.find(".avatar-presence").attributes("data-presence")).toBe("online");
    expect(w.find(".card-sub").text()).toBe("Online");
    expect(w.find("[data-testid=user-card-community]").text()).toBe("Bbuzz");

    useUserStatusStore().apply(ME, { emoji: "🏠", text: "Working remotely", expiresAt: null, updatedAt: 2 }, 2);
    return flushPromises().then(() => expect(w.find(".card-sub").text()).toContain("Working remotely"));
  });

  it("opens the profile menu anchored to the card; Escape and outside click close it", async () => {
    const w = mountCard();
    await w.find("[data-testid=user-card]").trigger("click");
    expect(q("[aria-label='Profile menu']")).not.toBeNull();
    expect(q("[data-testid=menu-status]")?.textContent).toContain("Update your status");
    expect(q("[data-testid=menu-send-feedback]")?.textContent).toContain("Send feedback");

    q("[aria-label='Profile menu']")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(q("[aria-label='Profile menu']")).toBeNull();

    await w.find("[data-testid=user-card]").trigger("click");
    q("[data-testid=popover-overlay]")!.click();
    await flushPromises();
    expect(q("[aria-label='Profile menu']")).toBeNull();
  });

  it("Settings closes the menu and opens the full-screen Settings page, remembering where you were", async () => {
    const w = mountCard();
    await w.find("[data-testid=user-card]").trigger("click");
    q("[data-testid=menu-settings]")!.click();
    await flushPromises();
    expect(q("[aria-label='Profile menu']")).toBeNull();
    expect(push).toHaveBeenCalledWith({ name: "settings", query: { section: "profile", from: "/channels?channelId=c1" } });
    // No dialog stands in for Settings any more.
    expect(q("[data-testid=settings-coming-soon]")).toBeNull();
  });

  it("menu order: Send feedback sits directly above Settings; no developer diagnostics entry", async () => {
    const w = mountCard();
    await w.find("[data-testid=user-card]").trigger("click");
    const items = [...body().querySelectorAll<HTMLElement>("[aria-label='Profile menu'] [role=menuitem]")].map(
      (el) => el.dataset.testid ?? el.textContent?.trim(),
    );
    const feedback = items.indexOf("menu-send-feedback");
    expect(feedback).toBeGreaterThan(-1);
    expect(items[feedback + 1]).toBe("menu-settings");
    expect(body().textContent).not.toContain("Identity diagnostics");

    q("[data-testid=menu-send-feedback]")!.click();
    await flushPromises();
    expect(w.emitted("feedback")).toHaveLength(1);
    expect(q("[aria-label='Profile menu']")).toBeNull();
  });

  it("community submenu: member sees no Operator Dashboard / Create; operator does", async () => {
    const w = mountCard();
    await w.find("[data-testid=user-card]").trigger("click");
    q("[data-testid=menu-community]")!.click();
    await flushPromises();
    expect(q("[aria-label='Community menu']")).not.toBeNull();
    for (const id of ["menu-copy-url", "menu-identity", "menu-community-settings", "menu-leave", "menu-add-community"]) {
      expect(q(`[data-testid=${id}]`), id).not.toBeNull();
    }
    expect(q("[data-testid=menu-operator]")).toBeNull();
    expect(q("[data-testid=menu-create-community]")).toBeNull();

    caps.value = { canAccessOperatorDashboard: true, canCreateCommunity: true };
    await flushPromises();
    expect(q("[data-testid=menu-operator]")).not.toBeNull();
    expect(q("[data-testid=menu-create-community]")).not.toBeNull();
  });

  it("My identity and Sign out are handed to the sidebar (existing flows)", async () => {
    const w = mountCard();
    await w.find("[data-testid=user-card]").trigger("click");
    q("[data-testid=sign-out]")!.click();
    await flushPromises();
    expect(w.emitted("sign-out")).toHaveLength(1);
    await w.find("[data-testid=user-card]").trigger("click");
    q("[data-testid=menu-community]")!.click();
    await flushPromises();
    q("[data-testid=menu-identity]")!.click();
    expect(w.emitted("identity")).toHaveLength(1);
  });

  it("Leave community asks first; local cleanup happens only after the relay accepted", async () => {
    let resolve!: (v: string) => void;
    leave.mockImplementation(() => new Promise((r) => (resolve = r)));
    const w = mountCard();
    await w.find("[data-testid=user-card]").trigger("click");
    q("[data-testid=menu-community]")!.click();
    await flushPromises();
    q("[data-testid=menu-leave]")!.click();
    await flushPromises();
    expect(leave).not.toHaveBeenCalled();

    q("[data-testid=confirm-leave-community]")!.click();
    await flushPromises();
    expect(rc.communities.value.map((c) => c.relayUrl)).toEqual([RELAY]); // not forgotten yet
    resolve("left");
    await flushPromises();
    expect(rc.communities.value).toEqual([]);
    expect(endSession).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith({ name: "communities" });
  });

  it("a refused leave keeps everything and shows why", async () => {
    const { AppError } = await import("@/services/errors");
    leave.mockImplementation(() =>
      Promise.reject(new AppError("relay_rejected", "You own this community, so you can't leave it.")),
    );
    const w = mountCard();
    await w.find("[data-testid=user-card]").trigger("click");
    q("[data-testid=menu-community]")!.click();
    await flushPromises();
    q("[data-testid=menu-leave]")!.click();
    await flushPromises();
    q("[data-testid=confirm-leave-community]")!.click();
    await flushPromises();
    expect(q("[data-testid=leave-community-dialog]")!.textContent).toContain("You own this community");
    expect(rc.communities.value).toHaveLength(1);
    expect(endSession).not.toHaveBeenCalled();
  });
});

describe("status dialog", () => {
  it("a quick status fills the form; Save publishes OLD BUZZ's kind 30315 and shows it at once", async () => {
    const w = mountCard();
    await w.find("[data-testid=user-card]").trigger("click");
    q("[data-testid=menu-status]")!.click();
    await flushPromises();
    const quick = [...body().querySelectorAll<HTMLButtonElement>(".quick-item")].find((b) =>
      b.textContent?.includes("Working remotely"),
    )!;
    quick.click();
    await flushPromises();
    (q("[data-testid=status-save]") as HTMLButtonElement).click();
    await flushPromises();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ kind: 30315, content: "Working remotely" });
    expect(published[0].tags).toContainEqual(["d", "general"]);
    expect(published[0].tags).toContainEqual(["emoji", "🏠"]);
    expect(published[0].tags.some((t) => t[0] === "expiration")).toBe(true);
    expect(useUserStatusStore().statusOf(ME)?.text).toBe("Working remotely");
  });
});

describe("community settings", () => {
  it("the relay URL and role are locked; the name is a local label that saves", async () => {
    const w = mount(CommunitySettingsDialog, { attachTo: document.body });
    expect(q("[data-testid=community-relay]")!.textContent).toContain(RELAY);
    expect(q("[data-testid=community-relay] input")).toBeNull();
    expect(q("[data-testid=community-role-value]")!.textContent).toContain("Member");
    const input = q("[data-testid=community-name]") as HTMLInputElement;
    input.value = "LMD";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    (q("[data-testid=community-settings-save]") as HTMLButtonElement).click();
    await flushPromises();
    expect(rc.communities.value.find((c) => c.relayUrl === RELAY)?.name).toBe("LMD");
    w.unmount();
  });
});
