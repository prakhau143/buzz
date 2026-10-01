<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import BaseButton from "@/components/BaseButton.vue";
import { ensureLocalSigner, useAuth } from "@/features/auth/useAuth";
import type { JoinedCommunity } from "@/features/communities/useJoinInvite";
import { pendingLink } from "@/features/deeplink/pendingLink";
import { shortKey } from "@/features/identity/format";
import IdentityModal from "@/features/identity/ui/IdentityModal.vue";
import ConnectCommunityPanel from "@/features/onboarding/ui/ConnectCommunityPanel.vue";
import JoinInvitePanel from "@/features/onboarding/ui/JoinInvitePanel.vue";

/**
 * Where a signed-in identity lands when it is a member of no community and is
 * not a relay operator (operators land on the Operator dashboard instead).
 *
 * The one thing to do here is join: with an invite link, or — if this identity is
 * already a member somewhere this device doesn't know yet (an owner added it, or
 * it was imported from OLD Buzz) — by connecting to that community's address,
 * typed here or opened as a `swfbuzz://connect` link. The relay decides either way. Creating a community is not offered: that is an operator action,
 * decided by the relay, and lives on the Operator dashboard.
 */
const router = useRouter();
const { switchCommunity } = useAuth();

const inTauri = isTauri();
const pubkey = ref<string | null>(null);
const loading = ref(true);
const showJoin = ref(false);
const showIdentity = ref(false);

onMounted(async () => {
  try {
    pubkey.value = await ensureLocalSigner();
  } catch {
    pubkey.value = null;
  }
  loading.value = false;
  // No identity on the device: nothing to show here — go and set one up.
  if (!pubkey.value) return void router.replace({ name: "login" });
  if (pendingLink.value) return void router.replace({ name: "join" });
});

async function onJoined(community: JoinedCommunity) {
  await switchCommunity(community.relay);
}
</script>

<template>
  <div class="welcome-page">
    <div class="welcome-card">
      <h1>Welcome to SWF Buzz</h1>

      <p v-if="!inTauri" class="note">Open the SWF Buzz desktop app to continue.</p>
      <p v-else-if="loading" class="note">Loading…</p>

      <template v-else-if="pubkey">
        <p class="identity" data-testid="welcome-identity">Signed in as {{ shortKey(pubkey) }}</p>
        <p class="lead" data-testid="welcome-lead">You don't have any communities yet.</p>

        <!-- The community URL is always on screen: choosing where to work is the
             step after identity, never something to go looking for. -->
        <ConnectCommunityPanel />

        <p class="note">
          No address? Ask a community owner for an invite link — or send them your public key from
          <em>My identity</em> so they can add you.
        </p>
        <BaseButton variant="secondary" :aria-expanded="showJoin" data-testid="welcome-join-toggle" @click="showJoin = !showJoin">
          Join with invite
        </BaseButton>
        <JoinInvitePanel v-if="showJoin" @joined="onJoined" />

        <div class="links">
          <BaseButton variant="ghost" data-testid="welcome-my-identity" @click="showIdentity = true">
            My identity
          </BaseButton>
          <BaseButton variant="ghost" data-testid="welcome-back" @click="router.push({ name: 'login' })">
            Back to sign-in
          </BaseButton>
        </div>
      </template>
    </div>

    <IdentityModal v-if="showIdentity" @close="showIdentity = false" />
  </div>
</template>

<style scoped>
.welcome-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: var(--space-5);
}
.welcome-card {
  width: 100%;
  max-width: 420px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
h1 {
  margin: 0;
  font-size: var(--font-size-xl);
  color: var(--color-text);
}
.identity {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.lead {
  margin: 0;
  color: var(--color-text);
}
.note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.links {
  display: flex;
  justify-content: space-between;
}
</style>
