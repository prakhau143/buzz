<script setup lang="ts">
/**
 * A person's name inside the moderation audit log.
 *
 * An audit row that reads "ban · 3m ago" is close to useless — it says nothing
 * about who acted or who was acted upon. Names resolve through the shared
 * profile cache, so a roster already loaded costs no extra request, and an
 * unresolved profile degrades to a short npub rather than a blank.
 */
import { computed } from "vue";
import { useProfile } from "@/composables/useProfile";
import { shortNpub } from "@/features/identity/format";

const props = defineProps<{ pubkey: string }>();
const { data: profile } = useProfile(() => props.pubkey);
const label = computed(() => profile.value?.displayName ?? shortNpub(props.pubkey));
</script>

<template>
  <span class="actor" :title="pubkey">{{ label }}</span>
</template>

<style scoped>
.actor {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  font-weight: 600;
}
</style>
