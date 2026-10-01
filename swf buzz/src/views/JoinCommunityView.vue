<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import BaseButton from "@/components/BaseButton.vue";
import IdentitySetup from "@/features/onboarding/ui/IdentitySetup.vue";
import ImportAnotherIdentity from "@/features/onboarding/ui/ImportAnotherIdentity.vue";
import JoinInvitePanel from "@/features/onboarding/ui/JoinInvitePanel.vue";
import { useAuth } from "@/features/auth/useAuth";
import { useConnectionStore } from "@/stores/connection";
import { getLocalIdentity, type LocalIdentityInfo } from "@/features/signing/signingService.tauri";
import { useJoinInvite, type JoinedCommunity } from "@/features/communities/useJoinInvite";
import { activeRelayUrl, addCommunity, relayHost as describeRelay } from "@/features/communities/relayCommunities";
import { clearPendingLink, pendingLink } from "@/features/deeplink/pendingLink";
import { shortKey, shortNpub } from "@/features/identity/format";

/**
 * Where a `swfbuzz://` link lands, and the manual "join with invite" screen.
 *
 * The link is only a *request*: it names a community server and an invite code.
 * Nothing is signed or sent until the user presses the button here — and then the
 * claim is signed by their own private key (in Rust). The page shows which server
 * the link points at so a link to somewhere unexpected is visible before use.
 *
 *   join    → invite preview ("You've been invited to join …"), then claim the
 *             invite (relay creates the membership, role `member`) and sign in
 *   connect → add a community you already belong to (e.g. an owner) and sign in;
 *             the relay decides your role from your key — the link grants nothing
 *   invalid → say why, no action
 * With no identity yet, "Create your identity / Import existing identity" comes
 * first; with one, it is named and can be swapped for another.
 *
 * What the preview can and cannot promise: the relay verifies only the invite
 * *code*. The community name and inviter shown come from the link itself, so they
 * are labelled "from the link" — the server address is the part that is real.
 */
const router = useRouter();
const connection = useConnectionStore();
const { switchCommunity, replaceIdentityLocal } = useAuth();
const { busy, error, claim, reset } = useJoinInvite();

const inTauri = isTauri();
const identity = ref<LocalIdentityInfo | null>(null);
const loading = ref(inTauri);
const signingIn = ref(false);
const signInError = ref<string | null>(null);
const outcome = ref<JoinedCommunity | null>(null);
const replaceError = ref<string | null>(null);

const link = computed(() => pendingLink.value);
const hasIdentity = computed(() => !!identity.value?.pubkey);
const invite = computed(() => (link.value?.kind === "join" ? link.value : null));
const inviteName = computed(() =>
  invite.value ? (invite.value.communityName ?? describeRelay(invite.value.relay)) : "",
);
const inviter = computed(() => shortNpub(invite.value?.invitedBy ?? null));

async function refresh() {
  if (!inTauri) return;
  try {
    identity.value = await getLocalIdentity();
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);

// A different link replaces the one on screen: drop the last attempt's messages so an
// old "expired" or "already a member" can't be read as the answer for the new link.
watch(link, (next) => {
  if (!next) return; // cleared after accepting: keep the outcome on screen
  reset();
  outcome.value = null;
  signInError.value = null;
});

async function enter(relay: string) {
  signingIn.value = true;
  signInError.value = null;
  clearPendingLink();
  await switchCommunity(relay); // NIP-42 + relay_members; navigates on success
  // If it did not navigate away, the relay refused us — show why here.
  signInError.value =
    router.currentRoute.value.name !== "join"
      ? null
      : connection.authDenial === "not_member"
        ? "You're not a member of this community yet. Paste an invite below to join."
        : connection.authDenial === "banned"
          ? "This community has blocked your identity."
          : "Couldn't sign in to that community.";
  signingIn.value = false;
}

async function acceptJoin() {
  const current = link.value;
  if (current?.kind !== "join") return;
  const joined = await claim({
    relay: current.relay,
    code: current.code,
    policyReceipt: current.policyReceipt ?? undefined,
  });
  if (joined) {
    outcome.value = joined;
    await enter(joined.relay);
  }
}

async function acceptConnect() {
  const current = link.value;
  if (current?.kind !== "connect") return;
  addCommunity(current.relay, current.communityName ?? undefined);
  await enter(current.relay);
}

async function onManualJoined(joined: JoinedCommunity) {
  outcome.value = joined;
  await enter(joined.relay);
}

// "Import another identity": swap it (Rust archives the old key first), then stay
// on the invite so it is claimed by the identity the person actually chose.
async function onReplace(input: string, password: string | undefined, allowRawHex: boolean) {
  replaceError.value = null;
  if (await replaceIdentityLocal(input, password, allowRawHex)) {
    await refresh();
  } else {
    replaceError.value = "Couldn't import that identity. Check the key or backup password.";
  }
}

function dismiss() {
  clearPendingLink();
  void router.push({ name: "login" });
}
</script>

<template>
  <div class="join-page">
    <div class="join-card">
      <h1>SWF Buzz</h1>

      <p v-if="!inTauri" class="note">Open the SWF Buzz desktop app to join a community.</p>
      <p v-else-if="loading" class="note">Loading…</p>

      <template v-else-if="link?.kind === 'invalid'">
        <h2>Join a community</h2>
        <p class="problem" data-testid="link-invalid">{{ link.reason }}</p>
        <BaseButton variant="secondary" @click="dismiss">Back</BaseButton>
      </template>

      <template v-else>
        <!-- The invite preview: shown first, whether or not an identity exists yet. -->
        <div v-if="invite" class="preview" data-testid="invite-preview">
          <p class="note">You've been invited to join:</p>
          <p class="community-name" data-testid="join-name">{{ inviteName }}</p>
          <p class="hint">
            Server: <strong data-testid="join-target">{{ describeRelay(invite.relay) }}</strong>
            <span v-if="invite.communityName"> · the name comes from the link and isn't verified</span>
          </p>
          <p v-if="inviter" class="hint" data-testid="join-inviter">
            Invited by <code>{{ inviter }}</code> (from the link, not verified)
          </p>
        </div>
        <p v-else-if="link?.kind === 'connect'" class="note">
          Open the community
          <strong data-testid="connect-name">{{ link.communityName ?? describeRelay(link.relay) }}</strong>
          <span v-if="link.communityName"> ({{ describeRelay(link.relay) }})</span>
          with your identity.
        </p>
        <h2 v-else>Join a community</h2>

        <!-- No identity yet: create or import one first. -->
        <template v-if="!hasIdentity">
          <p class="note">
            {{ link ? "To accept this you need an identity — it's the key that proves who you are." : "Joining a community needs an identity." }}
          </p>
          <IdentitySetup :recovery="identity?.recovery ?? 'none'" @ready="refresh" />
        </template>

        <template v-else-if="invite">
          <p class="note" data-testid="join-as">
            Identity found: <code>{{ shortKey(identity?.pubkey) }}</code>
          </p>
          <p class="hint">Only accept invites from people you trust. The invite is claimed with your own key.</p>
          <BaseButton
            variant="primary"
            :disabled="busy || signingIn"
            data-testid="accept-join"
            @click="acceptJoin"
          >
            {{ busy ? "Joining…" : signingIn ? "Signing in…" : "Join Community" }}
          </BaseButton>
          <ImportAnotherIdentity
            v-if="identity?.pubkey"
            :current-pubkey="identity.pubkey"
            :busy="busy || signingIn"
            :error="replaceError"
            @replace="onReplace"
          />
          <BaseButton variant="ghost" :disabled="busy || signingIn" @click="dismiss">Not now</BaseButton>
        </template>

        <template v-else-if="link?.kind === 'connect'">
          <p class="hint">
            If you are its owner, an admin or a member, the server recognises your key. Otherwise it
            will ask for an invite.
          </p>
          <BaseButton variant="primary" :disabled="signingIn" data-testid="accept-connect" @click="acceptConnect">
            {{ signingIn ? "Signing in…" : "Add and sign in" }}
          </BaseButton>
          <BaseButton variant="ghost" :disabled="signingIn" @click="dismiss">Not now</BaseButton>
        </template>

        <template v-else>
          <JoinInvitePanel :default-relay="activeRelayUrl" @joined="onManualJoined" />
          <BaseButton variant="ghost" @click="dismiss">Back</BaseButton>
        </template>
      </template>

      <p v-if="outcome?.status === 'already_member'" class="note" data-testid="already-member">
        You're already a member of this community.
      </p>
      <p v-if="error" class="problem" data-testid="join-error">{{ error }}</p>
      <p v-if="signInError" class="problem" data-testid="signin-error">{{ signInError }}</p>
    </div>
  </div>
</template>

<style scoped>
.join-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: var(--space-5);
}
.join-card {
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
h2 {
  margin: 0;
  font-size: var(--font-size-md, 1rem);
  color: var(--color-text);
}
.preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.community-name {
  margin: 0;
  font-size: var(--font-size-lg, 1.15rem);
  font-weight: 600;
  color: var(--color-text);
  word-break: break-word;
}
code {
  font-size: var(--font-size-xs);
}
.note,
.hint {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.problem {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
</style>
