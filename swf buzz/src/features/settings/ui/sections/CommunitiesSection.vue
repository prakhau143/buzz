<script setup lang="ts">
/**
 * Settings → Communities. The communities this identity can ACTUALLY open —
 * the same list the community rail and switcher use (`useCommunitySwitch` →
 * `useAccessibleCommunities`: signed membership probe + the relay-signed
 * roster role; owner / admin / member only). Nothing here is stored as
 * authority, and there is no second community store.
 *
 * Switching is the shared, membership-VERIFIED switch (re-verified right before
 * leaving; the previous community is restored on failure). Roles are the
 * community plane; operator access is the deployment plane and is shown on its
 * own line — an operator is not thereby an owner of anything, and an owner is
 * not an operator.
 */
import { computed, onMounted } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import CommunityAvatar from "@/features/communities/ui/CommunityAvatar.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import { useCommunitySwitch } from "@/features/communities/useCommunitySwitch";
import { communities, relayHost } from "@/features/communities/relayCommunities";
import { useConnectionStore } from "@/stores/connection";
import { useSessionStore } from "@/stores/session";
import { useCapabilities } from "@/features/access/capabilities";
import type { ConnectionStatus } from "@/types/domain";

const session = useSessionStore();
const connection = useConnectionStore();
const can = useCapabilities();
const { current, accessible, verifying, verified, refresh, switchTo, switchingTo, switchError, clearError, openAddCommunity } =
  useCommunitySwitch();

onMounted(() => void refresh());

const ROLE: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const nameOf = (url: string, fallback: string) => communities.value.find((c) => c.relayUrl === url)?.name ?? fallback;

/** The open community first, then the rest by name. */
const rows = computed(() => {
  const list = accessible.value.map((m) => ({
    url: m.relayUrl,
    name: nameOf(m.relayUrl, m.name || relayHost(m.relayUrl)),
    host: m.host || relayHost(m.relayUrl),
    role: m.role ? ROLE[m.role] : null,
    open: m.relayUrl === current.value.url,
  }));
  // The open community is always listed, with the role this session holds there.
  if (current.value.url && !list.some((r) => r.open)) {
    list.push({
      url: current.value.url,
      name: current.value.name,
      host: current.value.host,
      role: session.communityRole ? ROLE[session.communityRole] : null,
      open: true,
    });
  }
  return list.sort((a, b) => Number(b.open) - Number(a.open) || a.name.localeCompare(b.name));
});

const STATUS: Record<ConnectionStatus, { label: string; tone: "ok" | "busy" | "bad" }> = {
  connected: { label: "Connected", tone: "ok" },
  connecting: { label: "Connecting…", tone: "busy" },
  reconnecting: { label: "Reconnecting…", tone: "busy" },
  disconnected: { label: "Offline", tone: "bad" },
  auth_failed: { label: "Not authorized", tone: "bad" },
  error: { label: "Connection error", tone: "bad" },
};
const openStatus = computed(() => STATUS[connection.status] ?? STATUS.connecting);

async function open(url: string) {
  clearError();
  await switchTo(url);
}
</script>

<template>
  <SettingsPage title="Communities" description="Every community this identity can open. Membership is checked with each community, never assumed.">
    <template #actions>
      <BaseButton variant="secondary" data-testid="communities-add" @click="openAddCommunity">
        <AppIcon name="plus" :size="16" /> Add community
      </BaseButton>
    </template>

    <p v-if="switchError" class="notice error" role="alert" data-testid="communities-error">
      <AppIcon name="warning" :size="16" />
      <span>{{ switchError }}</span>
    </p>

    <SettingsCard title="Your communities" :description="verifying ? 'Checking membership…' : undefined">
      <ul class="rows" :aria-busy="verifying && !verified" data-testid="communities-list">
        <li v-for="row in rows" :key="row.url" class="row" :class="{ open: row.open }" data-testid="communities-row">
          <CommunityAvatar :relay-url="row.url" :name="row.name" :size="40" />
          <div class="text">
            <span class="name">{{ row.name }}</span>
            <span class="meta">
              <span v-if="row.role" class="role" data-testid="communities-role">{{ row.role }}</span>
              <span v-else class="role unknown">Role not confirmed</span>
              <span class="host">{{ row.host }}</span>
            </span>
          </div>
          <span v-if="row.open" class="status" :class="openStatus.tone" data-testid="communities-status">
            <span class="dot" aria-hidden="true" />{{ openStatus.label }}
          </span>
          <BaseButton
            v-else
            variant="secondary"
            :disabled="!!switchingTo"
            :aria-label="`Switch to ${row.name}`"
            data-testid="communities-switch"
            @click="open(row.url)"
          >
            {{ switchingTo === row.url ? "Switching…" : "Switch" }}
          </BaseButton>
        </li>
        <li v-if="verified && rows.length <= 1" class="empty" data-testid="communities-only">
          This is the only community this identity belongs to.
        </li>
      </ul>
    </SettingsCard>

    <SettingsCard title="Access" description="Two separate kinds of access. Neither implies the other.">
      <div class="access">
        <div class="access-row">
          <span class="access-label">Role in {{ current.name }}</span>
          <span class="access-value" data-testid="communities-community-role">{{ session.communityRole ? ROLE[session.communityRole] : "Not a member" }}</span>
        </div>
        <div class="access-row">
          <span class="access-label">Deployment access</span>
          <span class="access-value" data-testid="communities-platform-role">
            {{ can.canAccessOperatorDashboard ? "Operator" : "None" }}
          </span>
        </div>
        <p class="access-note">
          Owner, admin and member are roles inside one community. Operator is deployment-wide access to run SWF
          Buzz — it doesn't make anyone an owner of a community, and owning a community doesn't make anyone an operator.
        </p>
      </div>
    </SettingsCard>
  </SettingsPage>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}
.notice.error {
  background: var(--color-danger-muted);
  color: var(--color-text);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 68px;
  padding: var(--space-3) var(--space-4);
}
.row + .row {
  border-top: 1px solid var(--color-border);
}
.row.open {
  background: color-mix(in srgb, var(--color-primary) 5%, transparent);
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.role {
  flex: none;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-weight: 600;
}
.role.unknown {
  color: var(--color-text-muted);
  font-weight: 500;
}
.host {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  font-weight: 600;
}
.status .dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: currentColor;
}
.status.ok {
  color: var(--color-success);
}
.status.busy {
  color: var(--color-warning);
}
.status.bad {
  color: var(--color-danger);
}
.row :deep(button) {
  min-height: 44px;
}
.empty {
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.access {
  display: flex;
  flex-direction: column;
}
.access-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 52px;
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.access-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.access-value {
  flex: none;
  font-weight: 600;
}
.access-note {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  max-width: 70ch;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
</style>
