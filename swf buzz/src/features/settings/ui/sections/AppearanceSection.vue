<script setup lang="ts">
/**
 * Settings → Appearance. Device-local (features/appearance/appearance.ts):
 * applies instantly, and "Saved" appears only when this device actually
 * stored the choice.
 */
import { computed, ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import SettingsRow from "../primitives/SettingsRow.vue";
import SegmentedControl from "../primitives/SegmentedControl.vue";
import SaveIndicator from "../primitives/SaveIndicator.vue";
import {
  ACCENTS,
  DARK_THEMES,
  LIGHT_THEMES,
  ZOOM_MAX,
  ZOOM_MIN,
  useAppearance,
  type AppearancePrefs,
  type ColorMode,
  type Density,
  type FontSize,
} from "@/features/appearance/appearance";
import { shortcutHint } from "@/features/shortcuts/shortcutRegistry";

const { prefs, resolvedScheme, set, reset, zoomBy } = useAppearance();

const saveState = ref<"idle" | "saved" | "error">("idle");
let savedTimer: ReturnType<typeof setTimeout> | undefined;
function update(patch: Partial<AppearancePrefs>) {
  const ok = set(patch);
  saveState.value = ok ? "saved" : "error";
  clearTimeout(savedTimer);
  if (ok) savedTimer = setTimeout(() => (saveState.value = "idle"), 1800);
}

function resetAll() {
  const ok = reset();
  saveState.value = ok ? "saved" : "error";
  clearTimeout(savedTimer);
  if (ok) savedTimer = setTimeout(() => (saveState.value = "idle"), 1800);
}

const modeOptions: { value: ColorMode; label: string; icon: "monitor" | "sun" | "moon" }[] = [
  { value: "system", label: "System", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];
const sizeOptions: { value: FontSize; label: string }[] = [
  { value: "smaller", label: "Smaller" },
  { value: "default", label: "Default" },
  { value: "larger", label: "Larger" },
];
const densityOptions: { value: Density; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
];

const showLight = computed(() => prefs.value.mode !== "dark");
const showDark = computed(() => prefs.value.mode !== "light");
const zoomPercent = computed(() => `${Math.round(prefs.value.zoom * 100)}%`);
</script>

<template>
  <SettingsPage title="Appearance" description="How SWF Buzz looks on this device.">
    <template #actions><SaveIndicator :state="saveState === 'idle' ? 'idle' : saveState" error="Couldn't save on this device" /></template>

    <SettingsCard title="Color mode">
      <SettingsRow label="Mode" :description="prefs.mode === 'system' ? `Following your system (${resolvedScheme})` : undefined">
        <SegmentedControl
          :model-value="prefs.mode"
          :options="modeOptions"
          label="Color mode"
          @update:model-value="(v) => update({ mode: v })"
        />
      </SettingsRow>
    </SettingsCard>

    <SettingsCard v-if="showLight" title="Light theme" plain>
      <div class="theme-grid" role="radiogroup" aria-label="Light theme">
        <button
          v-for="t in LIGHT_THEMES"
          :key="t.id"
          type="button"
          role="radio"
          class="theme-tile"
          :class="{ active: prefs.lightTheme === t.id }"
          :aria-checked="prefs.lightTheme === t.id"
          :data-testid="`theme-${t.id}`"
          @click="update({ lightTheme: t.id })"
        >
          <span class="preview" :data-preview="t.id">
            <span class="p-side" /><span class="p-main"><span class="p-line" /><span class="p-line short" /><span class="p-accent" /></span>
          </span>
          <span class="tile-label">{{ t.label }}<AppIcon v-if="prefs.lightTheme === t.id" name="check" :size="16" /></span>
        </button>
      </div>
    </SettingsCard>

    <SettingsCard v-if="showDark" title="Dark theme" plain>
      <div class="theme-grid" role="radiogroup" aria-label="Dark theme">
        <button
          v-for="t in DARK_THEMES"
          :key="t.id"
          type="button"
          role="radio"
          class="theme-tile"
          :class="{ active: prefs.darkTheme === t.id }"
          :aria-checked="prefs.darkTheme === t.id"
          :data-testid="`theme-${t.id}`"
          @click="update({ darkTheme: t.id })"
        >
          <span class="preview" :data-preview="t.id">
            <span class="p-side" /><span class="p-main"><span class="p-line" /><span class="p-line short" /><span class="p-accent" /></span>
          </span>
          <span class="tile-label">{{ t.label }}<AppIcon v-if="prefs.darkTheme === t.id" name="check" :size="16" /></span>
        </button>
      </div>
    </SettingsCard>

    <SettingsCard title="Accent">
      <SettingsRow label="Accent color" description="Buttons, highlights and focus rings.">
        <div class="swatches" role="radiogroup" aria-label="Accent color">
          <button
            v-for="a in ACCENTS"
            :key="a.id"
            type="button"
            role="radio"
            class="swatch"
            :class="{ active: prefs.accent === a.id }"
            :data-swatch="a.id"
            :aria-checked="prefs.accent === a.id"
            :aria-label="a.label"
            :title="a.label"
            @click="update({ accent: a.id })"
          />
        </div>
      </SettingsRow>
    </SettingsCard>

    <SettingsCard title="Text and layout">
      <SettingsRow label="Text size">
        <SegmentedControl
          :model-value="prefs.fontSize"
          :options="sizeOptions"
          label="Text size"
          @update:model-value="(v) => update({ fontSize: v })"
        />
      </SettingsRow>
      <SettingsRow label="Conversation density" description="Spacing between messages.">
        <SegmentedControl
          :model-value="prefs.density"
          :options="densityOptions"
          label="Conversation density"
          @update:model-value="(v) => update({ density: v })"
        />
      </SettingsRow>
      <SettingsRow label="Zoom" :description="`${shortcutHint('zoom-in')} / ${shortcutHint('zoom-out')} / ${shortcutHint('zoom-reset')}`">
        <div class="zoom">
          <button type="button" class="zoom-btn" aria-label="Zoom out" :disabled="prefs.zoom <= ZOOM_MIN" @click="zoomBy(-1)">−</button>
          <span class="zoom-value" data-testid="zoom-value">{{ zoomPercent }}</span>
          <button type="button" class="zoom-btn" aria-label="Zoom in" :disabled="prefs.zoom >= ZOOM_MAX" @click="zoomBy(1)">+</button>
          <BaseButton variant="ghost" :disabled="prefs.zoom === 1" @click="zoomBy(0)">Reset</BaseButton>
        </div>
      </SettingsRow>
    </SettingsCard>

    <div class="reset-all">
      <BaseButton variant="ghost" data-testid="appearance-reset" @click="resetAll">Restore defaults</BaseButton>
    </div>
  </SettingsPage>
</template>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
}
.theme-tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease,
    border-color 160ms ease;
}
.theme-tile:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}
.theme-tile.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
}
.preview {
  display: flex;
  height: 74px;
  overflow: hidden;
  border-radius: var(--radius-md);
  border: 1px solid rgba(127, 127, 127, 0.18);
}
.p-side {
  width: 30%;
}
.p-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
}
.p-line {
  height: 6px;
  border-radius: 3px;
  opacity: 0.55;
}
.p-line.short {
  width: 60%;
}
.p-accent {
  width: 38%;
  height: 10px;
  margin-top: auto;
  border-radius: 5px;
  background: var(--color-primary);
}
/* Previews use each theme's own surface/text values, independent of the active theme. */
[data-preview="swf-light"] { background: #ffffff; } [data-preview="swf-light"] .p-side { background: #f1ece2; } [data-preview="swf-light"] .p-line { background: #242321; }
[data-preview="paper"] { background: #ffffff; } [data-preview="paper"] .p-side { background: #eef0f3; } [data-preview="paper"] .p-line { background: #1d2129; }
[data-preview="sky"] { background: #ffffff; } [data-preview="sky"] .p-side { background: #e8f0f8; } [data-preview="sky"] .p-line { background: #15212f; }
[data-preview="swf-dark"] { background: #141a2a; } [data-preview="swf-dark"] .p-side { background: #0e1320; } [data-preview="swf-dark"] .p-line { background: #e7eaf3; }
[data-preview="midnight"] { background: #0e121e; } [data-preview="midnight"] .p-side { background: #080b14; } [data-preview="midnight"] .p-line { background: #e4e8f4; }
[data-preview="graphite"] { background: #191a1c; } [data-preview="graphite"] .p-side { background: #121314; } [data-preview="graphite"] .p-line { background: #ececee; }
[data-preview="ocean"] { background: #0f1f27; } [data-preview="ocean"] .p-side { background: #0a171d; } [data-preview="ocean"] .p-line { background: #e3eef1; }
.tile-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-1);
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text);
}
.tile-label :deep(svg) {
  color: var(--color-primary);
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
/* A 44 px target around a 28 px colour disc; the selected one gets a ring. */
.swatch {
  width: 44px;
  height: 44px;
  padding: 8px;
  border: none;
  border-radius: 50%;
  background-clip: content-box;
  cursor: pointer;
  box-shadow: none;
  transition: transform 150ms ease, box-shadow 150ms ease;
}
.swatch:focus-visible {
  outline: 2px solid var(--focus-ring-color);
  outline-offset: 0;
}
.swatch:hover {
  transform: scale(1.1);
}
.swatch.active {
  box-shadow: inset 0 0 0 2px var(--color-text);
}
[data-swatch="terracotta"] { background-color: #b1592f; }
[data-swatch="indigo"] { background-color: #4f5bd5; }
[data-swatch="emerald"] { background-color: #1f8a5b; }
[data-swatch="violet"] { background-color: #7a4fd0; }
[data-swatch="rose"] { background-color: #c33e62; }
[data-swatch="amber"] { background-color: #b36b00; }
[data-swatch="cyan"] { background-color: #0b7f95; }
.zoom {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.zoom-btn {
  width: 44px;
  height: 44px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 16px;
  cursor: pointer;
}
.zoom-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.zoom-value {
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.reset-all {
  display: flex;
  justify-content: flex-end;
}
</style>
