<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import AppIcon from "@/components/AppIcon.vue";
import type { MentionCandidate } from "./mentionModel";

/**
 * The @mention suggestion list. Presentational: the composer owns the query,
 * the highlighted row and the keyboard (focus never leaves the textarea, as in
 * OLD BUZZ), and this renders them as an ARIA listbox the textarea points at
 * with `aria-activedescendant`.
 *
 * People and agents share one row design; an agent differs only by its
 * metadata line. Presence comes from the one presence store via AvatarCircle.
 */
const props = defineProps<{
  id: string;
  candidates: MentionCandidate[];
  activeIndex: number;
  loading?: boolean;
  /**
   * Offer the `@everyone` row, and where: "first" while typing a matching
   * query (`@eve`), "last" for a bare `@` so people stay on top. Rows are
   * indexed in display order — the composer uses the same order.
   */
  everyone?: "first" | "last" | null;
}>();
const emit = defineEmits<{ select: [candidate: MentionCandidate]; "select-everyone": []; hover: [index: number] }>();

function optionId(index: number) {
  return `${props.id}-option-${index}`;
}

/** Index offset of the person rows (the everyone row sits before them when "first"). */
const personOffset = computed(() => (props.everyone === "first" ? 1 : 0));
const everyoneIndex = computed(() =>
  props.everyone === "first" ? 0 : props.everyone === "last" ? props.candidates.length : -1,
);

function metaLabel(candidate: MentionCandidate): string {
  const kind = candidate.isAgent ? "Agent" : "Member";
  return candidate.inChannel === false ? `${kind} · Not in channel` : kind;
}

/** Two rows with the same name are told apart by their key — a name can be chosen, a key cannot. */
function isDuplicateName(candidate: MentionCandidate): boolean {
  const name = candidate.displayName.toLowerCase();
  return props.candidates.filter((c) => c.displayName.toLowerCase() === name).length > 1;
}

// Keep the highlighted row in view while arrowing through a long list.
watch(
  () => props.activeIndex,
  async (index) => {
    await nextTick();
    document.getElementById(optionId(index))?.scrollIntoView?.({ block: "nearest" });
  },
);

defineExpose({ optionId });
</script>

<template>
  <div class="mention-picker" data-testid="mention-picker">
    <p class="picker-heading" aria-hidden="true">Members</p>
    <ul :id="id" class="picker-list" role="listbox" aria-label="Mention someone">
      <li
        v-if="everyone === 'first'"
        :id="optionId(everyoneIndex)"
        class="picker-option everyone-option"
        :class="{ active: everyoneIndex === activeIndex }"
        role="option"
        :aria-selected="everyoneIndex === activeIndex"
        aria-label="@everyone, mention everyone in this channel"
        data-testid="mention-option-everyone"
        @mousedown.prevent="emit('select-everyone')"
        @mousemove="everyoneIndex !== activeIndex && emit('hover', everyoneIndex)"
      >
        <span class="everyone-glyph" aria-hidden="true"><AppIcon name="users" :size="16" /></span>
        <span class="option-text">
          <span class="option-name">@everyone</span>
          <span class="option-meta">Mention everyone in this channel</span>
        </span>
      </li>
      <li
        v-for="(candidate, index) in candidates"
        :id="optionId(index + personOffset)"
        :key="candidate.pubkey"
        class="picker-option"
        :class="{ active: index + personOffset === activeIndex }"
        role="option"
        :aria-selected="index + personOffset === activeIndex"
        data-testid="mention-option"
        :data-pubkey="candidate.pubkey"
        @mousedown.prevent="emit('select', candidate)"
        @mousemove="index + personOffset !== activeIndex && emit('hover', index + personOffset)"
      >
        <AvatarCircle
          :name="candidate.displayName"
          :avatar-url="candidate.avatarUrl"
          :is-agent="candidate.isAgent"
          :pubkey="candidate.pubkey"
          :size="24"
        />
        <span class="option-text">
          <span class="option-name">{{ candidate.displayName }}</span>
          <span class="option-meta" :class="{ agent: candidate.isAgent }">
            {{ metaLabel(candidate) }}
            <template v-if="isDuplicateName(candidate)">
              · {{ candidate.pubkey.slice(0, 8) }}
            </template>
          </span>
        </span>
      </li>
      <li
        v-if="everyone === 'last'"
        :id="optionId(everyoneIndex)"
        class="picker-option everyone-option"
        :class="{ active: everyoneIndex === activeIndex }"
        role="option"
        :aria-selected="everyoneIndex === activeIndex"
        aria-label="@everyone, mention everyone in this channel"
        data-testid="mention-option-everyone"
        @mousedown.prevent="emit('select-everyone')"
        @mousemove="everyoneIndex !== activeIndex && emit('hover', everyoneIndex)"
      >
        <span class="everyone-glyph" aria-hidden="true"><AppIcon name="users" :size="16" /></span>
        <span class="option-text">
          <span class="option-name">@everyone</span>
          <span class="option-meta">Mention everyone in this channel</span>
        </span>
      </li>
    </ul>
    <p v-if="loading && !candidates.length" class="picker-empty">Loading members…</p>
  </div>
</template>

<style scoped>
.mention-picker {
  position: absolute;
  bottom: 100%;
  left: var(--space-4);
  width: min(320px, calc(100% - var(--space-4) * 2));
  margin-bottom: var(--space-1);
  padding: var(--space-1);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: var(--z-dropdown);
  animation: picker-in 120ms ease-out;
}
@keyframes picker-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mention-picker {
    animation: none;
  }
}

.picker-heading {
  margin: 0;
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-subtle);
}

.picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 232px;
  overflow-y: auto;
}

.picker-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 5px var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.picker-option.active {
  background: var(--color-mention-bg);
  box-shadow: inset 2px 0 0 var(--color-primary);
}
/* Same row as a person: the avatar slot holds the group glyph. */
.everyone-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--color-mention-bg);
  color: var(--color-mention-text);
}
/* Touch: 44px rows (coarse pointers only — desktop keeps its compact list). */
@media (pointer: coarse) {
  .picker-option {
    min-height: 44px;
  }
}

.option-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: var(--line-height-tight);
}
.option-name {
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.option-meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  white-space: nowrap;
}
.option-meta.agent {
  color: var(--color-agent);
}

.picker-empty {
  margin: 0;
  padding: var(--space-2);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
</style>
