<script setup lang="ts">
/**
 * First-run fallback when no community is resolved yet — see
 * `../currentCommunity.ts`'s doc comment for why this exists instead of a
 * real community switcher. Creating one makes the caller its owner
 * (`backend/src/routes/communities.rs::create_community` — any
 * authenticated user may do this, not role-gated, since there's no
 * community yet to hold a role in).
 */
import { ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { userMessageFor } from "@/services/errors";
import { useCreateCommunity } from "../useCommunity";

const name = ref("");
const { createCommunity, isCreating, createError } = useCreateCommunity();

async function handleCreate() {
  const trimmed = name.value.trim();
  if (!trimmed) return;
  try {
    await createCommunity(trimmed);
  } catch {
    // Already surfaced via `createError` (the mutation's own `onError`
    // option) below — swallow here so a failed create doesn't also throw
    // an unhandled rejection out of this template event handler.
  }
}
</script>

<template>
  <div class="create-community-prompt">
    <p class="title">Set up your community</p>
    <p class="description">
      This SWF Buzz backend doesn't have a community yet. Create one to start inviting teammates.
    </p>
    <form class="form" @submit.prevent="handleCreate">
      <input
        v-model="name"
        class="name-input"
        type="text"
        placeholder="Community name"
        :disabled="isCreating"
      />
      <BaseButton type="submit" variant="primary" :disabled="isCreating || !name.trim()">
        {{ isCreating ? "Creating…" : "Create community" }}
      </BaseButton>
    </form>
    <p v-if="createError" class="error-text">{{ userMessageFor(createError) }}</p>
  </div>
</template>

<style scoped>
.create-community-prompt {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: 600;
  color: var(--color-text);
}
.description {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.form {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.name-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-xs);
}
.error-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
</style>
