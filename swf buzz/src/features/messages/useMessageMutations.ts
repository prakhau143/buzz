/**
 * Edit and delete a channel message (Phase 4B).
 *
 * Both are optimistic: the overlay is applied locally the moment the user
 * confirms, then reconciled against what the relay actually accepted. On
 * refusal the optimistic overlay is rolled back and the relay's own words are
 * surfaced — a generic "couldn't delete" turned a precise server reason into a
 * guessing game twice already in this codebase.
 */
import { ref } from "vue";
import { messageService } from "./MessageService";
import {
  applyDelete,
  applyEdit,
  type DeleteOverlay,
  type EditOverlay,
  type MessageOverlays,
} from "./messageOverlay";
import { logError, userMessageFor } from "@/services/errors";

export function useMessageMutations(params: {
  overlays: () => MessageOverlays;
  /** Called after any local overlay change so the timeline re-renders. */
  touch: () => void;
}) {
  const isEditing = ref(false);
  const isDeleting = ref(false);
  const error = ref<string | null>(null);

  async function editMessage(input: {
    channelId: string;
    targetEventId: string;
    content: string;
    authorPubkey: string;
    mentionPubkeys?: string[];
    /** Re-assert the original `@everyone` when the edited text still says it. */
    mentionsEveryone?: boolean;
  }): Promise<boolean> {
    const trimmed = input.content.trim();
    if (!trimmed) return false;

    const overlays = params.overlays();
    const previous = overlays.edits.get(input.targetEventId);
    isEditing.value = true;
    error.value = null;

    // Optimistic: show the new text immediately, timestamped now so it wins
    // over any older edit already held.
    applyEdit(overlays, {
      eventId: `optimistic-${input.targetEventId}`,
      targetId: input.targetEventId,
      authorPubkey: input.authorPubkey,
      content: trimmed,
      createdAt: Math.floor(Date.now() / 1000),
    });
    params.touch();

    try {
      const confirmed = await messageService.edit({
        channelId: input.channelId,
        targetEventId: input.targetEventId,
        content: trimmed,
        mentionPubkeys: input.mentionPubkeys,
        mentionsEveryone: input.mentionsEveryone,
      });
      // Replace the placeholder with the signed event unconditionally: it
      // carries the real event id and the relay's own created_at, which is what
      // other clients will order against.
      overlays.edits.set(input.targetEventId, confirmed);
      params.touch();
      return true;
    } catch (err) {
      logError("useMessageMutations.edit", err);
      rollbackEdit(overlays, input.targetEventId, previous);
      params.touch();
      error.value = userMessageFor(err);
      return false;
    } finally {
      isEditing.value = false;
    }
  }

  async function deleteMessage(input: {
    channelId: string;
    targetEventId: string;
    mode: "self" | "admin";
    myPubkey: string;
  }): Promise<boolean> {
    const overlays = params.overlays();
    const previous = overlays.deletes.get(input.targetEventId);
    isDeleting.value = true;
    error.value = null;

    applyDelete(overlays, {
      targetId: input.targetEventId,
      authorPubkey: input.myPubkey,
      isAdminDelete: input.mode === "admin",
    });
    params.touch();

    try {
      await messageService.remove({
        channelId: input.channelId,
        targetEventId: input.targetEventId,
        mode: input.mode,
      });
      return true;
    } catch (err) {
      logError("useMessageMutations.delete", err);
      rollbackDelete(overlays, input.targetEventId, previous);
      params.touch();
      error.value = userMessageFor(err);
      return false;
    } finally {
      isDeleting.value = false;
    }
  }

  return { editMessage, deleteMessage, isEditing, isDeleting, error };
}

function rollbackEdit(
  overlays: MessageOverlays,
  targetId: string,
  previous: EditOverlay | undefined,
): void {
  if (previous) overlays.edits.set(targetId, previous);
  else overlays.edits.delete(targetId);
}

function rollbackDelete(
  overlays: MessageOverlays,
  targetId: string,
  previous: DeleteOverlay | undefined,
): void {
  if (previous) overlays.deletes.set(targetId, previous);
  else overlays.deletes.delete(targetId);
}
