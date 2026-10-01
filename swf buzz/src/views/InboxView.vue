<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppShell from "@/layouts/AppShell.vue";
import AppSidebar from "@/layouts/AppSidebar.vue";
import UserProfilePanel from "@/features/channels/ui/UserProfilePanel.vue";
import InboxListPane from "@/features/inbox/ui/InboxListPane.vue";
import InboxDetailPane from "@/features/inbox/ui/InboxDetailPane.vue";
import { useInboxFeed } from "@/features/inbox/useInboxFeed";
import { contextLabel, detailTitle, matchesFilter, type InboxFilter, type InboxItem } from "@/features/inbox/inboxModel";
import { useChannels } from "@/features/channels/useChannels";
import { useProfileMap } from "@/composables/useProfile";
import { shortKey } from "@/features/identity/format";
import { useUiStore } from "@/stores/ui";
import PanelResizeHandle from "@/features/layout/ui/PanelResizeHandle.vue";
import { INBOX_DETAIL_MIN_WIDTH, availableMax, usePanelWidth } from "@/features/layout/panelSizing";

/**
 * The Inbox workspace — a route, not a modal (docs/OLD_BUZZ_INBOX_AUDIT.md §1-§2):
 *
 *   app sidebar | inbox list (resizable) | detail | optional profile (AppShell details pane)
 *
 * - The selected row lives in the URL (`?item=`), so back/forward and reload keep it.
 * - Wide: the first visible row is selected automatically. Narrow (< 600 px of
 *   workspace width, measured on the workspace itself): list OR detail, with Back.
 * - Selecting a row marks it read through the real read state; "Open in channel"
 *   jumps to the source message (`messageId`, `threadRootId`).
 * - The filter is session-only, as in OLD BUZZ (it resets on reload).
 */
const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const feed = useInboxFeed();
const { data: channels } = useChannels();

const filter = ref<InboxFilter>("all");
const unreadOnly = ref(false);

// OLD BUZZ: with "Show unread only" on, the selected conversation stays visible
// even after it has been read (it doesn't vanish from under the reader).
const visible = computed(() =>
  feed.items.value.filter(
    (i) => matchesFilter(i, filter.value) && (!unreadOnly.value || feed.unread(i) || i.key === selectedKey.value),
  ),
);
const unreadVisibleCount = computed(() => visible.value.filter((i) => feed.unread(i)).length);

const senders = computed(() => feed.items.value.map((i) => i.event.pubkey));
const { profiles, displayNames } = useProfileMap(senders);
const senderName = (pubkey: string) => displayNames.value.get(pubkey) ?? shortKey(pubkey);
const senderAvatar = (pubkey: string) => profiles.value.get(pubkey)?.avatarUrl ?? undefined;
const channelName = (id: string | null) => (id ? (channels.value?.find((c) => c.id === id)?.name ?? null) : null);
const context = (item: InboxItem) => contextLabel(item, channelName(item.channelId), senderName(item.event.pubkey));

// ---- selection (URL-backed) ----
const selectedKey = computed(() => (typeof route.query.item === "string" ? route.query.item : null));
const selected = computed(() => feed.items.value.find((i) => i.key === selectedKey.value) ?? null);

function select(item: InboxItem) {
  if (item.key !== selectedKey.value) void router.replace({ query: { ...route.query, item: item.key } });
  if (feed.unread(item)) feed.markRead(item);
}

// ---- layout: narrow mode + resizable list ----
const workspace = ref<HTMLElement | null>(null);
const width = ref(Number.POSITIVE_INFINITY);
/** Nothing is auto-selected until the workspace has been measured (a narrow window must not open a row). */
const measured = ref(false);
const narrow = computed(() => width.value < 600);
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  const el = workspace.value;
  if (el && el.clientWidth > 0) width.value = el.clientWidth;
  if (el && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(([entry]) => (width.value = entry.contentRect.width));
    resizeObserver.observe(el);
  }
  measured.value = true;
});
onBeforeUnmount(() => resizeObserver?.disconnect());

// Wide layouts open on the first row (OLD BUZZ); narrow ones start at the list.
// Only when nothing valid is selected: a row that merely left the visible list
// (e.g. read while "unread only" is on) stays selected — re-selecting the next
// one here would mark it read too and cascade through the whole inbox.
watch(
  [visible, narrow, measured],
  ([rows, isNarrow, isMeasured]) => {
    if (!isMeasured || isNarrow || !rows.length) return;
    if (filter.value === "reminders") return;
    const stillExists = !!selectedKey.value && feed.items.value.some((r) => r.key === selectedKey.value);
    if (!stillExists) select(rows[0]);
  },
  { immediate: true },
);
// On a filter change (OLD BUZZ `handleFilterChange`): keep the selection if it
// is still visible; otherwise open the first row (wide only). Reminders starts
// with nothing selected.
watch(filter, (next) => {
  if (next === "reminders") return backToList();
  if (selectedKey.value && visible.value.some((r) => r.key === selectedKey.value)) return;
  if (!narrow.value && visible.value.length) select(visible.value[0]);
  else backToList();
});

// The list/detail divider: the shared vertical resizer (docs/PANEL_RESIZE_IMPLEMENTATION.md).
const listPanel = usePanelWidth("inboxList");
/** Never let the list squeeze the detail column below its floor. */
const listMax = computed(() => availableMax("inboxList", width.value, INBOX_DETAIL_MIN_WIDTH));
const listWidth = computed(() => Math.min(listPanel.width.value, listMax.value));

// ---- actions ----
function backToList() {
  const query = { ...route.query };
  delete query.item;
  void router.replace({ query });
}

/** To the real source: the channel or DM, with the message (and thread) to reveal. */
function openSource(item: InboxItem) {
  if (!item.channelId) return;
  const target = { messageId: item.event.id, ...(item.rootId ? { threadRootId: item.rootId } : {}) };
  void router.push(
    item.type === "dm"
      ? { name: "dm", query: { conversationId: item.channelId, ...target } }
      : { name: "channels", query: { channelId: item.channelId, ...target } },
  );
}

const showList = computed(() => !narrow.value || !selected.value);
const showDetail = computed(() => !!selected.value);
</script>

<template>
  <AppShell>
    <template #sidebar>
      <AppSidebar inbox-active />
    </template>

    <template #main>
      <div
        ref="workspace"
        class="inbox-workspace"
        :class="{ narrow }"
        :style="{ '--inbox-list-width': `${listWidth}px` }"
        data-testid="inbox-workspace"
      >
        <div v-if="showList" class="list-column">
          <InboxListPane
            v-model:filter="filter"
            v-model:unread-only="unreadOnly"
            :items="visible"
            :unread-count="unreadVisibleCount"
            :selected-key="selectedKey"
            :is-unread="feed.unread"
            :sender-name="senderName"
            :sender-avatar="senderAvatar"
            :context="context"
            :is-loading="feed.isLoading.value"
            :is-error="feed.isError.value"
            :partial-error="feed.partialError.value"
            @select="select"
            @mark-read="feed.markRead"
            @mark-unread="feed.markUnread"
            @mark-all-read="feed.markAllRead(visible)"
            @open-source="openSource"
            @open-profile="ui.openProfile"
            @retry="feed.refetch"
          />
        </div>

        <PanelResizeHandle
          v-if="!narrow"
          class="inbox-handle"
          edge="end"
          label="Resize inbox list"
          :width="listWidth"
          :min="listPanel.spec.min"
          :max="listMax"
          data-testid="inbox-resize"
          @resize="listPanel.set"
          @commit="listPanel.commit"
          @reset="listPanel.reset"
        />

        <div v-if="!narrow || showDetail" class="detail-column">
          <InboxDetailPane
            v-if="selected"
            :key="selected.key"
            :item="selected"
            :title="detailTitle(selected, channelName(selected.channelId), senderName(selected.event.pubkey))"
            :narrow="narrow"
            @back="backToList"
            @open-source="openSource(selected)"
            @open-profile="ui.openProfile"
          />
          <div v-else-if="!narrow" class="detail-placeholder">
            <p>{{ feed.isLoading.value ? "" : "Select an item to see the conversation." }}</p>
          </div>
        </div>
      </div>
    </template>

    <template #details>
      <UserProfilePanel
        v-if="ui.contextPanel.kind === 'profile'"
        :pubkey="ui.contextPanel.pubkey"
        @close="ui.closeContextPanel()"
      />
    </template>
  </AppShell>
</template>

<style scoped>
.inbox-workspace {
  position: relative;
  display: grid;
  grid-template-columns: var(--inbox-list-width) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--color-bg);
}
.inbox-workspace.narrow {
  grid-template-columns: minmax(0, 1fr);
}
.list-column,
.detail-column {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.list-column {
  background: var(--color-surface);
}
.inbox-workspace:not(.narrow) .list-column {
  border-right: 1px solid var(--color-border);
}
/* Over the list's right border; takes no grid cell. */
.inbox-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--inbox-list-width) - 4px);
}
.detail-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-subtle);
  font-size: var(--font-size-sm);
}
</style>
