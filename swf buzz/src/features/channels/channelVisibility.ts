import type { Channel } from "@/types/domain";

/**
 * Which channels belong in the sidebar. The relay is the authority on archive
 * state; the client never deletes or archives anything to make a channel go
 * away — it only stops listing what the relay says is archived.
 *
 * Huddles. SWF does not implement huddles. An OLD BUZZ huddle runs in an
 * ordinary temporary channel (kind:9007 with `ttl`, arbitrary name —
 * desktop `src-tauri/src/huddle/mod.rs:181-231`) that the relay archives when
 * the huddle ends, when its last participant leaves, or when its TTL reaper
 * fires (39000 `archived=true`). OLD BUZZ additionally hides a huddle channel
 * while it is still LIVE, but only by remembering ids its own huddle client
 * created or joined (`huddleBackingChannelStorage.ts`) — nothing on the relay
 * marks a channel as a huddle's. So:
 *   - every ENDED huddle channel is hidden here, live and across restarts,
 *     because it is archived;
 *   - a huddle that is still running is indistinguishable from any other
 *     temporary channel without the huddle event protocol (kinds 48100-48106),
 *     which SWF deliberately does not implement. It disappears the moment the
 *     relay archives it. Guessing from the name would hide real channels.
 *
 * Temporary (TTL) channels that are not archived stay visible, as in OLD BUZZ.
 * DMs are not channels here: they have their own sidebar section.
 */
export function isSidebarChannel(channel: Channel): boolean {
  if (channel.archived) return false;
  return channel.channelType !== "dm";
}

export function sidebarChannels(channels: readonly Channel[] | null | undefined): Channel[] {
  return (channels ?? []).filter(isSidebarChannel);
}
