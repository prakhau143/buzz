<script setup lang="ts">
/**
 * Public invite landing page (DECISIONS.md D10, master prompt §9-§11).
 * Reachable without a session — fetches only the safe public preview
 * (`GET /api/invites/:token/preview`) before any login is required. If the
 * user isn't authenticated, "Continue with Okta" stashes the token
 * (`../features/communities/pendingInvite.ts`) so it survives the login
 * round trip, since `loginWithOkta()` unconditionally lands on `channels`
 * afterward — the router guard reads it back and redirects here.
 */
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import StateView from "@/components/StateView.vue";
import BaseButton from "@/components/BaseButton.vue";
import { useSessionStore } from "@/stores/session";
import { useAuth } from "@/features/auth/useAuth";
import { useInvitePreview, useClaimInvite } from "@/features/communities/useInvites";
import { setCurrentCommunityId } from "@/features/communities/currentCommunity";
import {
  setPendingInviteToken,
  clearPendingInviteToken,
} from "@/features/communities/pendingInvite";
import { userMessageFor } from "@/services/errors";
import type { AppError } from "@/services/errors";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const { loginWithOkta, isLoading: isLoggingIn } = useAuth();
// The new-backend session, not the old pubkey/relay `isReady` state
// machine (DECISIONS.md D10) — invites must not depend on relay
// connectivity or role resolution succeeding, only on a valid
// `swf-buzz-backend` bearer session existing.
const isSignedIn = computed(() => session.applicationUser !== null);

const token = computed(() => String(route.params.token ?? ""));
const { data: preview, isLoading: isPreviewLoading, isError: isPreviewError, error: previewError } =
  useInvitePreview(() => token.value);
const { claimInvite, isClaiming, claimError, claimResult } = useClaimInvite();

onMounted(() => {
  // Re-stash on every visit, not just the pre-login click — a page reload
  // mid-flow, or the user navigating away and back, should still resume
  // correctly rather than silently losing the pending invite.
  setPendingInviteToken(token.value);
});

async function handleContinueWithOkta() {
  await loginWithOkta();
}

async function handleJoin() {
  const result = await claimInvite(token.value);
  clearPendingInviteToken();
  if (result.status === "joined") {
    setCurrentCommunityId(result.community.id);
  }
}

function goToCommunity() {
  void router.push({ name: "channels" });
}

/** Distinguishes the specific invite-state errors the backend returns (master prompt §14) from a generic failure. */
function inviteErrorMessage(err: unknown): string {
  const appError = err as AppError;
  if (appError?.status === 410) return "This invitation is no longer valid — it may have expired or been revoked.";
  if (appError?.status === 409) return "This invitation has reached its usage limit. Ask for a new one.";
  if (appError?.status === 404) return "This invitation link isn't valid.";
  return userMessageFor(err);
}

</script>

<template>
  <div class="invite-landing">
    <div class="card">
      <template v-if="isPreviewLoading">
        <StateView kind="loading" />
      </template>
      <template v-else-if="isPreviewError">
        <StateView kind="error" :title="inviteErrorMessage(previewError)" />
      </template>
      <template v-else-if="claimResult">
        <p class="emoji">🎉</p>
        <p class="title">
          {{
            claimResult.status === "joined"
              ? `You're now a member of ${claimResult.community.name}`
              : "You're already a member of this community"
          }}
        </p>
        <BaseButton variant="primary" @click="goToCommunity">Open Community</BaseButton>
      </template>
      <template v-else>
        <p class="title">You're invited! 🎉</p>
        <p class="community-name">Join: {{ preview?.communityName }}</p>
        <p class="description">You've been invited to join this community.</p>

        <BaseButton v-if="!isSignedIn" variant="primary" :disabled="isLoggingIn" @click="handleContinueWithOkta">
          {{ isLoggingIn ? "Signing in…" : "Continue with Okta" }}
        </BaseButton>
        <BaseButton v-else variant="primary" :disabled="isClaiming" @click="handleJoin">
          {{ isClaiming ? "Joining…" : "Join Community" }}
        </BaseButton>

        <p v-if="claimError" class="error-text">{{ inviteErrorMessage(claimError) }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.invite-landing {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background);
  padding: var(--space-4);
}
.card {
  width: 380px;
  max-width: 100%;
  padding: var(--space-6) var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-3);
}
.emoji {
  font-size: 2rem;
  margin: 0;
}
.title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--color-text);
}
.community-name {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text);
}
.description {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.error-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-danger);
}
</style>
