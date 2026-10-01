<script setup lang="ts">
/**
 * `AppHeader` renders OUTSIDE `ErrorBoundary` deliberately — a crash in any
 * routed view must not take the header/primary-nav down with it (P0/P2 fix,
 * see AppHeader.vue and ErrorBoundary.vue's own doc comments). Only shown
 * once a session exists — `/login`/`/callback`/`/invite/:token` render
 * without it, matching the router's `meta.public` set.
 */
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import AppHeader from "@/layouts/AppHeader.vue";
import CommunityRail from "@/layouts/CommunityRail.vue";
import { useIsMobile } from "@/features/mobile/breakpoints";
import { desktopCounterpart, mobileCounterpart } from "@/features/mobile/mobileRoutes";
import { installMobileNavDirection } from "@/features/mobile/mobileNav";
import { isDeepNavigating } from "@/features/navigation/useOpenMessageTarget";
import MobileSwitchOverlay from "@/features/mobile/ui/MobileSwitchOverlay.vue";
import SessionServices from "@/app/SessionServices.vue";
import InAppToastStack from "@/features/notifications/ui/InAppToastStack.vue";
import { useShortcutDispatcher } from "@/features/shortcuts/useShortcuts";
import { useSessionStore } from "@/stores/session";
import { startDeepLinks } from "@/features/deeplink/deepLinks";
const session = useSessionStore();
const router = useRouter();
const route = useRoute();
// Full-screen routes (Settings) replace the whole app chrome, header included.
const fullscreen = computed(() => route.meta.fullscreen === true);
/**
 * The community rail belongs to views that are INSIDE a community. The picker,
 * welcome, join, sign-in and full-screen Settings have no community to switch
 * from (the picker IS the chooser).
 */
const IN_COMMUNITY_ROUTES = new Set(["channels", "inbox", "dm", "community-channels", "community-dm"]);
const showRail = computed(
  () => session.isReady && !fullscreen.value && IN_COMMUNITY_ROUTES.has(String(route.name ?? "")),
);

/**
 * Mobile (< 768px) is a different navigation model, not a shrunk desktop:
 * mobile routes (`meta.mobile`) render their own frame — header, stack, bottom
 * nav — so the desktop header and rail are not shown. Crossing the breakpoint
 * moves the in-community view to its counterpart (features/mobile/mobileRoutes.ts);
 * sign-in, the community picker and Settings are left where they are.
 */
const isMobile = useIsMobile();
const mobileRoute = computed(() => route.meta.mobile === true);
installMobileNavDirection(router);
watch(
  [isMobile, () => route.name, () => session.isReady],
  ([mobile, , ready]) => {
    // A deep navigation (Inbox / notification → exact message) owns the route
    // until it lands; it already targets the right tier.
    if (!ready || isDeepNavigating()) return;
    const target = mobile ? (mobileRoute.value ? null : mobileCounterpart(route)) : mobileRoute.value ? desktopCounterpart(route) : null;
    if (target) void router.replace(target);
  },
);

// One keydown listener for every registered global shortcut (shortcutRegistry.ts).
useShortcutDispatcher();

// Development builds only: the identity diagnostics panel (public information
// only — see its own doc comment). Tree-shaken out of production entirely.
const isDev = import.meta.env.DEV;
const IdentityDiagnosticsPanel = isDev
  ? defineAsyncComponent(() => import("@/features/identity/ui/IdentityDiagnosticsPanel.vue"))
  : null;

// swfbuzz:// links: drain any that launched the app (cold start) and listen for
// ones that arrive while it runs (warm start). Tauri only; a no-op in a browser.
let stopDeepLinks: (() => void) | null = null;
onMounted(async () => {
  stopDeepLinks = await startDeepLinks(router);
});
onBeforeUnmount(() => stopDeepLinks?.());
</script>

<template>
  <div class="app-root">
    <SessionServices v-if="session.isReady" />
    <AppHeader v-if="session.isReady && !fullscreen && !mobileRoute" />
    <!-- Foreground notifications (the Windows toast covers the background):
         below the 48px header, or near the top in full-screen Settings / mobile. -->
    <InAppToastStack v-if="session.isReady" :offset-top="fullscreen || mobileRoute ? 20 : 60" />
    <!-- Mobile community switch: a real status over the deliberate gap between
         tearing the old session down and the new one becoming ready (isReady is
         false meanwhile, so this is keyed on the identity, not on readiness). -->
    <MobileSwitchOverlay v-if="isMobile && session.pubkey" />
    <div class="app-body">
      <!-- Fast community switching, beside every in-community view. Outside
           ErrorBoundary for the same reason as the header. -->
      <CommunityRail v-if="showRail" class="app-rail" />
      <div class="app-view">
        <ErrorBoundary>
          <RouterView />
        </ErrorBoundary>
      </div>
    </div>
    <!-- Floating only where there is no sidebar to host it (sign-in screens);
         once signed in, AppSidebar renders it inline in its footer so it can
         never cover the sidebar's actions or the thread composer. -->
    <component
      :is="IdentityDiagnosticsPanel"
      v-if="isDev && IdentityDiagnosticsPanel && !session.isReady"
    />
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
}
.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
/* The rail is fixed-width; the shell's resizable columns measure only .app-view. */
.app-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
/* Mobile gets its own navigation model (later phase); the rail is desktop/tablet. */
@media (max-width: 768px) {
  .app-rail {
    display: none;
  }
}
</style>
