<script setup lang="ts">
/**
 * Session-wide background services, mounted by App.vue for as long as a
 * session is ready — independent of which screen (or shell) is showing.
 *
 * Presence used to live in AppHeader "because it is the one component on
 * every authenticated screen". Settings is a full-screen route WITHOUT that
 * header, so presence moved here, where hiding the header can never stop it.
 *
 * Notifications live here for the same reason (useNotificationService).
 *
 * Also the app-level shortcuts that must work everywhere (Settings, zoom).
 */
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePresenceHeartbeat } from "@/features/presence/usePresenceHeartbeat";
import { startPresenceSync } from "@/features/presence/presenceSync";
import { communitySessionGeneration } from "@/features/communities/communitySession";
import { useShortcut } from "@/features/shortcuts/useShortcuts";
import { zoomBy } from "@/features/appearance/appearance";
import { useUiStore } from "@/stores/ui";
import { startProfileSync } from "@/features/profile/profileSync";
import { useNotificationService } from "@/features/notifications/useNotificationService";

const router = useRouter();
const route = useRoute();
const ui = useUiStore();

usePresenceHeartbeat();
// Idempotent. Teardown (identitySession.ts) stops it on every sign-out AND every
// community switch, while this component stays mounted — so start it again for
// each community session, or the new community would have no presence at all.
watch(communitySessionGeneration, () => startPresenceSync(), { immediate: true });
// The identity profile: reconcile it into each community session and keep
// every visible name/avatar live (features/profile/profileSync.ts).
watch(communitySessionGeneration, () => startProfileSync(), { immediate: true });

// Live unread tracking + desktop alerts + taskbar dot + toast click routing:
// session-wide, so they also work in full-screen Settings. Unmounting on
// sign-out clears the taskbar dot.
useNotificationService();

useShortcut("open-settings", () => {
  if (route.name === "settings") {
    const back = (route.query.from as string | undefined) ?? null;
    void (back ? router.push(back) : router.push({ name: "channels" }));
  } else {
    void router.push({ name: "settings", query: { section: "profile", from: route.fullPath } });
  }
});
useShortcut("toggle-sidebar", () => ui.toggleSidebar());
useShortcut("zoom-in", () => zoomBy(1));
useShortcut("zoom-out", () => zoomBy(-1));
useShortcut("zoom-reset", () => zoomBy(0));
</script>

<template>
  <span hidden aria-hidden="true" />
</template>
