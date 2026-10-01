import { sidebarChannels } from "@/features/channels/channelVisibility";
import type { Channel } from "@/types/domain";

/**
 * Where a community switch lands, once the NEW community's channel list is in.
 *
 * The previous selection belonged to the previous community, so it is only
 * kept when the new community lists a channel with that same id; otherwise the
 * first channel the sidebar lists is opened. `null` when the new community
 * lists none — the view then shows its own empty state.
 *
 * Matching by id, never by name: two communities can both have "#welcome".
 */
export function channelAfterCommunitySwitch(
  channels: readonly Channel[] | null | undefined,
  previousChannelId: string | null,
): string | null {
  const listed = sidebarChannels(channels);
  if (previousChannelId && listed.some((c) => c.id === previousChannelId)) return previousChannelId;
  return listed[0]?.id ?? null;
}
