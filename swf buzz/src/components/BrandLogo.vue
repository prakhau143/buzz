<script setup lang="ts">
/**
 * Clickable brand mark used in the persistent header (`AppHeader.vue`) —
 * always navigates Home, keyboard-accessible via native `<RouterLink>`
 * (renders an `<a>`, focusable/Enter-activatable by default).
 */
import logoUrl from "@/assets/brand/swf-buzz-logo.svg";
</script>

<template>
  <RouterLink to="/" class="brand-logo" aria-label="SWF Buzz home">
    <img :src="logoUrl" width="32" height="32" alt="" class="brand-mark" />
    <span class="brand-wordmark"><span class="brand-swf">SWF</span> <span class="brand-buzz">Buzz</span></span>
  </RouterLink>
</template>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  text-decoration: none;
  border-radius: var(--radius-md);
  transition: opacity var(--transition-fast);
}
.brand-logo:hover,
.brand-logo:focus-visible {
  opacity: 0.85;
}
.brand-logo:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
.brand-mark {
  display: block;
  flex-shrink: 0;
}
.brand-wordmark {
  font-size: var(--font-size-lg);
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.brand-swf {
  font-weight: 700;
  color: var(--color-brand-dark);
}
.brand-buzz {
  font-weight: 500;
  color: var(--color-brand);
}
</style>
