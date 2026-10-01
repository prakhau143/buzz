<script setup lang="ts">
/**
 * Full-screen Settings (route `/settings?section=<id>&from=<path>`).
 *
 * Replaces the whole app chrome (router meta `fullscreen`; App.vue hides the
 * header): a sticky left navigation — Back to app, search, the three groups,
 * the app version — and an independently scrolling page on the right. Below
 * 860px the navigation collapses into a compact section picker.
 *
 * Only sections in the SWF allowlist exist (settingsRegistry.ts); Invites is
 * shown to community owners/admins only (the relay stays the authority).
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppIcon from "@/components/AppIcon.vue";
import StateView from "@/components/StateView.vue";
import { useIsMobile } from "@/features/mobile/breakpoints";
import { startViewportTracking } from "@/features/mobile/mobileNav";
import { useSwipeBack } from "@/features/mobile/gestures/useSwipeBack";
import { useCapabilities } from "@/features/access/capabilities";
import { appVersion, loadAppVersion } from "@/app/appVersion";
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_GROUPS,
  isSettingsSection,
  searchSettings,
  settingsSection,
  visibleSettingsSections,
  type SettingsSectionId,
} from "../settingsRegistry";

const route = useRoute();
const router = useRouter();
const can = useCapabilities();

const visible = computed(() => visibleSettingsSections({ canManageCommunity: can.value.canManageCommunityMembers }));

const loading = () => ({ render: () => null });
const lazy = (loader: () => Promise<Component>) =>
  defineAsyncComponent({ loader, loadingComponent: loading(), delay: 120 });
const SECTION_COMPONENTS: Record<SettingsSectionId, Component> = {
  profile: lazy(() => import("./sections/ProfileSection.vue")),
  appearance: lazy(() => import("./sections/AppearanceSection.vue")),
  notifications: lazy(() => import("./sections/NotificationsSection.vue")),
  shortcuts: lazy(() => import("./sections/ShortcutsSection.vue")),
  "custom-emoji": lazy(() => import("./sections/CustomEmojiSection.vue")),
  community: lazy(() => import("./sections/CommunitySection.vue")),
  invites: lazy(() => import("./sections/InvitesSection.vue")),
  mobile: lazy(() => import("./sections/MobileSection.vue")),
  updates: lazy(() => import("./sections/UpdatesSection.vue")),
  communities: lazy(() => import("./sections/CommunitiesSection.vue")),
  feedback: lazy(() => import("./sections/FeedbackSection.vue")),
};

/** The requested section if it exists AND is visible to this person, else the default. */
const current = computed<SettingsSectionId>(() => {
  const requested = route.query.section;
  if (isSettingsSection(requested) && visible.value.some((s) => s.id === requested)) return requested;
  return DEFAULT_SETTINGS_SECTION;
});
const currentDef = computed(() => settingsSection(current.value));

/**
 * Phones (< 768 px) get a mobile screen instead of the desktop shell: with no
 * section, the grouped settings list; with one, that section full width under
 * a back header. The SAME section components render in both — one state, one
 * persistence layer.
 */
const isMobile = useIsMobile();
const mobileList = computed(() => isMobile.value && !isSettingsSection(route.query.section));

// Normalize an unknown/hidden section in the URL without adding history
// (the mobile settings list is the one screen without a section).
watch(
  () => [route.query.section, current.value, mobileList.value] as const,
  ([requested, resolved, list]) => {
    if (list && requested === undefined) return;
    if (requested !== resolved) void router.replace({ query: { ...route.query, section: resolved } });
  },
  { immediate: true },
);

function select(id: SettingsSectionId) {
  if (id === current.value && !mobileList.value) return;
  if (mobileList.value) {
    // From the phone list: a real step, so Back returns to the list.
    void router.push({ query: { ...route.query, section: id, via: "list" } });
    return;
  }
  // Replace, not push: Back leaves Settings in one step (as in OLD BUZZ).
  void router.replace({ query: { ...route.query, section: id } });
  void nextTick(() => document.getElementById("settings-content")?.scrollTo({ top: 0 }));
}

function backToApp() {
  const from = typeof route.query.from === "string" ? route.query.from : null;
  // Only ever an in-app path — never an arbitrary URL from the query string.
  if (from && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/settings")) {
    void router.push(from);
  } else {
    void router.push({ name: isMobile.value ? "mobile-profile" : "channels" });
  }
}

/** Mobile header back: a section opened from the settings list returns to it; otherwise back to the app. */
function mobileBack() {
  if (!mobileList.value && route.query.via === "list") {
    const rest = Object.fromEntries(Object.entries(route.query).filter(([k]) => k !== "section" && k !== "via"));
    void router.replace({ query: rest });
    return;
  }
  backToApp();
}
// Keyboard-safe forms on phones: the screen is exactly the visible viewport
// (the same `--app-height` tracking the mobile frame uses), so a focused
// field scrolls into the space above the keyboard instead of under it.
let stopViewport: (() => void) | null = null;
watch(
  isMobile,
  (mobile) => {
    stopViewport?.();
    stopViewport = mobile ? startViewportTracking() : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => stopViewport?.());

// Phone: an edge swipe is the header back (section → list → app), same rules.
const mobileScreen = ref<HTMLElement | null>(null);
useSwipeBack(mobileScreen, { enabled: () => isMobile.value, onBack: mobileBack });

const mobileGroups = computed(() =>
  SETTINGS_GROUPS.map((group) => ({ ...group, sections: visible.value.filter((s) => s.group === group.id) })).filter(
    (g) => g.sections.length > 0,
  ),
);

// Escape closes Settings — unless a dialog/menu already consumed it.
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
  backToApp();
}

const search = ref("");
const results = computed(() => searchSettings(search.value, visible.value));
const grouped = computed(() =>
  SETTINGS_GROUPS.map((group) => ({ ...group, sections: results.value.filter((s) => s.group === group.id) })).filter(
    (g) => g.sections.length > 0,
  ),
);
function onSearchEnter() {
  const first = results.value[0];
  if (first) select(first.id);
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  void loadAppVersion();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <!-- Phone: a mobile screen (list, or one section) over the same sections. -->
  <div v-if="isMobile" ref="mobileScreen" class="m-settings" data-testid="settings-view" :data-mobile-screen="mobileList ? 'list' : current">
    <header class="m-bar">
      <button
        type="button"
        class="m-back"
        :aria-label="mobileList || route.query.via !== 'list' ? 'Back to app' : 'Back to settings'"
        data-testid="settings-mobile-back"
        @click="mobileBack"
      >
        <AppIcon name="chevron-left" :size="24" />
      </button>
      <p class="m-bar-title" aria-hidden="true">{{ mobileList ? "Settings" : currentDef.label }}</p>
    </header>
    <main id="settings-content" class="m-body">
      <nav v-if="mobileList" class="m-list" aria-label="Settings sections">
        <h1 class="sr-only">Settings</h1>
        <section v-for="group in mobileGroups" :key="group.id" class="m-group" :aria-labelledby="`m-group-${group.id}`">
          <h2 :id="`m-group-${group.id}`" class="m-group-label">{{ group.label }}</h2>
          <button
            v-for="section in group.sections"
            :key="section.id"
            type="button"
            class="m-item"
            :data-testid="`settings-mobile-item-${section.id}`"
            @click="select(section.id)"
          >
            <span class="m-item-icon" aria-hidden="true"><AppIcon :name="section.icon" :size="20" /></span>
            <span class="m-item-text">
              <span class="m-item-label">{{ section.label }}</span>
              <span class="m-item-sub">{{ section.description }}</span>
            </span>
            <AppIcon name="chevron-right" :size="20" class="m-chev" />
          </button>
        </section>
        <p class="m-version" data-testid="settings-version">SWF Buzz v{{ appVersion }}</p>
      </nav>
      <div v-else class="m-section">
        <Suspense>
          <component :is="SECTION_COMPONENTS[current]" :key="current" />
          <template #fallback>
            <StateView kind="loading" :title="`Loading ${currentDef.label}…`" />
          </template>
        </Suspense>
      </div>
    </main>
  </div>

  <div v-else class="settings-shell" data-testid="settings-view">
    <aside class="settings-nav" aria-label="Settings navigation">
      <button type="button" class="back" data-testid="settings-back" @click="backToApp">
        <AppIcon name="arrow-left" :size="16" />
        <span>Back to app</span>
      </button>

      <div class="nav-title">Settings</div>

      <label class="search">
        <AppIcon name="search" :size="16" />
        <input
          v-model="search"
          type="search"
          placeholder="Search settings"
          aria-label="Search settings"
          data-testid="settings-search"
          @keydown.enter.prevent="onSearchEnter"
        />
      </label>

      <nav class="groups">
        <div v-for="group in grouped" :key="group.id" class="group">
          <div class="group-label">{{ group.label }}</div>
          <button
            v-for="section in group.sections"
            :key="section.id"
            type="button"
            class="nav-item"
            :class="{ active: section.id === current }"
            :aria-current="section.id === current ? 'page' : undefined"
            :data-testid="`settings-nav-${section.id}`"
            @click="select(section.id)"
          >
            <span class="nav-icon"><AppIcon :name="section.icon" :size="16" /></span>
            <span class="nav-label">{{ section.label }}</span>
          </button>
        </div>
        <p v-if="grouped.length === 0" class="no-results">No settings match "{{ search }}".</p>
      </nav>

      <footer class="version" data-testid="settings-version">SWF Buzz v{{ appVersion }}</footer>
    </aside>

    <main id="settings-content" class="settings-content">
      <div class="compact-bar">
        <button type="button" class="back compact" aria-label="Back to app" @click="backToApp">
          <AppIcon name="arrow-left" :size="16" />
        </button>
        <label class="compact-picker">
          <span class="sr-only">Settings section</span>
          <select :value="current" data-testid="settings-compact-picker" @change="select(($event.target as HTMLSelectElement).value as SettingsSectionId)">
            <optgroup v-for="group in SETTINGS_GROUPS" :key="group.id" :label="group.label">
              <option v-for="section in visible.filter((s) => s.group === group.id)" :key="section.id" :value="section.id">
                {{ section.label }}
              </option>
            </optgroup>
          </select>
        </label>
      </div>
      <div class="content-inner">
        <Suspense>
          <component :is="SECTION_COMPONENTS[current]" :key="current" />
          <template #fallback>
            <StateView kind="loading" :title="`Loading ${currentDef.label}…`" />
          </template>
        </Suspense>
      </div>
    </main>
  </div>
</template>

<style scoped>
/*
 * Shell: nav | content. The content column takes ALL remaining width; each
 * page fills it (no centred max-width column), with responsive side padding.
 */
.settings-shell {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  height: 100vh;
  background: var(--color-bg);
  overflow: hidden;
}

/* ---- Navigation ---- */
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  padding: 18px 12px 20px;
  border-right: 1px solid var(--color-border);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--color-surface) 70%, var(--color-bg)) 0%,
    var(--color-bg) 100%
  );
}
.back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  min-height: 44px;
  padding: 0 var(--space-3) 0 var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 550;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}
.back:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.nav-title {
  padding: var(--space-2) var(--space-2) 0;
  font-size: var(--font-size-lg);
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--color-text);
}
.search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 var(--space-1);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-subtle);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.search:focus-within {
  border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
}
.search input {
  flex: 1;
  min-width: 0;
  height: 42px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
}
.groups {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-1);
}
.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group-label {
  padding: 0 var(--space-2) var(--space-1);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 44px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-md);
  text-align: left;
  cursor: pointer;
  transition:
    background 160ms ease,
    color 160ms ease,
    box-shadow 160ms ease;
}
.nav-item:focus-visible,
.back:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 2px;
}
.nav-item:hover {
  background: var(--color-surface-muted);
  color: var(--color-text);
}
.nav-item.active {
  background: var(--color-surface);
  color: var(--color-text);
  font-weight: 600;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--color-primary) 28%, var(--color-border)),
    0 4px 14px color-mix(in srgb, var(--color-primary) 14%, transparent);
}
.nav-item.active::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 9px;
  bottom: 9px;
  width: 3px;
  border-radius: 3px;
  background: var(--color-primary);
}
.nav-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  transition: background 160ms ease, color 160ms ease;
}
.nav-item.active .nav-icon {
  background: color-mix(in srgb, var(--color-primary) 16%, var(--color-surface));
  color: var(--color-primary);
}
.nav-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.no-results {
  margin: 0;
  padding: var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-subtle);
}
.version {
  padding: var(--space-2) var(--space-2) 0;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}

/* ---- Content ---- */
.settings-content {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
}
/* Every settings page inherits this: full width of the content column. */
.content-inner {
  width: 100%;
  max-width: none;
  min-width: 0;
  padding: 40px clamp(24px, 4vw, 64px) 64px;
}
@media (max-width: 1099px) {
  .settings-shell {
    grid-template-columns: 220px minmax(0, 1fr);
  }
}
.compact-bar {
  display: none;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 860px) {
  .settings-shell {
    grid-template-columns: minmax(0, 1fr);
  }
  .settings-nav {
    display: none;
  }
  .compact-bar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-bg) 88%, transparent);
    backdrop-filter: blur(10px);
  }
  .back.compact {
    width: 44px;
    height: 44px;
    padding: 0;
    justify-content: center;
    border-color: var(--color-border);
  }
  .compact-picker {
    flex: 1;
    min-width: 0;
  }
  .compact-picker select {
    width: 100%;
    height: 44px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    font-weight: 600;
  }
  .content-inner {
    padding: var(--space-5) var(--space-4) var(--space-7);
  }
}

/* Buttons and fields inside any settings page meet the 44px touch minimum. */
.settings-content :deep(.base-button),
.m-body :deep(.base-button) {
  height: auto;
  min-height: 44px;
}
.settings-content :deep(input:not([type="checkbox"], [type="radio"], [type="file"], [type="range"])),
.settings-content :deep(select),
.m-body :deep(input:not([type="checkbox"], [type="radio"], [type="file"], [type="range"])),
.m-body :deep(select) {
  min-height: 44px;
}

/* ---- Phone ---- */
/*
  Sideways drags belong to the app, not the browser: only vertical panning
  (and pinch-zoom) is a native touch behaviour here, so a horizontal drag can
  never become the browser's "swipe to go back" and leave the app (Chrome
  ignores the root's overscroll-behavior once a nested scroller has the
  touch). The screen's own edge swipe still sees every touchmove. Sideways
  scrollers, media and fields keep their native horizontal handling.
*/
.m-settings,
.m-settings :deep(*) {
  touch-action: pan-y pinch-zoom;
}
.m-settings :deep([data-hscroll]),
.m-settings :deep([data-hscroll] *),
.m-settings :deep(input),
.m-settings :deep(textarea),
.m-settings :deep(video),
.m-settings :deep(audio) {
  touch-action: manipulation;
}
.m-settings {
  display: flex;
  flex-direction: column;
  height: var(--app-height, 100dvh);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  background: var(--color-bg);
  color: var(--color-text);
}
.m-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 56px;
  padding: env(safe-area-inset-top) var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}
.m-back {
  flex: none;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: none;
  color: var(--color-text);
}
.m-back:active {
  background: var(--color-surface-muted);
}
.m-back:focus-visible,
.m-item:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
.m-bar-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-lg);
  font-weight: 700;
}
.m-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom));
}
.m-group {
  margin-top: var(--space-4);
}
.m-group-label {
  margin: 0;
  padding: 0 var(--space-4) var(--space-2);
  color: var(--color-text-subtle);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.m-item {
  width: 100%;
  min-height: 60px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border: none;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.m-group .m-item:last-child {
  border-bottom: 1px solid var(--color-border);
}
.m-item:active {
  background: var(--color-surface-muted);
}
.m-item-icon {
  flex: none;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface));
  color: var(--color-primary);
}
.m-item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-item-label {
  font-weight: 600;
}
.m-item-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.m-chev {
  flex: none;
  color: var(--color-text-subtle);
}
.m-version {
  margin: var(--space-5) var(--space-4) 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.m-section,
.m-list {
  animation: m-settings-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.m-section {
  padding: var(--space-4);
}
@keyframes m-settings-in {
  from {
    opacity: 0.4;
    transform: translateX(12px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .m-section,
  .m-list {
    animation: none;
  }
}
/* The header already names the page; the page's h1 stays for assistive tech. */
.m-section :deep(.page-header h1) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
/* Page actions (e.g. "Add community") go under the description on a phone. */
.m-section :deep(.page-header) {
  grid-template-columns: minmax(0, 1fr);
}
.m-section :deep(.page-actions) {
  grid-column: 1;
  grid-row: auto;
  justify-self: start;
}
.m-section :deep(input),
.m-section :deep(textarea),
.m-section :deep(select) {
  font-size: 16px; /* no iOS zoom on focus */
}

@media (prefers-reduced-motion: reduce) {
  .settings-content {
    scroll-behavior: auto;
  }
}
</style>
