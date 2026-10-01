import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useSessionStore } from "@/stores/session";
import { useNotificationSettings } from "@/features/notifications/notificationSettings";
import { useInboxFeed } from "./useInboxFeed";

/**
 * The Inbox badge (OLD BUZZ): unread mentions + needs-action + reminders, from
 * the same feed and read state as the Inbox itself; 0 while the Inbox is open
 * or when the user turned the badge off. One rule for the desktop sidebar and
 * the mobile bottom navigation.
 */
export function useInboxBadge(inboxOpen: MaybeRefOrGetter<boolean>) {
  const session = useSessionStore();
  const { settings } = useNotificationSettings(() => session.pubkey);
  const feed = useInboxFeed();
  return computed(() =>
    toValue(inboxOpen) || !settings.value.homeBadge
      ? 0
      : feed.items.value.filter(
          (i) => (i.mentionsMe || i.type === "needs_action" || i.type === "reminder") && feed.unread(i),
        ).length,
  );
}
