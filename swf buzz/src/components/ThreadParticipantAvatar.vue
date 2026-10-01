<script setup lang="ts">
import { computed } from "vue";
import AvatarCircle from "./AvatarCircle.vue";
import { useProfile } from "@/composables/useProfile";

/**
 * One face in a thread summary's avatar cluster. Resolves the profile through
 * the shared `useProfile` cache and renders the app's usual fallback (initial
 * in a circle) while it loads or when there is none — the row never waits on a
 * profile lookup.
 */
const props = defineProps<{ pubkey: string }>();

const { data: profile } = useProfile(() => props.pubkey);
const name = computed(() => profile.value?.displayName ?? props.pubkey.slice(0, 8));
</script>

<template>
  <AvatarCircle
    :name="name"
    :avatar-url="profile?.avatarUrl"
    :is-agent="profile?.isAgent"
    :size="24"
    :title="name"
  />
</template>
