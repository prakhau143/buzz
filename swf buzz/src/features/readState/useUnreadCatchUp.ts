import { computed, watch, type MaybeRefOrGetter, toValue } from "vue";
import { useSessionStore } from "@/stores/session";
import { useReadStateStore } from "@/stores/readState";
import { useChannels } from "@/features/channels/useChannels";
import { useDmList } from "@/features/dm/useDmList";
import { sidebarChannels } from "@/features/channels/channelVisibility";
import { activeRelayUrl } from "@/features/communities/relayCommunities";
import { runUnreadCatchUp } from "./unreadCatchUp";

/**
 * Startup catch-up, once per identity + community, after the hydration gate:
 * counts what arrived while the app was closed (Master Spec §1).
 *
 * Shared by every surface that lists conversations (the desktop sidebar and the
 * mobile Home), so whichever mounts first runs it and neither runs it twice.
 */
let caughtUpFor: string | null = null;

export function useUnreadCatchUp(activeId: MaybeRefOrGetter<string | null>) {
  const session = useSessionStore();
  const readState = useReadStateStore();
  const { data: channels } = useChannels();
  const { data: conversations } = useDmList();
  const visibleChannels = computed(() => sidebarChannels(channels.value));

  watch(
    () => [readState.isReady, visibleChannels.value, conversations.value] as const,
    ([ready, chans, dms]) => {
      const me = session.pubkey;
      if (!ready || !me || !chans || !dms) return;
      const key = `${me}|${activeRelayUrl.value}`;
      if (caughtUpFor === key) return;
      caughtUpFor = key;
      const ids = [...chans.map((c) => c.id), ...dms.map((d) => d.id)];
      void runUnreadCatchUp(ids, me, toValue(activeId));
    },
    { immediate: true },
  );
}
