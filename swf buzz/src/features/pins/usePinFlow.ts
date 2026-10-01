import { ref } from "vue";
import { haptic } from "@/platform/haptics";
import { pushStatusToast } from "@/features/notifications/inAppToasts";
import type { Message } from "@/types/domain";
import type { ConversationPin } from "./useConversationPin";

/**
 * The pin interaction, shared by every conversation screen so desktop and
 * mobile behave identically:
 *   - no active pin → pin at once, then a small "Message pinned" toast;
 *   - a DIFFERENT message is pinned → ask "Replace pinned message?" first
 *     (an accidental replacement is the one pin mistake worth a dialog);
 *   - unpin → at once, "Message unpinned".
 * Failures surface as an error toast with the relay's own reason in
 * `pin.error` (shown inline by the screen).
 */
export function usePinFlow(pin: ConversationPin) {
  /** The message waiting on the replace confirmation, if any. */
  const confirmingReplace = ref<Message | null>(null);

  async function doPin(message: Message): Promise<void> {
    const ok = await pin.pin(message);
    if (ok) {
      haptic("success");
      pushStatusToast({ title: "Message pinned", icon: "pin" });
    } else if (pin.error.value) {
      pushStatusToast({ title: "Couldn't pin message", icon: "warning", tone: "error" });
    }
  }

  function requestPin(message: Message): void {
    if (!pin.canPin(message)) return;
    if (pin.replaces(message)) {
      confirmingReplace.value = message;
      return;
    }
    void doPin(message);
  }

  async function confirmReplace(): Promise<void> {
    const message = confirmingReplace.value;
    confirmingReplace.value = null;
    if (message) await doPin(message);
  }

  function cancelReplace(): void {
    confirmingReplace.value = null;
  }

  async function requestUnpin(): Promise<void> {
    const ok = await pin.unpin();
    if (ok) pushStatusToast({ title: "Message unpinned", icon: "pin-off" });
    else if (pin.error.value) pushStatusToast({ title: "Couldn't unpin message", icon: "warning", tone: "error" });
  }

  return { confirmingReplace, requestPin, confirmReplace, cancelReplace, requestUnpin };
}
