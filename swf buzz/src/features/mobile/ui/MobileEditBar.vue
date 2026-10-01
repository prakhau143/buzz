<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";

/**
 * Edit mode on mobile: the composer area turns into an editor for one message
 * ("Editing message ×"), prefilled with its text. Saving publishes through the
 * caller's existing edit path (kind:40003 overlay — `useMessageMutations`), so
 * there is never a second, duplicate message. An unchanged or emptied edit is
 * not a publish, exactly as on desktop.
 */
const props = defineProps<{ original: string; saving?: boolean; error?: string | null }>();
const emit = defineEmits<{ save: [content: string]; cancel: [] }>();

const draft = ref(props.original);
const input = ref<HTMLTextAreaElement | null>(null);
const changed = computed(() => draft.value.trim().length > 0 && draft.value.trim() !== props.original.trim());

onMounted(async () => {
  await nextTick();
  const el = input.value;
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
});

function save() {
  if (!changed.value) return emit("cancel");
  emit("save", draft.value.trim());
}
</script>

<template>
  <div class="edit-bar" data-testid="mobile-edit-bar">
    <div class="edit-head">
      <AppIcon name="edit" :size="16" class="edit-icon" />
      <span class="edit-label">Editing message</span>
      <button type="button" class="icon-btn" aria-label="Cancel editing" data-testid="mobile-edit-cancel" @click="emit('cancel')">
        <AppIcon name="close" :size="20" />
      </button>
    </div>
    <div class="edit-row">
      <label class="sr-only" for="mobile-edit-input">Edit message</label>
      <textarea
        id="mobile-edit-input"
        ref="input"
        v-model="draft"
        class="edit-input"
        rows="1"
        data-testid="mobile-edit-input"
        @keydown.escape.prevent="emit('cancel')"
      />
      <button
        type="button"
        class="save"
        :disabled="saving"
        :aria-label="changed ? 'Save edit' : 'Close editor'"
        data-testid="mobile-edit-save"
        @click="save"
      >
        <AppIcon :name="changed ? 'check' : 'close'" :size="20" />
      </button>
    </div>
    <p v-if="error" class="edit-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.edit-bar {
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  padding: var(--space-1) var(--space-3) var(--space-2);
}
.edit-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 36px;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: var(--color-primary);
}
.edit-label {
  flex: 1;
}
.icon-btn {
  width: 44px;
  height: 44px;
  margin-right: -10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text-muted);
}
.edit-row {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
}
.edit-input {
  flex: 1;
  min-height: 44px;
  max-height: 160px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 16px;
  line-height: var(--line-height-normal);
  resize: none;
}
.save {
  flex: none;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.save:disabled {
  opacity: 0.6;
}
.edit-error {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
