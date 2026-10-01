import { fetchEventsOnce } from "@/services/relayQuery";
import { isRenderableMessageKind, parseMessageEvent } from "@/protocol/messages";
import { RENDERABLE_MESSAGE_KINDS } from "@/protocol/kinds";
import { useReadStateStore } from "@/stores/readState";
import { countsAsUnread } from "./unreadPolicy";
import { messageMentionsMe } from "@/features/mentions/everyone";

/** A context never opened on any device: how far back its unread count looks. */
export const CATCH_UP_LOOKBACK_SECS = 7 * 24 * 60 * 60;
/** Per context. A badge past this is "a lot"; there is no need to fetch history to show it. */
export const CATCH_UP_LIMIT = 100;

/**
 * Startup catch-up: count what arrived in each channel and DM while the app was
 * closed. The live subscription only sees what happens after it opens, so
 * without this, offline arrivals never became unread (Master Spec §1, the
 * "second, opposite defect").
 *
 * Must run after the hydration gate: it compares against the synced frontier,
 * and a pre-hydration frontier may still move forward. Each context asks only
 * for events after its own frontier (`since = frontier + 1`, OLD BUZZ
 * `unread_catch_up`); a context with no frontier looks back
 * `CATCH_UP_LOOKBACK_SECS`. `recordUnseenMessage` dedupes by event id, so an
 * event the live subscription also delivered is counted once.
 */
export async function runUnreadCatchUp(
  contextIds: readonly string[],
  myPubkey: string,
  activeContextId: string | null,
  now: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  const readState = useReadStateStore();
  if (!readState.isReady) return;

  await Promise.all(
    contextIds
      .filter((id) => id !== activeContextId)
      .map(async (id) => {
        const frontier = readState.lastSeenFor(id);
        const since = frontier > 0 ? frontier + 1 : now - CATCH_UP_LOOKBACK_SECS;
        let events;
        try {
          events = await fetchEventsOnce([
            { kinds: [...RENDERABLE_MESSAGE_KINDS], "#h": [id], since, limit: CATCH_UP_LIMIT },
          ]);
        } catch {
          return; // one unreachable context must not cost the others their badges
        }
        for (const event of events) {
          if (!isRenderableMessageKind(event.kind)) continue;
          const message = parseMessageEvent(event);
          if (!countsAsUnread(message, myPubkey)) continue;
          readState.recordUnseenMessage(id, messageMentionsMe(message, myPubkey), event.id, event.created_at);
        }
      }),
  );
}
