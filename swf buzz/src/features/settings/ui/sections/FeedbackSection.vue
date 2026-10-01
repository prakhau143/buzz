<script setup lang="ts">
/**
 * Settings → Send feedback. The SAME feedback flow as the profile menu
 * (`SendFeedbackDialog` → kind 42000 over the open community's relay → the
 * deployment's feedback inbox, read by SWF operators) — no second form, no
 * second transport. This page only says plainly who reads it and what is sent.
 */
import { ref } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import BaseButton from "@/components/BaseButton.vue";
import SettingsPage from "../primitives/SettingsPage.vue";
import SettingsCard from "../primitives/SettingsCard.vue";
import SendFeedbackDialog from "@/features/feedback/ui/SendFeedbackDialog.vue";
import { FEEDBACK_CATEGORIES } from "@/features/feedback/feedbackModel";

const open = ref(false);
</script>

<template>
  <SettingsPage title="Send feedback" description="Tell the SWF team what's broken, what works well, or what could be better.">
    <SettingsCard plain>
      <div class="hero">
        <span class="hero-icon" aria-hidden="true"><AppIcon name="message" :size="24" /></span>
        <div class="hero-text">
          <p class="hero-title">We read every message</p>
          <p class="hero-sub">
            Pick a category, describe it, and add screenshots or a short MP4 if it helps.
          </p>
          <ul class="categories" aria-label="Feedback categories">
            <li v-for="c in FEEDBACK_CATEGORIES" :key="c.id">
              <strong>{{ c.label }}</strong> — {{ c.hint }}
            </li>
          </ul>
        </div>
        <BaseButton variant="primary" data-testid="settings-feedback-open" @click="open = true">
          Write feedback
        </BaseButton>
      </div>
    </SettingsCard>

    <SettingsCard title="Where it goes" description="Private to this SWF deployment.">
      <ul class="facts">
        <li>
          <AppIcon name="lock" :size="16" />
          <span>Only the people who run this SWF Buzz deployment read feedback. Community members, owners and admins don't see it.</span>
        </li>
        <li>
          <AppIcon name="user" :size="16" />
          <span>It is signed with your public key so the team can follow up. Your private key never leaves your signer and is never included.</span>
        </li>
        <li>
          <AppIcon name="monitor" :size="16" />
          <span>Diagnostics are off unless you tick them: app version, platform, browser and language only — no logs, with anything key-like removed.</span>
        </li>
      </ul>
    </SettingsCard>

    <!-- Out of the (animated) page box, so the overlay covers the whole viewport. -->
    <Teleport to="body">
      <SendFeedbackDialog v-if="open" @close="open = false" />
    </Teleport>
  </SettingsPage>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 14px);
  background: var(--color-surface);
}
.hero-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  background: var(--color-primary-muted);
  color: var(--color-primary);
}
.hero-text {
  flex: 1;
  min-width: 0;
}
.hero-title {
  margin: 0;
  font-weight: 700;
}
.hero-sub {
  margin: var(--space-1) 0 var(--space-2);
  color: var(--color-text-muted);
}
.categories {
  margin: 0;
  padding-left: 1.1em;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.categories strong {
  color: var(--color-text);
}
.facts {
  list-style: none;
  margin: 0;
  padding: 0;
}
.facts li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.facts li + li {
  border-top: 1px solid var(--color-border);
}
.facts :deep(svg) {
  flex: none;
  margin-top: 2px;
  color: var(--color-text-subtle);
}
@media (max-width: 640px) {
  .hero {
    flex-direction: column;
  }
  .hero :deep(.base-button) {
    width: 100%;
  }
}
</style>
