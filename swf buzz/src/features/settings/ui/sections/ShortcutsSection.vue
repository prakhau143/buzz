<script setup lang="ts">
/**
 * Settings → Shortcuts. Rendered straight from the shortcut registry the
 * handlers themselves are driven by (shortcutRegistry.ts), so what is shown
 * here is exactly what works. Read-only, like OLD BUZZ.
 */
import { computed } from "vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import SettingsRow from "../primitives/SettingsRow.vue";
import { SHORTCUTS, SHORTCUT_CATEGORIES, isMacPlatform, shortcutKeys } from "@/features/shortcuts/shortcutRegistry";

const mac = isMacPlatform();
const groups = computed(() =>
  SHORTCUT_CATEGORIES.map((category) => ({ category, items: SHORTCUTS.filter((s) => s.category === category) })).filter(
    (g) => g.items.length,
  ),
);
</script>

<template>
  <SettingsPage title="Shortcuts" description="Keyboard shortcuts in SWF Buzz. They can't be changed yet.">
    <SettingsCard v-for="group in groups" :key="group.category" :title="group.category">
      <SettingsRow v-for="s in group.items" :key="s.id" :label="s.label" :data-testid="`shortcut-${s.id}`">
        <span class="keys" :aria-label="shortcutKeys(s, mac).join(' ')">
          <kbd v-for="(k, i) in shortcutKeys(s, mac)" :key="i">{{ k }}</kbd>
        </span>
      </SettingsRow>
    </SettingsCard>
  </SettingsPage>
</template>

<style scoped>
.keys {
  display: inline-flex;
  gap: 4px;
}
kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 7px;
  border: 1px solid var(--color-border);
  border-bottom-width: 2px;
  border-radius: 7px;
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-weight: 600;
}
</style>
