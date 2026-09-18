<script setup lang="ts">
/**
 * Default landing page after login (`app/router/index.ts`'s `home` route,
 * path `/`). Previously the app landed directly on the old Nostr
 * `ChannelsView.vue` with no true dashboard and no way back to a "start
 * here" screen — see the navigation fixes this view is part of.
 *
 * Does not use `AppShell`'s sidebar/main/details 3-pane layout (nothing
 * here needs a secondary sidebar) — just the persistent `AppHeader`
 * (rendered by `App.vue`, above this view) plus a simple centered page.
 */
import { computed } from "vue";
import { useSessionStore } from "@/stores/session";
import { currentCommunityId } from "@/features/communities/currentCommunity";
import { useChannelsHttp } from "@/features/channels/useChannelsHttp";
import CreateCommunityPrompt from "@/features/communities/ui/CreateCommunityPrompt.vue";
import BaseButton from "@/components/BaseButton.vue";
import StateView from "@/components/StateView.vue";

const session = useSessionStore();
const displayName = computed(
  () =>
    session.applicationUser?.displayName ??
    session.applicationUser?.email ??
    session.employeeEmail ??
    "there",
);

const { data: channels, isLoading: channelsLoading } = useChannelsHttp();
const recentChannels = computed(() => (channels.value ?? []).slice(0, 5));
</script>

<template>
  <div class="home-page">
    <div class="home-content">
      <h1 class="greeting">Welcome back, {{ displayName }}</h1>

      <CreateCommunityPrompt v-if="!currentCommunityId" />

      <template v-else>
        <div class="quick-links">
          <RouterLink to="/community" class="quick-link-card">
            <span class="quick-link-title">Channels</span>
            <span class="quick-link-desc">Browse and create channels, send messages, start threads.</span>
          </RouterLink>
          <RouterLink to="/community-dm" class="quick-link-card">
            <span class="quick-link-title">Direct Messages</span>
            <span class="quick-link-desc">Message a teammate one-on-one.</span>
          </RouterLink>
        </div>

        <section class="recent-channels">
          <div class="section-header">
            <h2>Recent channels</h2>
            <RouterLink to="/community" class="create-channel-action">
              <BaseButton variant="secondary">Create channel</BaseButton>
            </RouterLink>
          </div>
          <StateView v-if="channelsLoading" kind="loading" title="Loading channels…" />
          <StateView
            v-else-if="recentChannels.length === 0"
            kind="empty"
            title="No channels yet"
            description="Create your first channel to get started."
          />
          <ul v-else class="channel-list">
            <li v-for="channel in recentChannels" :key="channel.id">
              <RouterLink :to="{ path: '/community', query: { channelId: channel.id } }">
                # {{ channel.name }}
              </RouterLink>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.home-page {
  height: 100%;
  overflow-y: auto;
  display: flex;
  justify-content: center;
  padding: var(--space-7) var(--space-4);
}

.home-content {
  width: 100%;
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.greeting {
  margin: 0;
  font-size: var(--font-size-xl);
  color: var(--color-text);
}

.quick-links {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.quick-link-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  text-decoration: none;
  transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
}
.quick-link-card:hover {
  box-shadow: var(--shadow-sm);
  border-color: var(--color-border-strong);
}

.quick-link-title {
  font-weight: 600;
  color: var(--color-text);
}
.quick-link-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

@media (max-width: 560px) {
  .quick-links {
    grid-template-columns: 1fr;
  }
}

.recent-channels {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-header h2 {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text);
}
.create-channel-action {
  text-decoration: none;
}

.channel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.channel-list a {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text);
  text-decoration: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}
.channel-list a:hover {
  background: var(--color-surface-hover);
}
</style>
