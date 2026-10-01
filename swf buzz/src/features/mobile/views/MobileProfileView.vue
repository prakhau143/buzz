<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import MobileLayout from "../ui/MobileLayout.vue";
import MobileHeader from "../ui/MobileHeader.vue";
import { useSessionStore } from "@/stores/session";
import { useProfile } from "@/composables/useProfile";
import { usePresenceOf } from "@/features/presence/presenceSync";
import { useCommunitySwitch } from "@/features/communities/useCommunitySwitch";
import { shortKey } from "@/features/identity/format";
import { useCapabilities } from "@/features/access/capabilities";
import { SETTINGS_GROUPS, visibleSettingsSections } from "@/features/settings/settingsRegistry";

/**
 * Mobile Profile — Phase B shell: who you are (the canonical profile + the one
 * presence store) and every Settings section this person may see, grouped as
 * in Settings (the same allowlist). Each opens the mobile Settings screen for
 * that section, which renders the same section component as desktop.
 */
const session = useSessionStore();
const { data: me } = useProfile(() => session.pubkey);
const presence = usePresenceOf(() => session.pubkey);
const { current } = useCommunitySwitch();
const name = computed(() => me.value?.displayName ?? shortKey(session.pubkey));
const STATUS = { online: "Online", away: "Away", offline: "Offline" } as const;

const can = useCapabilities();
const groups = computed(() => {
  const visible = visibleSettingsSections({ canManageCommunity: can.value.canManageCommunityMembers });
  return SETTINGS_GROUPS.map((g) => ({ ...g, sections: visible.filter((s) => s.group === g.id) })).filter((g) => g.sections.length);
});
</script>

<template>
  <MobileLayout show-nav>
    <template #header>
      <MobileHeader title="Profile" />
    </template>
    <div class="profile">
      <div class="me" data-testid="mobile-profile-card">
        <AvatarCircle :name="name" :avatar-url="me?.avatarUrl" :pubkey="session.pubkey" :size="64" />
        <div class="me-text">
          <p class="me-name">{{ name }}</p>
          <p class="me-meta">{{ presence ? STATUS[presence] : "" }}<template v-if="presence && current.name"> · </template>{{ current.name }}</p>
        </div>
      </div>

      <nav aria-label="Settings">
        <template v-for="group in groups" :key="group.id">
          <h2 class="section-label">{{ group.label }}</h2>
          <div class="list">
            <RouterLink
              v-for="section in group.sections"
              :key="section.id"
              class="item"
              :to="{ name: 'settings', query: { section: section.id, from: '/m/profile' } }"
              :data-testid="`mobile-settings-${section.id}`"
            >
              <AppIcon :name="section.icon" :size="20" class="item-icon" />
              <span class="item-label">{{ section.label }}</span>
              <AppIcon name="chevron-right" :size="20" class="chev" />
            </RouterLink>
          </div>
        </template>
      </nav>
    </div>
  </MobileLayout>
</template>

<style scoped>
.profile {
  padding: var(--space-4);
}
.me {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}
.me-text {
  min-width: 0;
}
.me-name {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.me-meta {
  margin: 2px 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.section-label {
  margin: var(--space-5) 0 var(--space-2);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
}
.list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  overflow: hidden;
}
.item {
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-4);
  color: var(--color-text);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.item + .item {
  border-top: 1px solid var(--color-border);
}
.item:active {
  background: var(--color-surface-muted);
}
.item:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: -2px;
}
.item-icon {
  color: var(--color-text-muted);
}
.item-label {
  flex: 1;
  font-weight: 500;
}
.chev {
  color: var(--color-text-subtle);
}
</style>
