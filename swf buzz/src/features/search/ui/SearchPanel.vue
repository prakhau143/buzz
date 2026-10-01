<script setup lang="ts">
/**
 * Message search.
 *
 * States are deliberately distinct: "type something" (idle), "searching",
 * "no results for <the query actually sent>", and "couldn't search". Collapsing
 * idle and empty into one blank panel is what makes a search box feel broken.
 */
import { computed, ref } from "vue";
import { useMessageSearch } from "../useMessageSearch";
import { useProfileMap } from "@/composables/useProfile";
import StateView from "@/components/StateView.vue";
import AppIcon from "@/components/AppIcon.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import { relativeTime, shortKey } from "@/features/identity/format";

const props = defineProps<{ channelId?: string; channelName?: string }>();
const emit = defineEmits<{ open: [{ channelId: string; messageId: string }] }>();

const query = ref("");
const scopeToChannel = ref(false);

const effectiveChannelId = computed(() =>
  scopeToChannel.value ? props.channelId : undefined,
);

const {
  data: hits,
  isFetching,
  isError,
  refetch,
  submittedQuery,
  isSearching,
} = useMessageSearch(query, { channelId: effectiveChannelId });

const authors = computed(() => (hits.value ?? []).map((h) => h.message.authorPubkey));
const { profiles, displayNames } = useProfileMap(authors);

function displayName(pubkey: string): string {
  return displayNames.value.get(pubkey) ?? shortKey(pubkey);
}
</script>

<template>
  <section class="search-panel" aria-label="Search messages">
    <div class="search-field">
      <AppIcon name="search" class="search-icon" aria-hidden="true" />
      <input
        v-model="query"
        type="search"
        class="search-input"
        placeholder="Search messages"
        aria-label="Search messages"
        data-testid="search-input"
      />
    </div>

    <label v-if="props.channelId" class="scope-toggle">
      <input v-model="scopeToChannel" type="checkbox" />
      <span>Only in {{ props.channelName ? `#${props.channelName}` : "this channel" }}</span>
    </label>

    <p v-if="!isSearching" class="hint" data-testid="search-idle">
      Type to search messages you have access to.
    </p>

    <StateView v-else-if="isFetching && !hits" kind="loading" title="Searching…" />

    <StateView
      v-else-if="isError"
      kind="error"
      title="Couldn't search"
      description="The search request didn't complete."
      @retry="refetch()"
    />

    <StateView
      v-else-if="hits && hits.length === 0"
      kind="empty"
      title="No messages found"
      :description="`Nothing matched “${submittedQuery}”.`"
      data-testid="search-empty"
    />

    <ul v-else-if="hits" class="results" data-testid="search-results">
      <li v-for="hit in hits" :key="hit.message.id">
        <button
          type="button"
          class="result"
          @click="emit('open', { channelId: hit.channelId, messageId: hit.message.id })"
        >
          <AvatarCircle
            :name="displayName(hit.message.authorPubkey)"
            :avatar-url="profiles.get(hit.message.authorPubkey)?.avatarUrl || undefined"
            :size="28"
          />
          <span class="result-body">
            <span class="result-meta">
              <span class="result-author">{{ displayName(hit.message.authorPubkey) }}</span>
              <time :datetime="new Date(hit.message.createdAt * 1000).toISOString()">
                {{ relativeTime(hit.message.createdAt) }}
              </time>
            </span>
            <span class="result-content">{{ hit.message.content }}</span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  min-height: 0;
}

.search-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}
.search-field:focus-within {
  border-color: var(--color-accent);
}

.search-icon {
  flex: none;
  color: var(--color-text-muted);
}

.search-input {
  flex: 1;
  height: 36px;
  border: none;
  background: transparent;
  font: inherit;
  color: var(--color-text);
}
.search-input:focus {
  outline: none;
}

.scope-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.hint {
  margin: 0;
  padding: var(--space-4) 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  overflow-y: auto;
  min-height: 0;
}

.result {
  display: flex;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.result:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border);
}
.result:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.result-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.result-meta {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.result-author {
  font-weight: 600;
  color: var(--color-text);
}

.result-content {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}
</style>
