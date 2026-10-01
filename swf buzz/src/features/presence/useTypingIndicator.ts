import { onUnmounted, ref, watch, type MaybeRefOrGetter, toValue } from "vue";
import { typingService } from "./TypingService";
import { TYPING_THROTTLE_MS } from "@/protocol/typing";
import { useSessionStore } from "@/stores/session";
import { logError } from "@/services/errors";

/** How long a typing signal is considered "still typing" without a follow-up. */
const TYPING_EXPIRY_MS = 5000;

export function useTypingIndicator(channelId: MaybeRefOrGetter<string | null>) {
  const session = useSessionStore();
  const typingPubkeys = ref<string[]>([]);
  const expiry = new Map<string, ReturnType<typeof setTimeout>>();

  let liveSub: ReturnType<typeof typingService.subscribe> | null = null;
  let lastNotifyAt = 0;

  function setTyping(pubkey: string): void {
    if (!typingPubkeys.value.includes(pubkey)) {
      typingPubkeys.value = [...typingPubkeys.value, pubkey];
    }
    const existing = expiry.get(pubkey);
    if (existing) clearTimeout(existing);
    expiry.set(
      pubkey,
      setTimeout(() => {
        typingPubkeys.value = typingPubkeys.value.filter((p) => p !== pubkey);
        expiry.delete(pubkey);
      }, TYPING_EXPIRY_MS),
    );
  }

  /** Cancels every pending expiry. Shared by channel switch and unmount. */
  function clearExpiryTimers(): void {
    for (const timer of expiry.values()) clearTimeout(timer);
    expiry.clear();
  }

  function resubscribe(id: string | null): void {
    liveSub?.close();
    liveSub = null;
    typingPubkeys.value = [];
    // Without this the previous channel's expiry timers stay armed for up to
    // TYPING_EXPIRY_MS after the switch, holding Map entries alive with them.
    // The visible list survives either way — a stale timer filters a pubkey
    // that is usually absent, and `setTyping` happens to clear it when the same
    // person types again — so this is a resource leak rather than a rendering
    // bug, which is exactly why it needs an explicit test rather than an
    // assertion about what is on screen.
    clearExpiryTimers();
    if (!id) return;
    liveSub = typingService.subscribe(id, (event) => {
      if (event.pubkey === session.pubkey) return;
      setTyping(event.pubkey);
    });
  }

  watch(
    () => toValue(channelId),
    (id) => resubscribe(id),
    { immediate: true },
  );
  onUnmounted(() => {
    liveSub?.close();
    clearExpiryTimers();
  });

  function notifyTyping(): void {
    const id = toValue(channelId);
    if (!id) return;
    const now = Date.now();
    if (now - lastNotifyAt < TYPING_THROTTLE_MS) return;
    lastNotifyAt = now;
    typingService.notify(id).catch((err) => logError("useTypingIndicator.notifyTyping", err));
  }

  return { typingPubkeys, notifyTyping };
}
