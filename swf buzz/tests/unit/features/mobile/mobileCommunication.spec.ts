/**
 * Phase C1 — mobile communication: message action sheet (authorized actions
 * only), edit mode, reply → thread, profile sheet (people + @mentions), the
 * MessageItem touch mode, and the DM screen (partner, presence, typing, read state).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { h, ref } from "vue";
import type { Message, Reaction } from "@/types/domain";

const ME = "8".repeat(64);
const BINOD = "b".repeat(64);

const push = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ name: "mobile-dm", params: {} }),
}));
const openDm = vi.fn(async () => "d1");
vi.mock("@/features/dm/useOpenDm", () => ({ useOpenDm: () => ({ open: openDm, isOpening: ref(false) }) }));
const profiles: Record<string, { displayName: string; isAgent?: boolean; about?: string }> = {};
vi.mock("@/composables/useProfile", async () => {
  const { computed: c, ref: r } = await import("vue");
  return {
    // A real computed ref, like the production hook (templates auto-unwrap it).
    useProfile: (pk: () => string | null) => ({ data: c(() => { const k = pk(); return k ? profiles[k] : undefined; }) }),
    useProfileMap: () => ({ profiles: r(new Map()), displayNames: r(new Map()) }),
  };
});

const { useSessionStore } = await import("@/stores/session");
const { useUiStore } = await import("@/stores/ui");
const { usePresenceStore } = await import("@/stores/presence");
const MobileMessageActions = (await import("@/features/mobile/ui/MobileMessageActions.vue")).default;
const MobileEditBar = (await import("@/features/mobile/ui/MobileEditBar.vue")).default;
const MobileProfileSheet = (await import("@/features/mobile/ui/MobileProfileSheet.vue")).default;
const MobileLayout = (await import("@/features/mobile/ui/MobileLayout.vue")).default;
const MessageItem = (await import("@/components/MessageItem.vue")).default;
const { useMobileMessageActions } = await import("@/features/mobile/useMobileMessageActions");
const { MEMBER_ROLE_KEY } = await import("@/features/mobile/memberRole");

const msg = (over: Partial<Message> = {}): Message => ({
  id: "e".repeat(64),
  channelId: "c1",
  authorPubkey: ME,
  content: "Deploy is green",
  createdAt: 1_700_000_000,
  thread: {},
  mentions: [],
  reactions: [],
  status: "sent",
  isSystemMessage: false,
  isAgentMessage: false,
  attachments: [],
  ...over,
});
const q = (s: string) => document.querySelector<HTMLElement>(s);
const qa = (s: string) => [...document.querySelectorAll<HTMLElement>(s)];

beforeEach(() => {
  setActivePinia(createPinia());
  useSessionStore().$patch({ pubkey: ME });
  document.body.innerHTML = "";
  push.mockReset();
  openDm.mockClear();
  for (const k of Object.keys(profiles)) delete profiles[k];
});

describe("message action sheet shows only authorized actions", () => {
  const mountSheet = (props: Record<string, unknown>) =>
    mount(MobileMessageActions, { props: { message: msg(), isOwn: true, authorName: "Prakhar", ...props }, attachTo: document.body });
  const ids = () => qa("[data-testid^=action-]").map((e) => e.dataset.testid).filter((v, i, a) => a.indexOf(v) === i);

  it("own channel message the viewer may edit/delete: reply, react, copy, edit, delete — no report", () => {
    mountSheet({ abilities: { reply: true, react: true, edit: true, deleteMode: "self", report: false } });
    expect(ids()).toEqual(["action-react", "action-reply", "action-copy", "action-edit", "action-delete"]);
    expect(q("[data-testid=action-delete]")?.textContent).toContain("Delete message");
  });

  it("someone else's message as a channel admin: moderator delete and report, no edit", () => {
    mountSheet({ isOwn: false, authorName: "Binod", abilities: { reply: true, react: true, edit: false, deleteMode: "admin", report: true } });
    expect(ids()).toEqual(["action-react", "action-reply", "action-copy", "action-delete", "action-report"]);
    expect(q("[data-testid=action-delete]")?.textContent).toContain("Delete (moderator)");
  });

  it("a DM (desktop DM offers no edit/delete/report): reply, react, copy only", () => {
    mountSheet({ isOwn: false, abilities: { reply: true, react: true } });
    expect(ids()).toEqual(["action-react", "action-reply", "action-copy"]);
  });

  it("a thread message (desktop thread offers none beyond the text): copy only", () => {
    mountSheet({ abilities: {} });
    expect(ids()).toEqual(["action-copy"]);
  });

  it("delete asks for confirmation, naming the author when it's a moderation act", async () => {
    const w = mountSheet({ isOwn: false, authorName: "Binod", abilities: { deleteMode: "admin" } });
    q("[data-testid=action-delete]")!.click();
    await flushPromises();
    expect(w.emitted("delete")).toBeUndefined();
    expect(q("[data-testid=action-delete-confirm]")?.textContent).toContain("Delete Binod's message?");
    q("[data-testid=action-delete-confirm-yes]")!.click();
    expect(w.emitted("delete")).toHaveLength(1);
  });

  it("marks reactions already made and emits the tapped emoji", async () => {
    const reactions = [{ emoji: "👍", count: 1, reactedByMe: true, reactorEventIds: { [ME]: "r1" } }] as unknown as Reaction[];
    const w = mountSheet({ abilities: { react: true }, reactions });
    const [thumbs] = qa("[data-testid=action-react]");
    expect(thumbs.getAttribute("aria-pressed")).toBe("true");
    expect(thumbs.getAttribute("aria-label")).toBe("Remove 👍 reaction");
    thumbs.click();
    expect(w.emitted("react")?.[0]).toEqual(["👍"]);
  });

  it("is an accessible modal sheet (dialog, labelled)", () => {
    mountSheet({ abilities: {} });
    const sheet = q("[data-testid=message-action-sheet]")!;
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(sheet.getAttribute("aria-label")).toBe("Message actions");
  });
});

describe("useMobileMessageActions", () => {
  function setup(edit = vi.fn(async () => true)) {
    const calls = { react: vi.fn(), unreact: vi.fn(), openThread: vi.fn(), remove: vi.fn(async () => undefined) };
    let api!: ReturnType<typeof useMobileMessageActions>;
    mount({
      setup() {
        api = useMobileMessageActions({
          abilities: () => ({ reply: true }),
          reactionsFor: () => [{ emoji: "👍", count: 1, reactedByMe: true, reactorEventIds: { [ME]: "r1" } }] as unknown as Reaction[],
          react: calls.react,
          unreact: calls.unreact,
          openThread: calls.openThread,
          edit,
          remove: calls.remove,
        });
        return () => h("div");
      },
    });
    return { api, calls, edit };
  }

  it("reacting again on my reaction retracts it; a new emoji adds one (the desktop toggle rule)", () => {
    const { api, calls } = setup();
    api.open(msg());
    api.onReact("👍");
    expect(calls.unreact).toHaveBeenCalledWith("e".repeat(64), "👍", "r1");
    api.onReact("🎉");
    expect(calls.react).toHaveBeenCalledWith("e".repeat(64), "🎉");
  });

  it("reply opens the thread of the message's root (or the message itself)", () => {
    const { api, calls } = setup();
    api.open(msg({ thread: { rootId: "root1", parentId: "root1" } }));
    api.onReply();
    expect(calls.openThread).toHaveBeenCalledWith("root1");
    api.open(msg());
    api.onReply();
    expect(calls.openThread).toHaveBeenLastCalledWith("e".repeat(64));
  });

  it("edit mode: saving publishes through the caller's edit path and leaves edit mode only on success", async () => {
    const edit = vi.fn(async () => false);
    const { api } = setup(edit);
    api.open(msg());
    api.onEdit();
    expect(api.editing.value?.id).toBe("e".repeat(64));
    await api.saveEdit("Deploy is green ✅");
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ id: "e".repeat(64) }), "Deploy is green ✅");
    expect(api.editing.value).not.toBeNull(); // failed → still editing
    edit.mockResolvedValueOnce(true);
    await api.saveEdit("Deploy is green ✅");
    expect(api.editing.value).toBeNull();
  });

  it("delete goes through the caller's delete path", async () => {
    const { api, calls } = setup();
    api.open(msg());
    await api.onDelete();
    expect(calls.remove).toHaveBeenCalledOnce();
  });
});

describe("MobileEditBar", () => {
  it("is prefilled; an unchanged edit is not a publish; a change saves; Escape cancels", async () => {
    const w = mount(MobileEditBar, { props: { original: "Hello" }, attachTo: document.body });
    await flushPromises();
    const input = w.find("[data-testid=mobile-edit-input]");
    expect((input.element as HTMLTextAreaElement).value).toBe("Hello");
    await w.find("[data-testid=mobile-edit-save]").trigger("click");
    expect(w.emitted("save")).toBeUndefined();
    expect(w.emitted("cancel")).toHaveLength(1);
    await input.setValue("Hello there");
    await w.find("[data-testid=mobile-edit-save]").trigger("click");
    expect(w.emitted("save")?.[0]).toEqual(["Hello there"]);
    await input.trigger("keydown", { key: "Escape" });
    expect(w.emitted("cancel")).toHaveLength(2);
  });
});

describe("MobileProfileSheet", () => {
  const mountSheet = (pubkey: string, role: string | null = null) =>
    mount(MobileProfileSheet, {
      props: { pubkey },
      attachTo: document.body,
      global: { provide: { [MEMBER_ROLE_KEY as symbol]: () => role } },
    });

  it("shows the person from the shared profile, their role in this conversation and presence", async () => {
    profiles[BINOD] = { displayName: "Binod" };
    usePresenceStore().apply(BINOD, { status: "online", updatedAt: 1, source: "snapshot" });
    mountSheet(BINOD, "admin");
    await flushPromises();
    expect(q("[data-testid=mobile-profile-name]")?.textContent).toBe("Binod");
    expect(q("[data-testid=mobile-profile-role]")?.textContent?.trim()).toBe("Admin");
    expect(q("[data-testid=mobile-profile-presence]")?.textContent).toContain("Online");
  });

  it("an agent is labelled Agent", async () => {
    profiles[BINOD] = { displayName: "Scout", isAgent: true };
    mountSheet(BINOD, "member");
    await flushPromises();
    expect(q("[data-testid=mobile-profile-role]")?.textContent?.trim()).toBe("Agent");
  });

  it("Message opens (find-or-create) the DM and navigates to the mobile DM screen", async () => {
    profiles[BINOD] = { displayName: "Binod" };
    const w = mountSheet(BINOD);
    await flushPromises();
    q("[data-testid=mobile-profile-message]")!.click();
    await flushPromises();
    expect(openDm).toHaveBeenCalledWith([BINOD]);
    expect(push).toHaveBeenCalledWith({ name: "mobile-dm", params: { conversationId: "d1" } });
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("no Message action on yourself; View profile reveals the details; Close closes", async () => {
    profiles[ME] = { displayName: "Prakhar", about: "Builds SWF" };
    const w = mountSheet(ME);
    await flushPromises();
    expect(q("[data-testid=mobile-profile-message]")).toBeNull();
    q("[data-testid=mobile-profile-view]")!.click();
    await flushPromises();
    expect(q("[data-testid=mobile-profile-details]")?.textContent).toContain("Builds SWF");
    q("[data-testid=mobile-profile-close]")!.click();
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("44px+ targets and dialog semantics", async () => {
    profiles[BINOD] = { displayName: "Binod" };
    mountSheet(BINOD);
    await flushPromises();
    expect(q("[data-testid=mobile-profile-sheet]")?.getAttribute("role")).toBe("dialog");
    expect(q("[data-testid=mobile-profile-sheet]")?.getAttribute("aria-label")).toBe("Binod, profile");
  });
});

describe("people and @mentions open the profile sheet on mobile", () => {
  it("anything calling ui.openProfile (avatar, name, mention chip) shows the sheet inside a mobile screen; closing clears it", async () => {
    profiles[BINOD] = { displayName: "Binod" };
    mount(MobileLayout, { slots: { default: () => h("p", "content") }, attachTo: document.body });
    expect(q("[data-testid=mobile-profile-sheet]")).toBeNull();
    useUiStore().openProfile(BINOD); // what MentionChip / MessageItem avatar / name do
    await flushPromises();
    expect(q("[data-testid=mobile-profile-name]")?.textContent).toBe("Binod");
    q("[data-testid=mobile-profile-close]")!.click();
    await flushPromises();
    expect(useUiStore().contextPanel).toEqual({ kind: "none" });
    expect(q("[data-testid=mobile-profile-sheet]")).toBeNull();
  });
});

describe("MessageItem touch mode", () => {
  it("mobile: an always-visible ⋯ opens actions and the hover row is gone; avatar/name still open the profile", async () => {
    profiles[BINOD] = { displayName: "Binod" };
    const w = mount(MessageItem, { props: { message: msg({ authorPubkey: BINOD }), mobileActions: true } });
    const more = w.find("[data-testid=message-mobile-actions]");
    expect(more.attributes("aria-label")).toBe("Message actions, Binod");
    expect(w.find(".message-actions").exists()).toBe(false);
    await more.trigger("click");
    expect(w.emitted("open-actions")).toHaveLength(1);
    await w.find("[data-testid=message-author-name]").trigger("click");
    expect(w.emitted("open-profile")?.[0]).toEqual([BINOD]);
  });

  it("desktop (default): unchanged — hover row present, no ⋯", () => {
    const w = mount(MessageItem, { props: { message: msg() } });
    expect(w.find("[data-testid=message-mobile-actions]").exists()).toBe(false);
    expect(w.find(".message-actions").exists()).toBe(true);
  });
});
