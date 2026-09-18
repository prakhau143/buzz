<script setup lang="ts">
import AvatarCircle from "@/components/AvatarCircle.vue";
import { useProfile } from "@/composables/useProfile";

const props = defineProps<{ pubkey: string | null }>();
const { data: profile } = useProfile(() => props.pubkey);
</script>

<template>
  <AvatarCircle
    :name="profile?.displayName ?? pubkey?.slice(0, 8) ?? 'Unknown'"
    :avatar-url="profile?.avatarUrl"
    :size="20"
  />
  <span class="dm-name">{{ profile?.displayName ?? pubkey?.slice(0, 8) ?? "Unknown" }}</span>
</template>

<style scoped>
.dm-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
