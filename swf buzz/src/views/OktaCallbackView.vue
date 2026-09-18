<script setup lang="ts">
/**
 * Browser-only Okta redirect target — `/callback`, matching the redirect
 * URI registered in Okta for this origin (see docs/WEB_LOCAL_DEVELOPMENT.md).
 * Never reached in the native Tauri build, which uses a custom URL scheme
 * deep link instead (`src-tauri/src/auth/oidc.rs`) and has no equivalent
 * route in the SPA at all.
 */
import { onMounted } from "vue";
import StateView from "@/components/StateView.vue";
import { useAuth } from "@/features/auth/useAuth";

const { isLoading, error, completeOktaBrowserLogin } = useAuth();

onMounted(() => {
  void completeOktaBrowserLogin();
});
</script>

<template>
  <div class="callback-page">
    <StateView v-if="isLoading || !error" kind="loading" title="Finishing sign-in…" />
    <StateView
      v-else
      kind="error"
      title="Sign-in failed"
      :description="error"
      retry-label="Back to login"
      @retry="$router.push({ name: 'login' })"
    />
  </div>
</template>

<style scoped>
.callback-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
}
</style>
