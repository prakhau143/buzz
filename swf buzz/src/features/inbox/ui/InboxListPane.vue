<script setup lang="ts">
import { computed, ref } from "vue";
import AnchoredPopover from "@/components/AnchoredPopover.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import AppIcon from "@/components/AppIcon.vue";
import MessagePreview from "@/features/mentions/MessagePreview";
import { mentionTagsOf } from "@/features/mentions/messageTokens";
import { relativeTime } from "@/features/identity/format";
import { EMPTY_STATE, INBOX_FILTERS, type InboxFilter, type InboxItem } from "../inboxModel";

/**
 * The Inbox list column (OLD BUZZ `InboxListPane` + `InboxRow`): a compact
 * header — filter dropdown on the left, "⋯" options on the right, no big
 * title — over the only scrolling region of this column.
 */
const props = defineProps<{
  items: InboxItem[];
  filter: InboxFilter;
  unreadOnly: boolean;
  unreadCount: number;
  selectedKey: string | null;
  isUnread: (item: InboxItem) => boolean;
  senderName: (pubkey: string) => string;
  senderAvatar: (pubkey: string) => string | undefined;
  context: (item: InboxItem) => string;
  isLoading: boolean;
  isError: boolean;
  partialError: boolean;
}>();
const emit = defineEmits<{
  "update:filter": [filter: InboxFilter];
  "update:unreadOnly": [value: boolean];
  select: [item: InboxItem];
  "mark-read": [item: InboxItem];
  "mark-unread": [item: InboxItem];
  "mark-all-read": [];
  "open-source": [item: InboxItem];
  "open-profile": [pubkey: string];
  retry: [];
}>();

const filterButton = ref<HTMLElement | null>(null);
const optionsButton = ref<HTMLElement | null>(null);
const menu = ref<"filter" | "options" | null>(null);
const contextFor = ref<{ item: InboxItem; anchor: HTMLElement } | null>(null);

const filterLabel = computed(() => INBOX_FILTERS.find((f) => f.value === props.filter)?.label ?? "All");
const empty = computed(() => EMPTY_STATE[props.filter]);

function pickFilter(value: InboxFilter) {
  emit("update:filter", value);
  menu.value = null;
}

function openContext(event: MouseEvent, item: InboxItem) {
  event.preventDefault();
  contextFor.value = { item, anchor: event.currentTarget as HTMLElement };
}

function onRowKey(event: KeyboardEvent, item: InboxItem) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    emit("select", item);
  }
}

/** Has preview text at all (else "(no text)"); the preview itself is semantic tokens (`MessagePreview`). */
function hasText(item: InboxItem): boolean {
  return !!item.event.content.replace(/<!--[\s\S]*?-->/g, "").trim();
}
</script>

<template>
  <section class="list-pane" aria-label="Inbox list">
    <header class="list-header">
      <button
        ref="filterButton"
        type="button"
        class="filter-trigger"
        aria-haspopup="menu"
        :aria-expanded="menu === 'filter'"
        data-testid="inbox-filter"
        @click="menu = menu === 'filter' ? null : 'filter'"
      >
        {{ filterLabel }} <span class="caret" aria-hidden="true">▾</span>
      </button>
      <button
        ref="optionsButton"
        type="button"
        class="icon-btn"
        aria-label="Inbox options"
        title="Inbox options"
        aria-haspopup="menu"
        :aria-expanded="menu === 'options'"
        data-testid="inbox-options"
        @click="menu = menu === 'options' ? null : 'options'"
      >
        ⋯
      </button>
    </header>

    <AnchoredPopover v-if="menu === 'filter'" :anchor="filterButton" side="right" align="start" label="Filter inbox" :width="200" @close="menu = null">
      <template v-for="f in INBOX_FILTERS" :key="f.value">
        <div v-if="f.separatorBefore" class="menu-divider" />
        <button
          type="button"
          role="menuitemradio"
          :aria-checked="filter === f.value"
          class="menu-item"
          :class="{ active: filter === f.value }"
          :data-testid="`inbox-filter-${f.value}`"
          @click="pickFilter(f.value)"
        >
          <span class="check" aria-hidden="true">{{ filter === f.value ? "✓" : "" }}</span>{{ f.label }}
        </button>
      </template>
    </AnchoredPopover>

    <AnchoredPopover v-if="menu === 'options'" :anchor="optionsButton" side="right" align="start" label="Inbox options" :width="240" @close="menu = null">
      <button
        type="button"
        role="menuitemcheckbox"
        :aria-checked="unreadOnly"
        class="menu-item"
        data-testid="inbox-unread-only"
        @click="emit('update:unreadOnly', !unreadOnly)"
      >
        <span class="switch" :class="{ on: unreadOnly }" aria-hidden="true"><span /></span>Show unread only
      </button>
      <div class="menu-divider" />
      <button
        type="button"
        role="menuitem"
        class="menu-item"
        :disabled="unreadCount === 0"
        data-testid="inbox-mark-all-read"
        @click="emit('mark-all-read'); menu = null"
      >
        <AppIcon name="check" :size="16" />Mark all as read<span class="count">{{ unreadCount }}</span>
      </button>
    </AnchoredPopover>

    <div class="list-scroll">
      <p v-if="partialError" class="partial" role="status">Some inbox sources couldn't be loaded.</p>

      <ul v-if="isLoading" class="rows" aria-busy="true" aria-label="Loading inbox">
        <li v-for="n in 7" :key="n" class="row skeleton" aria-hidden="true">
          <span class="sk-avatar" /><span class="sk-lines"><span /><span /><span /></span>
        </li>
      </ul>

      <div v-else-if="isError" class="state" role="alert" data-testid="inbox-error">
        <p class="state-title">Unable to load Inbox</p>
        <p class="state-text">Check your connection to the community, then try again.</p>
        <button type="button" class="retry" @click="emit('retry')">Try again</button>
      </div>

      <div v-else-if="!items.length" class="state" data-testid="inbox-empty">
        <p class="state-title">{{ unreadOnly ? "No unread items" : empty.title }}</p>
        <p class="state-text">{{ unreadOnly ? "You're all caught up." : empty.description }}</p>
      </div>

      <ul v-else class="rows" data-testid="inbox-rows">
        <li
          v-for="item in items"
          :key="item.key"
          class="row"
          :class="{ selected: item.key === selectedKey, unread: isUnread(item) }"
          role="button"
          tabindex="0"
          :aria-current="item.key === selectedKey ? 'true' : undefined"
          :aria-label="`${senderName(item.event.pubkey)}, ${context(item)}${isUnread(item) ? ', unread' : ''}`"
          data-testid="inbox-row"
          @click="emit('select', item)"
          @keydown="onRowKey($event, item)"
          @contextmenu="openContext($event, item)"
        >
          <button
            type="button"
            class="avatar-btn"
            :aria-label="`Open ${senderName(item.event.pubkey)}'s profile`"
            @click.stop="emit('open-profile', item.event.pubkey)"
          >
            <AvatarCircle :name="senderName(item.event.pubkey)" :avatar-url="senderAvatar(item.event.pubkey)" :pubkey="item.event.pubkey" :size="36" />
          </button>
          <div class="row-main">
            <div class="row-top">
              <span class="sender">{{ senderName(item.event.pubkey) }}</span>
              <span v-if="item.count > 1" class="group-count">{{ item.count }}</span>
              <span v-if="isUnread(item)" class="unread-dot" aria-hidden="true" />
              <time class="time" :datetime="new Date(item.createdAt * 1000).toISOString()">{{ relativeTime(item.createdAt) }}</time>
            </div>
            <div class="context">{{ context(item) }}</div>
            <div class="preview" data-testid="inbox-row-preview">
              <MessagePreview
                v-if="hasText(item)"
                :content="item.event.content"
                :mentions="mentionTagsOf(item.event).mentions"
                :mentions-everyone="mentionTagsOf(item.event).everyone"
              /><template v-else>(no text)</template>
            </div>
          </div>
          <div class="row-actions" @click.stop>
            <button
              v-if="item.channelId"
              type="button"
              class="action"
              :title="isUnread(item) ? 'Mark as read' : 'Mark as unread'"
              :aria-label="isUnread(item) ? 'Mark as read' : 'Mark as unread'"
              data-testid="inbox-row-toggle-read"
              @click="isUnread(item) ? emit('mark-read', item) : emit('mark-unread', item)"
            >
              {{ isUnread(item) ? "✓" : "●" }}
            </button>
            <button
              v-if="item.channelId"
              type="button"
              class="action"
              title="Open in channel"
              aria-label="Open in channel"
              data-testid="inbox-row-open"
              @click="emit('open-source', item)"
            >
              <AppIcon name="link" :size="16" />
            </button>
          </div>
        </li>
      </ul>
    </div>

    <AnchoredPopover v-if="contextFor" :anchor="contextFor.anchor" side="right" align="start" label="Inbox item actions" :width="220" @close="contextFor = null">
      <button
        v-if="contextFor.item.channelId && isUnread(contextFor.item)"
        type="button"
        role="menuitem"
        class="menu-item"
        @click="emit('mark-read', contextFor.item); contextFor = null"
      >
        <AppIcon name="check" :size="16" />Mark as read
      </button>
      <button
        v-else-if="contextFor.item.channelId"
        type="button"
        role="menuitem"
        class="menu-item"
        @click="emit('mark-unread', contextFor.item); contextFor = null"
      >
        <span class="check" aria-hidden="true">●</span>Mark as unread
      </button>
      <button
        v-if="contextFor.item.channelId"
        type="button"
        role="menuitem"
        class="menu-item"
        @click="emit('open-source', contextFor.item); contextFor = null"
      >
        <AppIcon name="link" :size="16" />Open in channel
      </button>
      <button type="button" role="menuitem" class="menu-item" @click="emit('open-profile', contextFor.item.event.pubkey); contextFor = null">
        <AppIcon name="users" :size="16" />View profile
      </button>
    </AnchoredPopover>
  </section>
</template>

<style scoped>
.list-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  flex-shrink: 0;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface) 80%, transparent);
  backdrop-filter: blur(10px);
}
.filter-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
}
.filter-trigger:hover,
.filter-trigger[aria-expanded="true"] {
  background: var(--color-surface-muted);
}
.caret {
  font-size: 10px;
  color: var(--color-text-subtle);
}
.icon-btn {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.icon-btn:hover,
.icon-btn[aria-expanded="true"] {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.filter-trigger:focus-visible,
.icon-btn:focus-visible,
.row:focus-visible,
.action:focus-visible,
.avatar-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-1) var(--space-2);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 140ms ease;
}
.row:hover {
  background: var(--color-surface-muted);
}
.row.selected {
  background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));
}
.avatar-btn {
  align-self: flex-start;
  border: none;
  padding: 0;
  background: none;
  border-radius: 50%;
  cursor: pointer;
}
.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sender {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row.unread .sender {
  font-weight: 600;
  color: var(--color-text);
}
.group-count {
  font-size: 11px;
  color: var(--color-text-subtle);
}
.unread-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-primary);
  flex-shrink: 0;
}
.time {
  font-size: 12px;
  color: var(--color-text-subtle);
  white-space: nowrap;
  transition: opacity 120ms ease;
}
.context {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--color-text-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview {
  font-size: 14px;
  line-height: 20px;
  color: var(--color-text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.row.unread .preview {
  color: var(--color-text);
}

/* Hover / keyboard-focus action pill; the time fades so they don't overlap. */
.row-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.row:hover .row-actions,
.row:focus-within .row-actions {
  opacity: 1;
  pointer-events: auto;
}
.row:hover .time,
.row:focus-within .time {
  opacity: 0;
}
.action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.action:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}

.skeleton {
  cursor: default;
}
.sk-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-surface-muted);
  flex-shrink: 0;
}
.sk-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 2px;
}
.sk-lines span {
  height: 10px;
  border-radius: 5px;
  background: var(--color-surface-muted);
  animation: pulse 1.2s ease-in-out infinite;
}
.sk-lines span:nth-child(1) {
  width: 40%;
}
.sk-lines span:nth-child(2) {
  width: 70%;
}
.sk-lines span:nth-child(3) {
  width: 90%;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}

.state {
  padding: var(--space-6) var(--space-4);
  text-align: center;
}
.state-title {
  margin: 0 0 var(--space-1);
  font-weight: 600;
  color: var(--color-text);
}
.state-text {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.retry {
  margin-top: var(--space-3);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
.partial {
  margin: var(--space-1) var(--space-2) var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-warning);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 36px;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}
.menu-item:hover:not(:disabled),
.menu-item:focus-visible,
.menu-item.active {
  background: var(--color-surface-muted);
  outline: none;
}
.menu-item:disabled {
  color: var(--color-text-subtle);
  cursor: default;
}
.check {
  width: 16px;
  text-align: center;
  font-size: 12px;
}
.count {
  margin-left: auto;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.menu-divider {
  height: 1px;
  margin: var(--space-1) var(--space-1);
  background: var(--color-border);
}
.switch {
  position: relative;
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: var(--color-border);
  flex-shrink: 0;
  transition: background 140ms ease;
}
.switch span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-surface);
  transition: transform 140ms ease;
}
.switch.on {
  background: var(--color-primary);
}
.switch.on span {
  transform: translateX(12px);
}
@media (prefers-reduced-motion: reduce) {
  .row,
  .row-actions,
  .time,
  .switch,
  .switch span,
  .sk-lines span {
    transition: none;
    animation: none;
  }
}
</style>
