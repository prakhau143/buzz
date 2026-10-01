<script lang="ts">
import { shallowReactive } from "vue";
import { fetchCommunityIcon } from "@/features/communities/communityIcon";

/**
 * Community icons from each relay's NIP-11 `icon` (communityIcon.ts), fetched
 * once per relay per app session and shared by every avatar — the rail and the
 * switcher show the same picture without asking the relay twice.
 */
const icons = shallowReactive(new Map<string, string | null>());
const inFlight = new Set<string>();

function ensureIcon(relayUrl: string) {
  if (!relayUrl || icons.has(relayUrl) || inFlight.has(relayUrl)) return;
  inFlight.add(relayUrl);
  void fetchCommunityIcon(relayUrl)
    .then((icon) => icons.set(relayUrl, icon))
    .finally(() => inFlight.delete(relayUrl));
}
</script>

<script setup lang="ts">
import { computed, watch } from "vue";

/** A community's square avatar: its icon when the relay publishes one, else its initial. */
const props = withDefaults(defineProps<{ relayUrl: string | null; name: string; size?: number }>(), { size: 32 });

watch(
  () => props.relayUrl,
  (url) => url && ensureIcon(url),
  { immediate: true },
);
const icon = computed(() => (props.relayUrl ? icons.get(props.relayUrl) : null));
const initial = computed(() => props.name.trim().charAt(0).toUpperCase() || "#");
</script>

<template>
  <span
    class="community-avatar"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.44)}px` }"
    aria-hidden="true"
  >
    <img v-if="icon" :src="icon" alt="" />
    <template v-else>{{ initial }}</template>
  </span>
</template>

<style scoped>
.community-avatar {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 28%;
  background: var(--color-primary);
  color: var(--color-text-on-accent);
  font-weight: 700;
  line-height: 1;
}
.community-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
