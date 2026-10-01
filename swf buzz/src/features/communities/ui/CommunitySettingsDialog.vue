<script setup lang="ts">
import { computed, ref } from "vue";
import OverlayDialog from "@/components/OverlayDialog.vue";
import BaseButton from "@/components/BaseButton.vue";
import AppIcon from "@/components/AppIcon.vue";
import { useSessionStore } from "@/stores/session";
import { activeRelayUrl, communities, relayHost, renameCommunity } from "../relayCommunities";

/**
 * Community settings, grounded in what OLD BUZZ's "Edit Community" actually
 * does (docs/OLD_BUZZ_COMMUNITY_SETTINGS_REPORT.md):
 *  - Name — a label on THIS device only (the relay stores no community name),
 *    editable by anyone, exactly as in OLD BUZZ.
 *  - Relay URL — the community's identity. Changing it would mean a different
 *    community, so it is shown locked; another community is added from
 *    "Add a community" instead.
 *  - API Token / Repos Directory — OLD BUZZ fields for its local coding agents
 *    (the token is even discarded by OLD BUZZ's own backend). SWF Buzz has no
 *    feature that uses them, so they are not shown rather than faked.
 * The only server-side community setting OLD BUZZ has (the icon, kind:9033,
 * owner/admin) is not implemented here; the role shown is the relay's answer.
 */
const emit = defineEmits<{ close: [] }>();
const session = useSessionStore();

const relay = computed(() => activeRelayUrl.value ?? "");
const currentName = computed(
  () => communities.value.find((c) => c.relayUrl === relay.value)?.name ?? relayHost(relay.value),
);
const name = ref(currentName.value);
const saved = ref(false);
const dirty = computed(() => name.value.trim() !== currentName.value);
const roleLabel = computed(() =>
  session.communityRole ? session.communityRole[0].toUpperCase() + session.communityRole.slice(1) : "Unknown",
);

function save() {
  if (!relay.value || !dirty.value) return;
  renameCommunity(relay.value, name.value);
  saved.value = true;
  setTimeout(() => emit("close"), 600);
}
</script>

<template>
  <OverlayDialog title="Community settings" @close="emit('close')">
    <form class="settings" data-testid="community-settings" @submit.prevent="save">
      <label class="field">
        <span class="label">Name</span>
        <input v-model="name" class="input" maxlength="80" data-testid="community-name" />
        <span class="help">Shown only on this device. Other members may use a different name.</span>
      </label>

      <div class="field">
        <span class="label">Relay URL</span>
        <div class="locked" data-testid="community-relay">
          <span class="mono">{{ relay }}</span>
          <AppIcon name="lock" :size="16" aria-label="Locked" />
        </div>
        <span class="help">The server address is what identifies this community. To use another one, choose “Add a community”.</span>
      </div>

      <div class="field">
        <span class="label">Your role</span>
        <div class="locked" data-testid="community-role-value">
          <span>{{ roleLabel }}</span>
          <AppIcon name="lock" :size="16" aria-label="Set by the server" />
        </div>
        <span class="help">Decided by the community's server; owners and admins change roles from Members &amp; moderation.</span>
      </div>

      <div class="actions">
        <BaseButton type="button" variant="secondary" @click="emit('close')">Cancel</BaseButton>
        <BaseButton type="submit" variant="primary" :disabled="!dirty || saved" data-testid="community-settings-save">
          {{ saved ? "Saved" : "Save changes" }}
        </BaseButton>
      </div>
    </form>
  </OverlayDialog>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.label {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}
.input,
.locked {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}
.locked {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
}
.mono {
  font-family: monospace;
  word-break: break-all;
}
.help {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
