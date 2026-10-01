<script setup lang="ts">
/**
 * Settings → Invites (owners/admins; the relay enforces it — `POST /api/invites`
 * answers 403 to anyone else). Opening this page makes NO network call: an
 * invite is minted only when "Create invite link" is pressed
 * (CreateRelayInvitePanel). There is no list/revoke: the relay has no such
 * endpoint, so none is shown (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md §10).
 */
import { computed } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import CreateRelayInvitePanel from "@/features/communities/ui/CreateRelayInvitePanel.vue";
import { activeRelayUrl, communities, relayHost } from "@/features/communities/relayCommunities";

const relay = computed(() => activeRelayUrl.value ?? "");
const name = computed(() => communities.value.find((c) => c.relayUrl === relay.value)?.name ?? relayHost(relay.value));
</script>

<template>
  <SettingsPage title="Invites" :description="`Invite people to ${name}.`">
    <SettingsCard title="New invite link">
      <div class="panel"><CreateRelayInvitePanel :relay-url="relay" :community-name="name" /></div>
    </SettingsCard>
    <p class="note">
      <AppIcon name="info" :size="16" />
      Links expire on their own. Existing links can't be listed or revoked yet — the community server doesn't support it.
    </p>
  </SettingsPage>
</template>

<style scoped>
.panel {
  padding: var(--space-5);
}
.note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
</style>
