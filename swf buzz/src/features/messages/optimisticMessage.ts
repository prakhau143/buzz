import type { Message } from "@/types/domain";

/**
 * Replaces an optimistic "sending" entry with the real published message.
 * Guards against a real race: the relay can echo the published event back
 * through the live subscription before `publish()`'s promise resolves
 * locally, which would otherwise add `sent` a second time alongside the
 * optimistic entry. If that already happened, this just drops the
 * optimistic placeholder instead of inserting a duplicate.
 */
export function reconcileOptimisticMessage(
  current: Message[] | undefined,
  optimisticId: string,
  sent: Message,
): Message[] {
  const list = current ?? [];
  if (list.some((m) => m.id === sent.id)) {
    return list.filter((m) => m.id !== optimisticId);
  }
  return list.map((m) => (m.id === optimisticId ? sent : m));
}
