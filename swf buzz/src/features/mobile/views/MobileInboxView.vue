<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppIcon from "@/components/AppIcon.vue";
import MessagePreview from "@/features/mentions/MessagePreview";
import { mentionTagsOf } from "@/features/mentions/messageTokens";
import AvatarCircle from "@/components/AvatarCircle.vue";
import StateView from "@/components/StateView.vue";
import MobileLayout from "../ui/MobileLayout.vue";
import MobileHeader from "../ui/MobileHeader.vue";
import MobileListSkeleton from "../ui/MobileListSkeleton.vue";
import { useInboxFeed } from "@/features/inbox/useInboxFeed";
import { EMPTY_STATE, INBOX_FILTERS, matchesFilter, type InboxFilter, type InboxItem } from "@/features/inbox/inboxModel";
import { useChannels } from "@/features/channels/useChannels";
import { useProfileMap } from "@/composables/useProfile";
import { fromInboxItem } from "@/features/navigation/messageTarget";
import { useOpenMessageTarget } from "@/features/navigation/useOpenMessageTarget";
import { badgeText, groupByDay, inboxPreview, inboxVerb, inboxWhere, shortTime } from "../inboxPresentation";

/**
 * Mobile Inbox — a phone presentation of the ONE Inbox feed (`useInboxFeed`):
 * the same relay categories, merge, filters (`INBOX_FILTERS` / `matchesFilter`),
 * empty states and NIP-RS read state as the desktop Inbox. Nothing is computed
 * here that the feed doesn't already decide.
 *
 * Opening a row: the feed's own read rule (`markRead`, which only advances the
 * synced frontier), then THE deep-link opener with the row's `MessageTarget`
 * (C2) — exact message, thread reply or DM. Rows without a conversation are not
 * actionable. The filter lives in `?f=` so coming back restores it.
 */
const route = useRoute();
const router = useRouter();
const feed = useInboxFeed();
const { data: channels } = useChannels();
const { openMessageTarget } = useOpenMessageTarget();

const filter = computed<InboxFilter>(() => {
  const f = route.query?.f;
  return INBOX_FILTERS.some((x) => x.value === f) ? (f as InboxFilter) : "all";
});
function pickFilter(value: InboxFilter) {
  if (value === filter.value) return;
  void router.replace({ query: value === "all" ? {} : { f: value } });
}

const visible = computed(() => feed.items.value.filter((i) => matchesFilter(i, filter.value)));
const groups = computed(() => groupByDay(visible.value));
const unreadIn = (f: InboxFilter) => feed.items.value.filter((i) => matchesFilter(i, f) && feed.unread(i)).length;
const unreadVisible = computed(() => visible.value.filter((i) => feed.unread(i)).length);
const unreadAll = computed(() => unreadIn("all"));

// One batched profile lookup for every sender on screen.
const senders = computed(() => feed.items.value.map((i) => i.event.pubkey));
const { profiles, displayNames } = useProfileMap(senders);
const nameOf = (pubkey: string) => displayNames.value.get(pubkey) ?? pubkey.slice(0, 8);
const channelName = (id: string | null) => (id ? (channels.value?.find((c) => c.id === id)?.name ?? null) : null);

const opens = (item: InboxItem) => fromInboxItem(item) !== null;
const hasItems = computed(() => feed.items.value.length > 0);
const empty = computed(() => EMPTY_STATE[filter.value]);

function rowLabel(item: InboxItem): string {
  const where = inboxWhere(item, channelName(item.channelId));
  return [
    `${nameOf(item.event.pubkey)} ${inboxVerb(item)}${where ? ` in ${where}` : ""}`,
    shortTime(item.createdAt),
    feed.unread(item) ? "unread" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Pull-to-refresh: the feed's own refetch; any category failing reports as a failed refresh. */
async function refreshInbox() {
  await feed.refetch();
  if (feed.isError.value || feed.partialError.value) throw new Error("refresh failed");
}

async function open(item: InboxItem) {
  const target = fromInboxItem(item);
  if (!target) return;
  feed.markRead(item);
  await openMessageTarget(target);
}
</script>

<template>
  <MobileLayout show-nav :refresh="refreshInbox">
    <template #header>
      <MobileHeader title="Inbox" :subtitle="unreadAll ? `${unreadAll} unread` : null">
        <template #actions>
          <button
            v-if="hasItems"
            type="button"
            class="m-icon-btn"
            aria-label="Mark all as read"
            :disabled="!unreadVisible"
            data-testid="inbox-mark-all"
            @click="feed.markAllRead(visible)"
          >
            <AppIcon name="check" :size="24" />
          </button>
        </template>
      </MobileHeader>
      <div class="filters" role="tablist" aria-label="Inbox filters" data-hscroll data-testid="inbox-filters">
        <button
          v-for="f in INBOX_FILTERS"
          :key="f.value"
          type="button"
          role="tab"
          class="chip-hit"
          :aria-selected="filter === f.value"
          :data-testid="`inbox-chip-${f.value}`"
          @click="pickFilter(f.value)"
        >
          <span class="chip" :class="{ active: filter === f.value }">
            {{ f.label }}
            <span v-if="unreadIn(f.value)" class="chip-count" data-testid="inbox-chip-count">
              <span class="visually-hidden">, </span>{{ badgeText(unreadIn(f.value)) }}<span class="visually-hidden"> unread</span>
            </span>
          </span>
        </button>
      </div>
    </template>

    <MobileListSkeleton v-if="feed.isLoading.value && !hasItems" label="Loading inbox" />
    <StateView
      v-else-if="feed.isError.value && !hasItems"
      kind="error"
      title="Unable to load Inbox"
      description="Check your connection and try again."
      data-testid="inbox-error"
      @retry="feed.refetch()"
    />
    <template v-else>
      <p v-if="feed.partialError.value" class="partial" role="status" data-testid="inbox-partial">
        Some items couldn't be loaded.
        <button type="button" class="partial-retry" @click="feed.refetch()">Retry</button>
      </p>
      <div v-if="!visible.length" class="empty" data-testid="inbox-empty">
        <span class="empty-icon" aria-hidden="true"><AppIcon name="check" :size="24" /></span>
        <p class="empty-title">{{ empty.title }}</p>
        <p class="empty-sub">{{ empty.description }}</p>
      </div>
      <section v-for="group in groups" :key="group.key" class="day" :aria-label="group.label">
        <h2 class="day-label">{{ group.label }}</h2>
        <ul class="rows" data-testid="mobile-inbox-list">
          <li v-for="item in group.items" :key="item.key">
            <button
              type="button"
              class="row"
              :class="{ unread: feed.unread(item) }"
              :disabled="!opens(item)"
              :aria-label="rowLabel(item)"
              data-testid="mobile-inbox-row"
              @click="open(item)"
            >
              <AvatarCircle
                :name="nameOf(item.event.pubkey)"
                :avatar-url="profiles.get(item.event.pubkey)?.avatarUrl"
                :pubkey="item.event.pubkey"
                :size="40"
              />
              <span class="text">
                <span class="line1">
                  <span class="who">{{ nameOf(item.event.pubkey) }}</span>
                  <span class="when">{{ shortTime(item.createdAt) }}</span>
                </span>
                <span class="what">
                  {{ inboxVerb(item) }}
                  <template v-if="inboxWhere(item, channelName(item.channelId))">
                    in <span class="where">{{ inboxWhere(item, channelName(item.channelId)) }}</span>
                  </template>
                </span>
                <span v-if="inboxPreview(item.event.content)" class="preview" data-testid="inbox-row-preview"
                  ><MessagePreview
                    :content="item.event.content"
                    :mentions="mentionTagsOf(item.event).mentions"
                    :mentions-everyone="mentionTagsOf(item.event).everyone"
                /></span>
                <span v-if="item.count > 1" class="more">{{ item.count }} messages</span>
              </span>
              <span v-if="feed.unread(item)" class="unread-dot" aria-hidden="true" data-testid="inbox-unread-dot" />
            </button>
          </li>
        </ul>
      </section>
    </template>
  </MobileLayout>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 2px;
  padding: 0 var(--space-3);
  overflow-x: auto;
  scrollbar-width: none;
  overscroll-behavior-x: contain;
}
.filters::-webkit-scrollbar {
  display: none;
}
/* A 44px touch target around a compact pill. */
.chip-hit {
  flex: none;
  min-height: 44px;
  padding: 4px 2px;
  border: none;
  background: none;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.chip {
  /* Positioned, so its visually-hidden text stays inside the scrolling row. */
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 600;
  white-space: nowrap;
  transition: background 120ms ease, color 120ms ease;
}
.chip.active {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.chip-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--color-primary-muted);
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.chip.active .chip-count {
  background: color-mix(in srgb, var(--color-on-primary) 22%, transparent);
  color: var(--color-on-primary);
}
.chip-hit:focus-visible {
  outline: none;
}
.chip-hit:focus-visible .chip {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}

.partial {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: var(--space-2) var(--space-4) 0;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-warning-muted);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}
.partial-retry {
  min-height: 44px;
  min-width: 44px;
  padding: 0 var(--space-3);
  border: none;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-weight: 700;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-8, 3rem) var(--space-6, 2rem);
  text-align: center;
}
.empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-primary-muted);
  color: var(--color-primary);
}
.empty-title {
  margin: 0;
  font-weight: 700;
}
.empty-sub {
  margin: 0;
  max-width: 280px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.day-label {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: var(--space-3) var(--space-4) var(--space-1);
  background: var(--color-bg);
  color: var(--color-text-subtle);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  position: relative;
  width: 100%;
  min-height: 76px;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.row.unread {
  background: color-mix(in srgb, var(--color-primary) 6%, transparent);
}
/* Read / unread changes ease rather than snap. */
.row {
  transition: background-color 240ms ease;
}
.row:active:not(:disabled) {
  background: var(--color-surface-muted);
}
.row:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
.row:disabled {
  cursor: default;
  opacity: 0.72;
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.line1 {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.row.unread .who {
  font-weight: 800;
}
.when {
  flex: none;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  font-variant-numeric: tabular-nums;
}
.row.unread .when {
  color: var(--color-primary);
  font-weight: 700;
}
.what {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.where {
  color: var(--color-text);
  font-weight: 600;
}
.preview {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.row.unread .preview {
  color: var(--color-text);
}
.more {
  align-self: flex-start;
  margin-top: 2px;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.unread-dot {
  position: absolute;
  top: 50%;
  left: 6px;
  width: 6px;
  height: 6px;
  margin-top: -3px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .chip,
  .row {
    transition: none;
  }
}
</style>
