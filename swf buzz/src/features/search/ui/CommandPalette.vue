<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import MessagePreview from "@/features/mentions/MessagePreview";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { useProfileMap } from "@/composables/useProfile";
import { useChannels } from "@/features/channels/useChannels";
import { sidebarChannels } from "@/features/channels/channelVisibility";
import { useDmList } from "@/features/dm/useDmList";
import { useCommunityMembers } from "@/features/community-members/useCommunityMembers";
import { useMessageSearch } from "@/features/search/useMessageSearch";
import { useSessionStore } from "@/stores/session";
import { buildPalette, flatten, MIN_QUERY, type PaletteItem } from "@/features/search/paletteModel";

/**
 * "Search anything" — one command palette (Ctrl/Cmd+K or the sidebar field)
 * over channels, DMs, people and messages. A dialog containing a combobox
 * input and a listbox; the highlighted row is announced through
 * `aria-activedescendant`, so focus never leaves the input while ↑/↓ move.
 * Enter opens, Escape closes, focus returns to what opened it.
 */
const props = defineProps<{ canCreateChannel?: boolean }>();
const emit = defineEmits<{
  close: [];
  "open-channel": [channelId: string, messageId?: string];
  "open-dm": [conversationId: string];
  "open-person": [pubkey: string];
  "create-channel": [];
}>();

const session = useSessionStore();
const query = ref("");
const input = ref<HTMLInputElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
useEscapeKey(() => emit("close"));
useFocusTrap(dialog);

const { data: channels } = useChannels();
const { data: conversations } = useDmList();
const { data: members } = useCommunityMembers();

const otherOf = (c: { dmParticipants?: string[] }) => c.dmParticipants?.find((p) => p !== session.pubkey) ?? null;
const peoplePubkeys = computed(() => [
  ...(members.value ?? []).map((m) => m.pubkey),
  ...(conversations.value ?? []).map(otherOf).filter((p): p is string => !!p),
]);
const { displayNames } = useProfileMap(peoplePubkeys);
const nameOf = (pubkey: string | null) => (pubkey ? (displayNames.value.get(pubkey) ?? pubkey.slice(0, 8)) : "Conversation");

const search = useMessageSearch(query);
const channelList = computed(() => sidebarChannels(channels.value));
const channelName = (id: string) => channelList.value.find((c) => c.id === id)?.name ?? "channel";

const sections = computed(() =>
  buildPalette({
    query: query.value,
    channels: channelList.value.map((c) => ({ id: c.id, name: c.name, topic: c.topic })),
    dms: (conversations.value ?? []).map((c) => ({ id: c.id, name: nameOf(otherOf(c)) })),
    people: (members.value ?? [])
      .filter((m) => m.pubkey !== session.pubkey)
      .map((m) => ({ pubkey: m.pubkey, name: nameOf(m.pubkey) })),
    messages: (query.value.trim().length >= MIN_QUERY ? (search.data.value ?? []) : []).map((h) => ({
      id: h.message.id,
      content: h.message.content,
      channelId: h.channelId,
      channelName: channelName(h.channelId),
      mentions: h.message.mentions,
      mentionsEveryone: !!h.message.mentionsEveryone,
    })),
    canCreateChannel: !!props.canCreateChannel,
  }),
);
const flat = computed(() => flatten(sections.value));
const active = ref(0);
watch(flat, () => (active.value = 0));

const optionId = (item: PaletteItem) => `palette-${item.kind}-${item.id}`;
const activeId = computed(() => (flat.value[active.value] ? optionId(flat.value[active.value]) : undefined));
const searchingMessages = computed(() => query.value.trim().length >= MIN_QUERY && search.isFetching.value);

function move(delta: number) {
  if (!flat.value.length) return;
  active.value = (active.value + delta + flat.value.length) % flat.value.length;
  void nextTick(() => document.getElementById(activeId.value ?? "")?.scrollIntoView({ block: "nearest" }));
}

function choose(item: PaletteItem | undefined) {
  if (!item) return;
  if (item.kind === "channel") emit("open-channel", item.id);
  else if (item.kind === "message") emit("open-channel", item.channelId, item.id);
  else if (item.kind === "dm") emit("open-dm", item.id);
  else if (item.kind === "person") emit("open-person", item.id);
  else emit("create-channel");
}

onMounted(() => input.value?.focus());

const ICON: Record<PaletteItem["kind"], string> = { channel: "#", dm: "@", person: "●", message: "“", action: "+" };
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div ref="dialog" class="palette" role="dialog" aria-modal="true" aria-label="Search anything" data-testid="command-palette">
      <div class="input-row">
        <AppIcon name="search" :size="20" class="search-icon" />
        <input
          ref="input"
          v-model="query"
          class="input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-autocomplete="list"
          :aria-activedescendant="activeId"
          aria-label="Search channels, people and messages"
          placeholder="Search channels, people and messages…"
          autocomplete="off"
          spellcheck="false"
          data-testid="palette-input"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="choose(flat[active])"
        />
        <kbd class="esc">Esc</kbd>
      </div>

      <div id="palette-results" class="results" role="listbox" aria-label="Results" data-testid="palette-results">
        <template v-for="section in sections" :key="section.id">
          <div class="section-title" role="presentation">{{ section.title }}</div>
          <div
            v-for="item in section.items"
            :id="optionId(item)"
            :key="optionId(item)"
            class="option"
            :class="{ active: activeId === optionId(item) }"
            role="option"
            :aria-selected="activeId === optionId(item)"
            data-testid="palette-option"
            @mousemove="active = flat.indexOf(item)"
            @click="choose(item)"
          >
            <span class="glyph" :class="item.kind" aria-hidden="true">{{ ICON[item.kind] }}</span>
            <span class="label"
              ><MessagePreview
                v-if="item.kind === 'message'"
                raw
                :content="item.label"
                :mentions="item.mentions ?? []"
                :mentions-everyone="!!item.mentionsEveryone"
              /><template v-else>{{ item.label }}</template></span
            >
            <span v-if="'sub' in item && item.sub" class="sub">{{ item.sub }}</span>
          </div>
        </template>

        <p v-if="searchingMessages && !flat.length" class="state" role="status">Searching…</p>
        <p
          v-else-if="query.trim().length >= MIN_QUERY && !flat.length"
          class="state"
          role="status"
          data-testid="palette-empty"
        >
          No results for “{{ query.trim() }}”
        </p>
        <p v-else-if="query.trim().length > 0 && query.trim().length < MIN_QUERY" class="state">
          Keep typing — at least {{ MIN_QUERY }} characters.
        </p>
      </div>

      <div class="footer" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>↵</kbd> Open</span>
        <span><kbd>Esc</kbd> Close</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh var(--space-4) var(--space-4);
  background: rgb(0 0 0 / 30%);
}
.palette {
  width: min(640px, 100%);
  max-height: min(560px, 76vh);
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
@media (max-width: 480px) {
  .overlay {
    padding: 0;
    align-items: stretch;
  }
  .palette {
    max-height: none;
    border-radius: 0;
  }
}
.input-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 48px;
  padding: 0 var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.search-icon {
  color: var(--color-text-subtle);
  flex-shrink: 0;
}
.input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-md);
  outline: none;
}
.esc,
kbd {
  padding: 1px 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  font-family: var(--font-sans);
  font-size: 11px;
  color: var(--color-text-muted);
}
.results {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2);
}
.section-title {
  padding: var(--space-2) var(--space-2) var(--space-1);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-subtle);
}
.option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 40px;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text);
  cursor: pointer;
}
.option.active {
  background: var(--color-primary-muted);
}
.glyph {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  font-weight: 700;
  font-size: var(--font-size-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.option.active .glyph {
  background: var(--color-surface);
  color: var(--color-primary);
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  flex-shrink: 0;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.state {
  margin: 0;
  padding: var(--space-5) var(--space-3);
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.footer {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.footer kbd {
  margin-right: 2px;
}
@media (max-width: 480px) {
  .footer {
    display: none;
  }
}
</style>
