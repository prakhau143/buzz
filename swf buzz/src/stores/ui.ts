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

/** Small, client-only UI preferences. Never store message/channel data here — that's Vue Query's job. */
export const useUiStore = defineStore("ui", {
  state: () => ({
    sidebarCollapsed: false,
    detailsPaneOpen: false,
    selectedChannelId: null as string | null,
    selectedConversationId: null as string | null,
    contextPanel: { kind: "none" } as ContextPanel,
  }),
  getters: {
    openThreadRootId: (state) => (state.contextPanel.kind === "thread" ? state.contextPanel.rootEventId : null),
  },
  actions: {
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    },
    toggleDetailsPane() {
      this.detailsPaneOpen = !this.detailsPaneOpen;
    },
    selectChannel(channelId: string | null) {
      this.selectedChannelId = channelId;
      this.selectedConversationId = null;
      this.contextPanel = { kind: "none" };
    },
    selectConversation(conversationId: string | null) {
      this.selectedConversationId = conversationId;
      this.selectedChannelId = null;
      this.contextPanel = { kind: "none" };
    },
    openThread(rootEventId: string) {
      this.contextPanel = { kind: "thread", rootEventId };
      this.detailsPaneOpen = true;
    },
    openProfile(pubkey: string) {
      this.contextPanel = { kind: "profile", pubkey };
      this.detailsPaneOpen = true;
    },
    openChannelDetails() {
      this.contextPanel = { kind: "channelDetails" };
      this.detailsPaneOpen = true;
    },
    closeContextPanel() {
      this.contextPanel = { kind: "none" };
    },
  },
});
