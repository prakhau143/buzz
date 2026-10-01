import { defineStore } from "pinia";

/**
 * The channel-conversation right-side context panel — exactly one of these
 * at a time, never stacked. Replaces the old always-visible
 * Members/Invites/Community/Moderation tab strip: that content is
 * community-wide, not channel-conversation-scoped, and now lives in a
 * separate community-management surface (see `CommunityManagementModal.vue`)
 * reached independently of channel selection.
 */
export type ContextPanel =
  | { kind: "none" }
  | { kind: "thread"; rootEventId: string }
  | { kind: "profile"; pubkey: string }
  | { kind: "channelDetails" };

/**
 * How an open thread is laid out (docs/THREAD_EXPANDED_VIEW.md): docked at its
 * normal width, or expanded toward the left with the conversation still
 * visible beside it. Layout only — the thread's data is untouched.
 */
export type ThreadViewMode = "docked" | "expanded";

/** Small, client-only UI preferences. Never store message/channel data here — that's Vue Query's job. */
export const useUiStore = defineStore("ui", {
  state: () => ({
    sidebarCollapsed: false,
    selectedChannelId: null as string | null,
    selectedConversationId: null as string | null,
    contextPanel: { kind: "none" } as ContextPanel,
    /**
     * Set by a completed community switch: the channel view picks a channel of
     * the NEW community once its list has loaded (`channelAfterCommunitySwitch`).
     * `previousChannelId` is only a preference — kept if the new community has it.
     */
    channelRestore: null as { previousChannelId: string | null } | null,
    /**
     * The open thread is expanded. Session-only on purpose (never persisted):
     * the app always starts docked. Cleared whenever the pane stops showing a
     * thread, so a later thread opens docked.
     */
    threadExpanded: false,
  }),
  getters: {
    openThreadRootId: (state) =>
      state.contextPanel.kind === "thread" ? state.contextPanel.rootEventId : null,
    /**
     * Whether the context pane is showing.
     *
     * DERIVED, not a separate flag. `detailsPaneOpen` used to be independent of
     * `contextPanel.kind`, so `closeContextPanel()` cleared the content while
     * leaving the frame visible — an empty pane that only the "Hide details"
     * toggle could dismiss. That coupling is why the toggle existed at all; with
     * visibility derived, there is nothing left for it to do and no way to
     * strand an empty pane.
     */
    detailsPaneOpen: (state) => state.contextPanel.kind !== "none",
    threadViewMode: (state): ThreadViewMode =>
      state.contextPanel.kind === "thread" && state.threadExpanded ? "expanded" : "docked",
  },
  actions: {
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    },
    /** Used by AppShell's responsive breakpoint watcher — see its own comment. */
    setSidebarCollapsed(collapsed: boolean) {
      this.sidebarCollapsed = collapsed;
    },
    selectChannel(channelId: string | null) {
      this.selectedChannelId = channelId;
      this.selectedConversationId = null;
      this.contextPanel = { kind: "none" };
      this.threadExpanded = false;
    },
    selectConversation(conversationId: string | null) {
      this.selectedConversationId = conversationId;
      this.selectedChannelId = null;
      this.contextPanel = { kind: "none" };
      this.threadExpanded = false;
    },
    // Each opener only sets the panel — visibility is derived from it.
    openThread(rootEventId: string) {
      this.contextPanel = { kind: "thread", rootEventId };
    },
    openProfile(pubkey: string) {
      this.contextPanel = { kind: "profile", pubkey };
      this.threadExpanded = false;
    },
    openChannelDetails() {
      this.contextPanel = { kind: "channelDetails" };
      this.threadExpanded = false;
    },
    closeContextPanel() {
      this.contextPanel = { kind: "none" };
      this.threadExpanded = false;
    },
    /** Expand / restore the open thread. A no-op when no thread is open. */
    setThreadViewMode(mode: ThreadViewMode) {
      this.threadExpanded = mode === "expanded" && this.contextPanel.kind === "thread";
    },
    toggleThreadExpanded() {
      this.setThreadViewMode(this.threadViewMode === "expanded" ? "docked" : "expanded");
    },
    requestChannelRestore(previousChannelId: string | null) {
      this.channelRestore = { previousChannelId };
    },
    clearChannelRestore() {
      this.channelRestore = null;
    },
    /**
     * Identity-session teardown: the selected channel/DM/thread belong to the
     * identity that selected them and must not be the next identity's starting
     * point. Layout preferences (sidebar collapsed) are device-level and
     * survive; the pane closes because clearing the panel closes it.
     */
    resetForSignOut() {
      this.selectedChannelId = null;
      this.selectedConversationId = null;
      this.contextPanel = { kind: "none" };
      this.channelRestore = null;
      this.threadExpanded = false;
    },
  },
});
