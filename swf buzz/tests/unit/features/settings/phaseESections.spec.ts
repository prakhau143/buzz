/**
 * Phase E — the new Communities and Send-feedback pages, custom-emoji
 * authorization, settings persistence (appearance per device, notifications
 * per identity) and its immediate effect on the ONE alert policy, cross-
 * identity isolation, and "no secret ever lands in settings / feedback".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { computed, h, ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

const ME = "a".repeat(64);
const OTHER = "b".repeat(64);

// ---- Communities: the shared switch (same one the rail uses) ----
const sw = vi.hoisted(() => ({
  switchTo: vi.fn(async (_u: string) => true),
  refresh: vi.fn(async () => undefined),
  clearError: vi.fn(),
  openAddCommunity: vi.fn(),
}));
const accessible = ref<{ relayUrl: string; host: string; name: string; role: string | null }[]>([]);
const switchError = ref<string | null>(null);
const switchingTo = ref<string | null>(null);
vi.mock("@/features/communities/useCommunitySwitch", () => ({
  useCommunitySwitch: () => ({
    current: computed(() => ({ url: "wss://a.example.com", name: "SWF Project", host: "a.example.com" })),
    accessible,
    verifying: ref(false),
    verified: ref(true),
    refresh: sw.refresh,
    switchTo: sw.switchTo,
    switchingTo,
    switchError,
    clearError: sw.clearError,
    openAddCommunity: sw.openAddCommunity,
  }),
}));
vi.mock("@/features/communities/communityIcon", () => ({ fetchCommunityIcon: async () => null }));
vi.mock("@/features/feedback/ui/SendFeedbackDialog.vue", () => ({
  __esModule: true,
  default: { name: "SendFeedbackDialog", emits: ["close"], render: () => h("div", { role: "dialog", "aria-modal": "true", "data-testid": "feedback-dialog" }) },
}));
// ---- Custom emoji: the palette and my own set ----
const emoji = vi.hoisted(() => ({ palette: [] as unknown[], remove: vi.fn(async () => undefined), add: vi.fn(async () => undefined), upload: vi.fn(async () => "https://x/media/" + "c".repeat(64)) }));
vi.mock("@/features/customEmoji/customEmoji", async (orig) => ({
  ...(await orig<typeof import("@/features/customEmoji/customEmoji")>()),
  fetchPalette: async () => emoji.palette,
  removeCustomEmoji: emoji.remove,
  addCustomEmoji: emoji.add,
  uploadEmojiImage: emoji.upload,
}));
vi.mock("@/composables/useAuthorizedMedia", () => ({ useAuthorizedMedia: () => ({ resolved: ref(new Map()) }) }));

const CommunitiesSection = (await import("@/features/settings/ui/sections/CommunitiesSection.vue")).default;
const FeedbackSection = (await import("@/features/settings/ui/sections/FeedbackSection.vue")).default;
const CustomEmojiSection = (await import("@/features/settings/ui/sections/CustomEmojiSection.vue")).default;
const { useSessionStore } = await import("@/stores/session");
const { useConnectionStore } = await import("@/stores/connection");
const appearance = await import("@/features/appearance/appearance");
const notif = await import("@/features/notifications/notificationSettings");
const { shouldAlert } = await import("@/features/notifications/desktopNotifier");
const feedback = await import("@/features/feedback/feedbackModel");
const { messageTarget } = await import("@/features/notifications/notificationEngine");

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().$patch({ pubkey: ME, communityRole: "member", platformRole: null });
  accessible.value = [];
  switchError.value = null;
  switchingTo.value = null;
  sw.switchTo.mockClear();
  sw.refresh.mockClear();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
describe("Settings → Communities", () => {
  const withRows = () => {
    accessible.value = [
      { relayUrl: "wss://b.example.com", host: "b.example.com", name: "Beta", role: "owner" },
      { relayUrl: "wss://a.example.com", host: "a.example.com", name: "SWF Project", role: "member" },
      { relayUrl: "wss://c.example.com", host: "c.example.com", name: "Charlie", role: null },
    ];
  };

  it("lists the communities this identity can open — the open one first with its live connection state", async () => {
    withRows();
    useConnectionStore().setStatus("connected");
    const w = mount(CommunitiesSection);
    await flushPromises();
    expect(sw.refresh).toHaveBeenCalled(); // re-asked, never assumed
    const rows = w.findAll("[data-testid=communities-row]");
    expect(rows.map((r) => r.find(".name").text())).toEqual(["SWF Project", "Beta", "Charlie"]);
    expect(rows[0].find("[data-testid=communities-status]").text()).toContain("Connected");
    expect(rows[1].find("[data-testid=communities-role]").text()).toBe("Owner");
    expect(rows[2].text()).toContain("Role not confirmed");
    expect(rows[0].find("[data-testid=communities-switch]").exists()).toBe(false);
  });

  it("the connection state is real, not assumed", async () => {
    withRows();
    useConnectionStore().setStatus("reconnecting");
    const w = mount(CommunitiesSection);
    expect(w.find("[data-testid=communities-status]").text()).toContain("Reconnecting");
  });

  it("Switch runs the shared VERIFIED switch; a refusal is shown and you stay", async () => {
    withRows();
    const w = mount(CommunitiesSection);
    await w.findAll("[data-testid=communities-switch]")[0].trigger("click");
    expect(sw.clearError).toHaveBeenCalled();
    expect(sw.switchTo).toHaveBeenCalledWith("wss://b.example.com");
    switchError.value = "This identity is not a member of that community.";
    await flushPromises();
    expect(w.find("[data-testid=communities-error]").attributes("role")).toBe("alert");
  });

  it("while a switch runs, every Switch is disabled and the target says so", async () => {
    withRows();
    switchingTo.value = "wss://b.example.com";
    const w = mount(CommunitiesSection);
    const buttons = w.findAll("[data-testid=communities-switch]");
    expect(buttons.every((b) => b.attributes("disabled") !== undefined)).toBe(true);
    expect(buttons[0].text()).toBe("Switching…");
  });

  it("operator ≠ owner: the two planes are shown separately and never inferred from each other", () => {
    useSessionStore().$patch({ platformRole: "operator", communityRole: "member" });
    let w = mount(CommunitiesSection);
    expect(w.find("[data-testid=communities-community-role]").text()).toBe("Member");
    expect(w.find("[data-testid=communities-platform-role]").text()).toBe("Operator");
    w.unmount();
    useSessionStore().$patch({ platformRole: null, communityRole: "owner" });
    w = mount(CommunitiesSection);
    expect(w.find("[data-testid=communities-community-role]").text()).toBe("Owner");
    expect(w.find("[data-testid=communities-platform-role]").text()).toBe("None");
  });

  it("Add community uses the existing flow", async () => {
    const w = mount(CommunitiesSection);
    await w.find("[data-testid=communities-add]").trigger("click");
    expect(sw.openAddCommunity).toHaveBeenCalled();
  });
});

describe("Settings → Send feedback", () => {
  it("opens the SAME feedback dialog, and says who reads it and that no private key is sent", async () => {
    const w = mount(FeedbackSection, { attachTo: document.body });
    expect(document.querySelector("[data-testid=feedback-dialog]")).toBeNull();
    expect(w.text()).toContain("Only the people who run this SWF Buzz deployment read feedback");
    expect(w.text()).toContain("Community members, owners and admins don't see it");
    expect(w.text()).toContain("Your private key never leaves your signer");
    expect(w.findAll(".categories li").map((l) => l.text())).toEqual([
      expect.stringContaining("Bug"),
      expect.stringContaining("Praise"),
      expect.stringContaining("Needs work"),
    ]);
    await w.find("[data-testid=settings-feedback-open]").trigger("click");
    // Teleported to <body>: the overlay covers the viewport, not the animated page box.
    const dialog = document.querySelector("[data-testid=feedback-dialog]");
    expect(dialog?.parentElement).toBe(document.body);
    w.unmount();
  });
});

describe("Settings → Custom emoji authorization", () => {
  it("only MY emoji can be removed (a set belongs to its author); others are view-only", async () => {
    emoji.palette = [
      { shortcode: "mine_one", url: "https://x/media/" + "1".repeat(64), author: ME, createdAt: 2 },
      { shortcode: "theirs", url: "https://x/media/" + "2".repeat(64), author: OTHER, createdAt: 1 },
    ];
    const w = mount(CustomEmojiSection, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
    await flushPromises();
    await flushPromises();
    expect(w.find("[data-testid=my-emoji-mine_one] .remove").exists()).toBe(true);
    expect(w.findAll(".remove")).toHaveLength(1);
    await w.find("[data-testid=my-emoji-mine_one] .remove").trigger("click");
    expect(emoji.remove).toHaveBeenCalledWith(ME, "mine_one");
  });

  it("an invalid name is flagged (aria-invalid) and cannot be saved", async () => {
    emoji.palette = [];
    const w = mount(CustomEmojiSection, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
    await flushPromises();
    await w.find("[data-testid=emoji-name]").setValue("bad name!");
    expect(w.find("[data-testid=emoji-name]").attributes("aria-invalid")).toBe("true");
    expect(w.find("[data-testid=emoji-save]").attributes("disabled")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe("persistence and immediate effect", () => {
  it("appearance: device-local, applied instantly as theme attributes, and read back after a reload", () => {
    const { set, prefs } = appearance.useAppearance();
    expect(set({ mode: "dark", accent: "emerald" })).toBe(true);
    appearance.applyAppearance(document.documentElement);
    expect(document.documentElement.dataset.colorScheme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("emerald");
    expect(prefs.value.mode).toBe("dark");
    const stored = JSON.parse(localStorage.getItem(appearance.APPEARANCE_STORAGE_KEY)!);
    expect(appearance.sanitizeAppearance(stored)).toMatchObject({ mode: "dark", accent: "emerald" }); // what a reload reads
    set({ mode: "light" });
    appearance.applyAppearance(document.documentElement);
    expect(document.documentElement.dataset.colorScheme).toBe("light");
  });

  it("notifications: per identity on this device; a change affects the ONE alert policy immediately", () => {
    notif.loadNotificationSettings(ME);
    notif.updateNotificationSettings({ desktopEnabled: true });
    expect(shouldAlert({ slot: "mention", viewing: false }, notif.currentNotificationSettings())).toBe(true);
    notif.updateNotificationSettings({ slots: { mention: false } });
    expect(shouldAlert({ slot: "mention", viewing: false }, notif.currentNotificationSettings())).toBe(false);
    expect(shouldAlert({ slot: "dm", viewing: false }, notif.currentNotificationSettings())).toBe(true);
    // After a reload the same identity reads the same choice…
    expect(notif.loadNotificationSettings(ME).slots.mention).toBe(false);
    // …and another identity on this device does not inherit it.
    expect(notif.loadNotificationSettings(OTHER).slots.mention).toBe(true);
  });
});

describe("security: nothing secret in settings, notifications or feedback", () => {
  const NSEC = "nsec1" + "q".repeat(58);

  it("settings storage holds preferences only — no key material", () => {
    appearance.setAppearance({ mode: "system" });
    notif.loadNotificationSettings(ME);
    notif.updateNotificationSettings({ desktopEnabled: true });
    const dump = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join("\n");
    expect(dump).not.toMatch(/nsec1|ncryptsec1|privkey|private_?key|secret/i);
  });

  it("a feedback event carries the message, category and attachment refs only", () => {
    const event = feedback.buildFeedbackEvent({ category: "bug", message: "The inbox froze", attachments: [] });
    expect(event.kind).toBe(feedback.KIND_PRODUCT_FEEDBACK);
    expect(event.tags).toEqual([["category", "bug"]]);
    expect(JSON.stringify(event)).not.toMatch(/nsec|private|secret|pubkey/i);
  });

  it("opt-in diagnostics redact anything key-like, whatever field it appears in", () => {
    const text = feedback.formatDiagnostics({ capturedAt: "t", appVersion: "1", platform: NSEC, userAgent: `token=abc ${"f".repeat(64)}`, language: "en" });
    expect(text).not.toContain(NSEC);
    expect(text).not.toContain("f".repeat(64));
    expect(text).not.toMatch(/token=abc/);
    expect(text).toContain("[redacted]");
  });

  it("a notification click target is ID-only (identity fingerprint, never a key)", () => {
    const target = messageTarget(
      { id: "1".repeat(64), channelId: "c1", thread: {} } as never,
      { identity: ME, community: "wss://a.example.com", isDm: false },
    );
    const json = JSON.stringify(target);
    expect(json).not.toContain(ME); // only a 16-char fingerprint
    expect(json).not.toMatch(/nsec|private|secret/i);
  });
});
