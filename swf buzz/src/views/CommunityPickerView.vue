<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import BaseButton from "@/components/BaseButton.vue";
import { ensureLocalSigner } from "@/features/auth/useAuth";
import { useAccessStore } from "@/stores/access";
import { discoverMemberships, type Membership } from "@/features/access/communityDiscovery";
import type { JoinedCommunity } from "@/features/communities/useJoinInvite";
import { pendingLink } from "@/features/deeplink/pendingLink";
import { shortKey } from "@/features/identity/format";
import { relayHost } from "@/features/communities/relayCommunities";
import { useCommunityConnect, validateCommunityUrl } from "@/features/communities/useCommunityConnect";
import ConnectionStepper from "@/features/communities/ui/ConnectionStepper.vue";
import IdentityModal from "@/features/identity/ui/IdentityModal.vue";
import JoinInvitePanel from "@/features/onboarding/ui/JoinInvitePanel.vue";

/**
 * "Where would you like to work?" — every fresh sign-in and every app start
 * lands here (useAuth `resolveAccess`): the community is a SESSION choice, never
 * re-entered on its own.
 *
 * Two ways in, one pipeline (`useCommunityConnect`: URL → relay → NIP-42 → the
 * relay's membership verdict → role):
 *  - Recent communities: addresses this device has used, each re-asked with a
 *    signed membership probe on arrival — a community that removed this
 *    identity does not appear. One click, but still the person's click.
 *  - A community URL typed here.
 * The relay stores no community names, so a row shows the label saved when it
 * was joined (else its address) and the role the relay published.
 */
const router = useRouter();
const access = useAccessStore();
const { connect, connecting, target, failure, steps } = useCommunityConnect();

const inTauri = isTauri();
const pubkey = ref<string | null>(null);
const loading = ref(true);
const showJoin = ref(false);
const showIdentity = ref(false);

const urlInput = ref("");
const urlField = ref<HTMLInputElement | null>(null);
const url = computed(() => validateCommunityUrl(urlInput.value));
const urlInvalid = computed(() => urlInput.value.trim().length > 0 && url.value === null);
const opening = computed(() => steps.value.every((s) => s.state === "done"));

onMounted(async () => {
  try {
    pubkey.value = await ensureLocalSigner();
  } catch {
    pubkey.value = null;
  }
  if (!pubkey.value) return void router.replace({ name: "login" });
  if (pendingLink.value) return void router.replace({ name: "join" });
  // Ask again: memberships change (an owner may have added or removed this person).
  const found = await discoverMemberships(pubkey.value).catch(() => null);
  if (found) access.$patch({ memberships: found.memberships, unreachable: found.unreachable });
  loading.value = false;
  if (access.memberships.length === 0) void router.replace({ name: "welcome" });
});

async function open(membership: Membership) {
  await connect(membership.relayUrl);
}

async function submitUrl() {
  if (url.value) await connect(url.value);
}

async function useAnotherCommunity() {
  failure.value = null;
  await nextTick();
  urlField.value?.focus();
}

async function onJoined(community: JoinedCommunity) {
  await connect(community.relay);
}

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "#";
</script>

<template>
  <div class="page">
    <main class="card" aria-labelledby="picker-title">
      <div class="brand" aria-hidden="true">SWF Buzz</div>

      <p v-if="!inTauri" class="note">Open the SWF Buzz desktop app to continue.</p>
      <p v-else-if="loading" class="note" role="status">Finding your communities…</p>

      <template v-else>
        <p class="verified" data-testid="picker-identity">
          <span class="check" aria-hidden="true">✓</span>
          Identity verified · signed in as <span class="key">{{ shortKey(pubkey) }}</span>
        </p>
        <h1 id="picker-title">Where would you like to work?</h1>
        <p class="lead">Choose a community for this session.</p>

        <ConnectionStepper v-if="connecting" :steps="steps" :host="target ? relayHost(target) : null" :opening="opening" />

        <div v-else-if="failure" class="failure" role="alert" data-testid="picker-failure">
          <p class="failure-title">{{ failure.title }}</p>
          <p class="failure-detail">{{ failure.detail }}</p>
          <div class="failure-actions">
            <BaseButton
              v-if="failure.kind === 'unreachable' || failure.kind === 'rejected'"
              variant="primary"
              data-testid="picker-retry"
              @click="target && connect(target)"
            >
              Retry
            </BaseButton>
            <BaseButton variant="secondary" data-testid="picker-use-another" @click="useAnotherCommunity">
              Use another community
            </BaseButton>
          </div>
        </div>

        <template v-if="!connecting">
          <section v-if="access.memberships.length" class="recent" aria-labelledby="recent-title">
            <h2 id="recent-title" class="section-label">Recent communities</h2>
            <ul class="list" data-testid="picker-list">
              <li v-for="m in access.memberships" :key="m.relayUrl">
                <button type="button" class="row" data-testid="picker-item" @click="open(m)">
                  <span class="avatar" aria-hidden="true">{{ initial(m.name) }}</span>
                  <span class="row-text">
                    <span class="name" data-testid="picker-name">{{ m.name }}</span>
                    <!-- The address, always — two communities can share a label, and
                         it is the address that actually identifies the tenant. -->
                    <span class="host" data-testid="picker-host">{{ m.host }}</span>
                  </span>
                  <!-- Role only when the relay actually published one: an unresolved
                       role is not "member" (it used to quietly demote owners). -->
                  <span v-if="m.role" class="role" :class="m.role" data-testid="picker-role">
                    {{ m.role[0].toUpperCase() + m.role.slice(1) }}
                  </span>
                  <span class="chevron" aria-hidden="true">›</span>
                </button>
              </li>
            </ul>
            <p v-if="access.unreachable.length" class="note" data-testid="picker-unreachable">
              {{ access.unreachable.length }} of your communities couldn't be reached right now.
            </p>
          </section>

          <form class="url-form" data-testid="picker-url-form" @submit.prevent="submitUrl">
            <label class="section-label" for="picker-url">Or enter a community URL</label>
            <div class="url-row">
              <input
                id="picker-url"
                ref="urlField"
                v-model="urlInput"
                class="url-input"
                type="text"
                inputmode="url"
                autocomplete="off"
                spellcheck="false"
                placeholder="wss://community.example.com"
                :aria-invalid="urlInvalid ? 'true' : undefined"
                aria-describedby="picker-url-help"
                data-testid="picker-url-input"
              />
              <BaseButton type="submit" variant="primary" :disabled="!url" data-testid="picker-url-submit">
                Continue
              </BaseButton>
            </div>
            <p v-if="urlInvalid" id="picker-url-help" class="problem" data-testid="picker-url-invalid">
              Enter a secure address like <code>wss://community.example.com</code> (no path or query).
            </p>
            <p v-else id="picker-url-help" class="hint">Entering an address grants nothing — the community decides who is a member.</p>
          </form>

          <div class="secondary">
            <BaseButton variant="ghost" :aria-expanded="showJoin" data-testid="picker-join-toggle" @click="showJoin = !showJoin">
              Join with invite
            </BaseButton>
            <BaseButton variant="ghost" @click="showIdentity = true">My identity</BaseButton>
            <BaseButton variant="ghost" @click="router.push({ name: 'login' })">Back to sign-in</BaseButton>
          </div>
          <JoinInvitePanel v-if="showJoin" @joined="onJoined" />
        </template>
      </template>
    </main>
    <IdentityModal v-if="showIdentity" @close="showIdentity = false" />
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  padding: var(--space-5);
}
.card {
  width: 100%;
  max-width: 480px;
  min-width: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
@media (max-width: 480px) {
  .page {
    padding: var(--space-3);
  }
  .card {
    padding: var(--space-5) var(--space-4);
  }
}
.brand {
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--color-primary);
}
.verified {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.check {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  background: var(--color-success-muted);
  color: var(--color-success);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.key {
  font-family: var(--font-mono);
  color: var(--color-text);
}
h1 {
  margin: 0;
  font-size: var(--font-size-xl);
  line-height: var(--line-height-tight);
  color: var(--color-text);
}
.lead {
  margin: calc(-1 * var(--space-3)) 0 0;
  color: var(--color-text-muted);
}
.section-label {
  display: block;
  margin: 0 0 var(--space-2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast);
}
.row:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-hover);
}
.row:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}
.avatar {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--color-primary-muted);
  color: var(--color-primary);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.host {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}
.role {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-surface-muted);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.role.owner,
.role.admin {
  background: var(--color-primary-muted);
  color: var(--color-primary);
  font-weight: 600;
}
.chevron {
  flex-shrink: 0;
  font-size: 20px;
  color: var(--color-text-subtle);
}
.url-row {
  display: flex;
  gap: var(--space-2);
}
.url-input {
  flex: 1;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
}
.url-input:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 0;
  border-color: var(--color-primary);
}
.url-input[aria-invalid="true"] {
  border-color: var(--color-danger);
}
@media (max-width: 400px) {
  .url-row {
    flex-direction: column;
  }
}
.hint,
.note {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.problem {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
.failure {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--color-danger-muted);
  border-radius: var(--radius-md);
  background: var(--color-danger-muted);
}
.failure-title {
  margin: 0;
  font-weight: 600;
  color: var(--color-danger);
}
.failure-detail {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.failure-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
.secondary {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-1);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}
</style>
