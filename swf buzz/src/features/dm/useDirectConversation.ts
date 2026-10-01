import { useRouter } from "vue-router";
import { useOpenDm } from "./useOpenDm";
import { dmService } from "./DmService";
import { buildWaveMessageContent } from "./wave";

/**
 * The one way to start or resume a 1:1 conversation with someone.
 *
 * Every "Message" action goes through here so they cannot drift: the raw
 * hex-pubkey box that used to sit in the sidebar was a second, parallel entry
 * point with its own validation and its own navigation, and it asked people to
 * paste key material to reach something the member list already knows.
 *
 * Deduplication is the relay's job, not ours — kind:41010 is find-or-create on
 * the participant set (`crates/buzz-db/src/store/dm.rs:358-390`), so opening an
 * existing conversation returns that same channel id rather than a second one.
 * See docs/PHASE_4_OLD_BUZZ_PROTOCOL_AUDIT.md §6.3.
 */
export function useDirectConversation() {
  const router = useRouter();
  const { open, isOpening } = useOpenDm();

  /** Opens (or reuses) the conversation with `pubkey` and navigates to it. */
  async function openDirectConversation(pubkey: string): Promise<string> {
    const conversationId = await open([pubkey]);
    await router.push({ name: "dm", query: { conversationId } });
    return conversationId;
  }

  /**
   * Wave at someone, as OLD BUZZ does: resolve the SAME 1:1 DM (kind:41010 is
   * find-or-create on the participant set), open it, and send the wave marker
   * message there as an ordinary kind:9.
   */
  async function waveAt(pubkey: string, senderName: string): Promise<string> {
    const conversationId = await openDirectConversation(pubkey);
    await dmService.sendMessage(conversationId, buildWaveMessageContent(senderName));
    return conversationId;
  }

  return { openDirectConversation, waveAt, isOpening };
}
