/**
 * Phase E — the Settings shell on both tiers: the Profile / App / Communities /
 * Support navigation, full-width desktop content, Back to app (in-app paths
 * only), Escape, the mobile settings list → section stack with its own back,
 * 44 px targets, and the mobile Profile tab listing every visible section.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { h } from "vue";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), route: null as unknown as { query: Record<string, string>; name: string } }));
vi.mock("vue-router", async () => {
  const { reactive } = await import("vue");
  nav.route = reactive({ name: "settings", params: {}, query: {} as Record<string, string> });
  return {
    useRouter: () => ({ push: nav.push, replace: nav.replace }),
    useRoute: () => nav.route,
    RouterLink: { props: ["to"], setup: (p: { to: unknown }, { slots, attrs }: { slots: { default?: () => unknown }; attrs: Record<string, unknown> }) => () => h("a", { ...attrs, "data-to": JSON.stringify(p.to) }, slots.default?.()) },
  };
});
vi.mock("@/app/appVersion", async () => {
  const { ref } = await import("vue");
  return { appVersion: ref("9.9.9"), loadAppVersion: async () => undefined };
});
const IDS = ["Profile", "Appearance", "Notifications", "Shortcuts", "CustomEmoji", "Community", "Invites", "Mobile", "Updates", "Communities", "Feedback"];
for (const id of IDS) {
  vi.doMock(`@/features/settings/ui/sections/${id}Section.vue`, () => ({
    __esModule: true,
    default: { name: `${id}Section`, render: () => h("section", { "data-testid": `section-${id}` }, [h("h1", id)]) },
  }));
}
vi.mock("@/composables/useProfile", async () => {
  const { computed } = await import("vue");
  return { useProfile: () => ({ data: computed(() => ({ displayName: "Prakhar" })) }) };
});
vi.mock("@/features/presence/presenceSync", async () => {
  const { computed } = await import("vue");
  return { usePresenceOf: () => computed(() => "online") };
});
vi.mock("@/features/communities/useCommunitySwitch", async () => {
  const { computed } = await import("vue");
  return { useCommunitySwitch: () => ({ current: computed(() => ({ name: "SWF Project", url: "wss://a", host: "a" })) }) };
});

const SettingsView = (await import("@/features/settings/ui/SettingsView.vue")).default;
const MobileProfileView = (await import("@/features/mobile/views/MobileProfileView.vue")).default;
const { setMobileForTests } = await import("@/features/mobile/breakpoints");
const { useSessionStore } = await import("@/stores/session");

const mounted: { unmount: () => void }[] = [];
async function mountSettings() {
  const w = mount(SettingsView, { attachTo: document.body });
  mounted.push(w);
  await flushPromises();
  await flushPromises();
  return w;
}

beforeEach(() => {
  Element.prototype.scrollTo = () => undefined;
  setActivePinia(createPinia());
  useSessionStore().$patch({ pubkey: "a".repeat(64), communityRole: "member", platformRole: null });
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.route.query = {};
  document.body.innerHTML = "";
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  setMobileForTests(false);
});

describe("desktop Settings shell", () => {
  it("navigation is Profile / App / Communities / Support with only supported sections; Invites for managers only", async () => {
    nav.route.query = { section: "appearance" };
    const w = await mountSettings();
    expect(w.findAll(".settings-nav .group-label").map((g) => g.text())).toEqual(["Profile", "App", "Communities", "Support"]);
    const ids = w.findAll(".settings-nav .nav-item").map((b) => b.attributes("data-testid")!.replace("settings-nav-", ""));
    expect(ids).toEqual(["profile", "appearance", "notifications", "shortcuts", "custom-emoji", "mobile", "updates", "communities", "community", "feedback"]);
    for (const banned of ["agents", "compute", "experiments", "hosted-communities", "channel-templates", "local-archive"]) {
      expect(w.find(`[data-testid=settings-nav-${banned}]`).exists()).toBe(false);
    }
    expect(w.find("[data-testid=settings-nav-appearance]").attributes("aria-current")).toBe("page");
    expect(w.find("[data-testid=section-Appearance]").exists()).toBe(true);
  });

  it("owners/admins also see Invites", async () => {
    useSessionStore().$patch({ communityRole: "admin" });
    const w = await mountSettings();
    expect(w.find("[data-testid=settings-nav-invites]").exists()).toBe(true);
  });

  it("choosing a section replaces the URL (Back leaves Settings in one step) and renders it", async () => {
    nav.route.query = { section: "profile" };
    const w = await mountSettings();
    await w.find("[data-testid=settings-nav-communities]").trigger("click");
    expect(nav.replace).toHaveBeenCalledWith({ query: { section: "communities" } });
    nav.route.query = { section: "communities" };
    await flushPromises();
    await flushPromises();
    expect(w.find("[data-testid=section-Communities]").exists()).toBe(true);
  });

  it("Back to app returns to the in-app `from` path, never an external or settings URL", async () => {
    nav.route.query = { section: "profile", from: "/channels?channelId=c1" };
    let w = await mountSettings();
    await w.find("[data-testid=settings-back]").trigger("click");
    expect(nav.push).toHaveBeenLastCalledWith("/channels?channelId=c1");
    w.unmount();
    nav.route.query = { section: "profile", from: "//evil.example.com" };
    w = await mountSettings();
    await w.find("[data-testid=settings-back]").trigger("click");
    expect(nav.push).toHaveBeenLastCalledWith({ name: "channels" });
  });

  it("Escape closes Settings, but not while a dialog owns it", async () => {
    nav.route.query = { section: "profile", from: "/inbox" };
    await mountSettings();
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(nav.push).not.toHaveBeenCalled();
    dialog.remove();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(nav.push).toHaveBeenCalledWith("/inbox");
  });

  it("content is full width and controls meet 44 px (layout contract)", () => {
    const src = readFileSync("src/features/settings/ui/SettingsView.vue", "utf8");
    expect(src).toMatch(/grid-template-columns: 240px minmax\(0, 1fr\)/);
    expect(src).toMatch(/\.content-inner \{\s*width: 100%;\s*max-width: none;\s*min-width: 0;/);
    expect(src).toMatch(/\.nav-item \{[^}]*min-height: 44px/);
    expect(src).toMatch(/\.back \{[^}]*min-height: 44px/);
    expect(src).toMatch(/\.settings-content :deep\(\.base-button\),\s*\.m-body :deep\(\.base-button\) \{\s*height: auto;\s*min-height: 44px;/);
  });
});

describe("mobile Settings", () => {
  beforeEach(() => setMobileForTests(true));

  it("without a section: the grouped settings list (no desktop sidebar), and no URL rewrite", async () => {
    const w = await mountSettings();
    expect(w.find(".settings-nav").exists()).toBe(false);
    expect(w.find("[data-testid=settings-view]").attributes("data-mobile-screen")).toBe("list");
    expect(w.findAll(".m-group-label").map((g) => g.text())).toEqual(["Profile", "App", "Communities", "Support"]);
    expect(w.find("[data-testid=settings-mobile-item-feedback]").exists()).toBe(true);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("a list item is a real step (push, via=list); its back returns to the list", async () => {
    nav.route.query = { from: "/m/profile" };
    const w = await mountSettings();
    await w.find("[data-testid=settings-mobile-item-notifications]").trigger("click");
    expect(nav.push).toHaveBeenCalledWith({ query: { from: "/m/profile", section: "notifications", via: "list" } });
    nav.route.query = { from: "/m/profile", section: "notifications", via: "list" };
    await flushPromises();
    await flushPromises();
    expect(w.find(".m-bar-title").text()).toBe("Notifications");
    expect(w.find("[data-testid=section-Notifications]").exists()).toBe(true);
    const back = w.find("[data-testid=settings-mobile-back]");
    expect(back.attributes("aria-label")).toBe("Back to settings");
    await back.trigger("click");
    expect(nav.replace).toHaveBeenLastCalledWith({ query: { from: "/m/profile" } });
  });

  it("a section opened from the Profile tab goes straight back there", async () => {
    nav.route.query = { section: "appearance", from: "/m/profile" };
    const w = await mountSettings();
    expect(w.find("[data-testid=section-Appearance]").exists()).toBe(true);
    await w.find("[data-testid=settings-mobile-back]").trigger("click");
    expect(nav.push).toHaveBeenCalledWith("/m/profile");
  });

  it("with no `from`, back lands on the mobile Profile tab (not a desktop route)", async () => {
    nav.route.query = { section: "appearance" };
    const w = await mountSettings();
    await w.find("[data-testid=settings-mobile-back]").trigger("click");
    expect(nav.push).toHaveBeenCalledWith({ name: "mobile-profile" });
  });

  it("Phase F: an edge swipe is the header back (section → list, then list → app)", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    const swipe = (el: Element) => {
      for (const [type, x, t] of [["touchstart", 6, 0], ["touchmove", 60, 100], ["touchmove", 220, 300], ["touchend", 220, 400]] as const) {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        const p = { clientX: x, clientY: 300 };
        Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [p] });
        Object.defineProperty(ev, "changedTouches", { value: [p] });
        Object.defineProperty(ev, "timeStamp", { value: t });
        el.dispatchEvent(ev);
      }
    };
    nav.route.query = { from: "/m/profile", section: "notifications", via: "list" };
    const w = await mountSettings();
    Object.defineProperty(w.find(".m-settings").element, "clientWidth", { value: 390 });
    swipe(w.find(".m-body").element);
    expect(nav.replace).toHaveBeenLastCalledWith({ query: { from: "/m/profile" } });
    nav.route.query = { from: "/m/profile" };
    await flushPromises();
    swipe(w.find(".m-body").element);
    expect(nav.push).toHaveBeenLastCalledWith("/m/profile");
    vi.unstubAllGlobals();
  });

  it("phone screen: safe areas, 44 px back, 16 px inputs, keyboard-tracked height", () => {
    const src = readFileSync("src/features/settings/ui/SettingsView.vue", "utf8");
    expect(src).toMatch(/\.m-settings \{[^}]*height: var\(--app-height, 100dvh\)/);
    expect(src).toMatch(/\.m-bar \{[^}]*env\(safe-area-inset-top\)/);
    expect(src).toMatch(/\.m-back \{[^}]*width: 44px;\s*height: 44px/);
    expect(src).toMatch(/font-size: 16px; \/\* no iOS zoom/);
    expect(src).toMatch(/startViewportTracking\(\)/);
  });
});

describe("mobile Profile tab → every Settings section", () => {
  it("lists the visible sections in the same groups, each opening mobile Settings with from=/m/profile", () => {
    const RouterLinkStub = { props: ["to"], setup: (p: { to: unknown }, { slots }: { slots: { default?: () => unknown } }) => () => h("a", { "data-to": JSON.stringify(p.to) }, slots.default?.()) };
    const w = mount(MobileProfileView, { global: { stubs: { RouterLink: RouterLinkStub, MobileLayout: { setup: (_: unknown, { slots }: { slots: Record<string, () => unknown> }) => () => h("div", [slots.header?.(), slots.default?.()]) } } } });
    expect(w.findAll(".section-label").map((g) => g.text())).toEqual(["Profile", "App", "Communities", "Support"]);
    const links = w.findAll("[data-testid^=mobile-settings-]").map((a) => a.attributes("data-testid")!.replace("mobile-settings-", ""));
    expect(links).toContain("feedback");
    expect(links).toContain("communities");
    expect(links).not.toContain("invites"); // member
    const to = JSON.parse(w.find("[data-testid=mobile-settings-custom-emoji]").attributes("data-to")!);
    expect(to).toEqual({ name: "settings", query: { section: "custom-emoji", from: "/m/profile" } });
  });
});
