<script setup lang="ts">
import CloseButton from "@/components/CloseButton.vue";
import { computed, ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { useSessionStore } from "@/stores/session";
import { useAuth } from "@/features/auth/useAuth";
import { addCommunity, relayHost } from "@/features/communities/relayCommunities";
import { shortKey } from "@/features/identity/format";
import CreateRelayInvitePanel from "@/features/communities/ui/CreateRelayInvitePanel.vue";
import { config } from "@/app/config";
import {
  OperatorError,
  normaliseCommunityHost,
  operatorService,
  parseOwnerPubkey,
  type CreatedCommunity,
} from "@/features/communities/OperatorService";
import { userMessageFor } from "@/services/errors";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { useFocusTrap } from "@/composables/useFocusTrap";

/**
 * Operator: create a community and name its first owner.
 *
 * The Operator (deployment-level) and the Owner (community-level) are different
 * roles. Creating a community does not make the operator its owner or even a member:
 * the owner is exactly the `initial_owner_pubkey` chosen here, and the request is
 * always `create_only: true` (see OperatorService) so it can never rotate the owner
 * of an existing community.
 *
 * Only a relay *operator* may do this; the relay checks that against the signed
 * request, so this dialog is shown only after the server accepted this identity
 * as one. The owner is identified by a **public key**. A public key is an
 * identifier, not a login: entering one here creates an owner row on the relay,
 * and that person still has to prove they hold the matching private key (NIP-42)
 * before they can enter. Nothing on this screen signs anyone in as the owner.
 */
const props = defineProps<{ myPubkey?: string | null }>();
const emit = defineEmits<{ close: [] }>();
useEscapeKey(() => emit("close"));
const dialog = ref<HTMLElement | null>(null);
useFocusTrap(dialog);
const session = useSessionStore();
// The signed-in identity's public key. Passed in when this opens from the login
// screen (before any session exists), otherwise taken from the session.
const me = computed(() => props.myPubkey ?? session.pubkey ?? "");
const { switchCommunity } = useAuth();

const name = ref("");
const host = ref("");
// The address follows the name until the person edits it: "SWF Developers" on a
// relay at localhost:3000 suggests swf-developers.localhost:3000.
const hostEdited = ref(false);
const ownerInput = ref(me.value);
const showInvite = ref(false);

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
function onName() {
  if (hostEdited.value) return;
  const s = slug(name.value);
  host.value = s ? `${s}.${relayHost(config.relayUrl)}` : "";
}
const busy = ref(false);
const error = ref<string | null>(null);
const created = ref<CreatedCommunity | null>(null);
const copied = ref(false);

const hostProblem = computed(() =>
  host.value.trim() && !normaliseCommunityHost(host.value)
    ? "Use lowercase letters, numbers, dots and hyphens, like acme.example.com (optionally :port)."
    : null,
);
const ownerProblem = computed(() =>
  ownerInput.value.trim() && !parseOwnerPubkey(ownerInput.value)
    ? "Enter a 64-character hex public key or an npub1… address."
    : null,
);
const canCreate = computed(
  () => !!normaliseCommunityHost(host.value) && !!parseOwnerPubkey(ownerInput.value) && !busy.value,
);
const ownerIsMe = computed(() => !!me.value && created.value?.ownerPubkey === me.value);

async function create() {
  if (!canCreate.value) return;
  busy.value = true;
  error.value = null;
  try {
    created.value = await operatorService.createCommunity(config.relayUrl, {
      host: host.value,
      ownerPubkey: ownerInput.value,
    });
    if (created.value.ownerPubkey === me.value) {
      addCommunity(created.value.relayUrl, name.value.trim() || undefined);
    }
  } catch (err) {
    error.value = err instanceof OperatorError ? err.message : userMessageFor(err);
  } finally {
    busy.value = false;
  }
}

async function copyLink() {
  if (!created.value) return;
  try {
    await navigator.clipboard.writeText(created.value.connectLink);
    copied.value = true;
  } catch {
    error.value = "Couldn't copy. Select the link and copy it manually.";
  }
}

async function openIt() {
  if (!created.value) return;
  emit("close");
  await switchCommunity(created.value.relayUrl);
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div ref="dialog" class="card" role="dialog" aria-modal="true" aria-label="Create community">
      <div class="header">
        <h2>Create community</h2>
        <CloseButton @click="emit('close')" />
      </div>

      <template v-if="!created">
        <label class="label" for="community-name">Community name</label>
        <input
          id="community-name"
          v-model="name"
          class="field"
          placeholder="SWF Developers"
          maxlength="80"
          data-testid="community-name"
          @input="onName"
        />

        <label class="label" for="community-host">Community address</label>
        <input
          id="community-host"
          v-model="host"
          class="field"
          placeholder="acme.example.com"
          spellcheck="false"
          data-testid="community-host"
          @input="hostEdited = true"
        />
        <p class="hint">
          The address is where the community lives on the server. The name is a label you and the
          people you invite see; the server stores only the address.
        </p>
        <p v-if="hostProblem" class="problem" data-testid="host-problem">{{ hostProblem }}</p>

        <label class="label" for="community-owner">First owner (public key)</label>
        <input
          id="community-owner"
          v-model="ownerInput"
          class="field"
          placeholder="64-character hex or npub1…"
          spellcheck="false"
          data-testid="community-owner"
        />
        <p class="hint" data-testid="owner-hint">
          As an operator you are not automatically a member or owner of the new community — the
          owner is whoever you enter here (it defaults to you). They prove it's them by signing in
          with their own key; entering a public key does not sign anyone in.
        </p>
        <p v-if="ownerProblem" class="problem" data-testid="owner-problem">{{ ownerProblem }}</p>

        <BaseButton variant="primary" :disabled="!canCreate" data-testid="community-create" @click="create">
          {{ busy ? "Creating…" : "Create community" }}
        </BaseButton>
      </template>

      <template v-else>
        <p class="ok" data-testid="community-created">
          Created <strong>{{ name.trim() || created.host }}</strong>
          <span v-if="name.trim()"> ({{ created.host }})</span>.
        </p>
        <p class="owner" data-testid="community-owner-line">
          Owner:
          <strong>{{ ownerIsMe ? "your identity" : "the identity you named" }}</strong>
          <code>{{ shortKey(created.ownerPubkey) }}</code>
        </p>
        <!-- Named explicitly. This is an ADDRESS, not a membership invite, and
             calling both "link" is what led people to paste it into "Join with
             invite" — where it is correctly refused. -->
        <p v-if="!ownerIsMe" class="label" data-testid="connect-link-label">Owner connection link</p>
        <p v-if="!ownerIsMe" class="hint">
          Send this to the owner. They open it, sign in with their own identity, and the server
          recognises them as the owner. It carries no invite code and grants nothing on its own —
          to let someone <em>join</em>, use "Invite members" once you are inside the community.
        </p>
        <p v-if="!ownerIsMe" class="link" data-testid="connect-link">{{ created.connectLink }}</p>
        <BaseButton v-if="!ownerIsMe" variant="secondary" @click="copyLink">
          {{ copied ? "Copied" : "Copy connection link" }}
        </BaseButton>

        <template v-if="ownerIsMe">
          <BaseButton
            variant="secondary"
            data-testid="community-invite-members"
            @click="showInvite = !showInvite"
          >
            Invite members
          </BaseButton>
          <CreateRelayInvitePanel
            v-if="showInvite"
            :relay-url="created.relayUrl"
            :community-name="name.trim() || undefined"
            assume-manager
          />
          <BaseButton variant="primary" data-testid="community-open" @click="openIt">
            Open this community
          </BaseButton>
        </template>
      </template>

      <p v-if="error" class="problem" data-testid="community-error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
}
.card {
  width: 440px;
  max-width: calc(100vw - 32px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h2 {
  margin: 0;
  font-size: var(--font-size-lg, 1.1rem);
  color: var(--color-text);
}
.close {
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
.label,
.hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.field {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-sm);
}
.link {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  word-break: break-all;
  color: var(--color-text);
}
.ok {
  margin: 0;
  color: var(--color-text);
}
.owner {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.owner code {
  margin-left: var(--space-2);
  font-size: var(--font-size-xs);
}
.problem {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
</style>
