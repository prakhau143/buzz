<script setup lang="ts">
import { computed, ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { useSessionStore } from "@/stores/session";
import { canManageCommunityMembers } from "@/features/community-members/permissions";
import { activeRelayUrl, communities, relayHost } from "@/features/communities/relayCommunities";
import {
  DEFAULT_INVITE_TTL_SECS,
  InviteError,
  MAX_INVITE_USES,
  relayInviteService,
  type CreatedRelayInvite,
} from "@/features/communities/RelayInviteService";
import { userMessageFor } from "@/services/errors";

/**
 * Create an invite for the community you're signed in to (owner/admin only).
 *
 * The request is NIP-98-signed with your identity; the relay itself checks your
 * `relay_members` role and answers 403 otherwise, so hiding this panel from
 * members below is a convenience, not the security check. The invite is an opaque
 * one-time-secret link — share it out of band (SWF Buzz sends nothing).
 */
// `relayUrl`: the community to invite to (default: the one you're signed in to).
// `assumeManager`: set right after creating a community you own, before any
// session in it exists — the button is then shown, and the relay still decides.
const props = defineProps<{ relayUrl?: string; communityName?: string; assumeManager?: boolean }>();
const session = useSessionStore();
const target = computed(() => props.relayUrl ?? activeRelayUrl.value);
const canCreate = computed(
  () => props.assumeManager === true || canManageCommunityMembers(session.communityRole),
);
// Unverified extras written into the link so the invitee sees a name and who
// invited them. The relay verifies neither — only the code.
const hints = computed(() => {
  const saved = communities.value.find((c) => c.relayUrl === target.value)?.name;
  const name = props.communityName ?? (saved && saved !== relayHost(target.value) ? saved : undefined);
  return { communityName: name, invitedBy: session.pubkey ?? undefined };
});

const EXPIRIES = [
  { label: "1 hour", secs: 3600 },
  { label: "24 hours", secs: 86_400 },
  { label: "3 days", secs: DEFAULT_INVITE_TTL_SECS },
  { label: "7 days", secs: 7 * 86_400 },
  { label: "30 days", secs: 30 * 86_400 },
];
const ttlSecs = ref(DEFAULT_INVITE_TTL_SECS);
const maxUsesText = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const invite = ref<CreatedRelayInvite | null>(null);
const copied = ref(false);

const maxUses = computed(() => {
  const text = maxUsesText.value.trim();
  return text === "" ? undefined : Number(text);
});
const maxUsesProblem = computed(() => {
  const value = maxUses.value;
  if (value === undefined) return null;
  return Number.isInteger(value) && value >= 1 && value <= MAX_INVITE_USES
    ? null
    : `Enter a whole number from 1 to ${MAX_INVITE_USES}, or leave empty for unlimited.`;
});

const expiresText = computed(() =>
  invite.value ? new Date(invite.value.expiresAt * 1000).toLocaleString() : "",
);

async function create() {
  if (maxUsesProblem.value || busy.value) return;
  busy.value = true;
  error.value = null;
  copied.value = false;
  try {
    invite.value = await relayInviteService.createInvite(target.value, {
      ttlSecs: ttlSecs.value,
      maxUses: maxUses.value,
      hints: hints.value,
    });
  } catch (err) {
    invite.value = null;
    error.value = err instanceof InviteError ? err.message : userMessageFor(err);
  } finally {
    busy.value = false;
  }
}

async function copy() {
  if (!invite.value) return;
  try {
    await navigator.clipboard.writeText(invite.value.link);
    copied.value = true;
  } catch {
    error.value = "Couldn't copy. Select the link and copy it manually.";
  }
}
</script>

<template>
  <div class="invites">
    <p v-if="!canCreate" class="note" data-testid="invites-not-allowed">
      Only a community owner or admin can create invites.
    </p>

    <template v-else>
      <label class="label" for="invite-ttl">Expires after</label>
      <select id="invite-ttl" v-model.number="ttlSecs" class="field" data-testid="invite-ttl">
        <option v-for="option in EXPIRIES" :key="option.secs" :value="option.secs">{{ option.label }}</option>
      </select>

      <label class="label" for="invite-max">Max uses (optional)</label>
      <input
        id="invite-max"
        v-model="maxUsesText"
        class="field"
        inputmode="numeric"
        placeholder="Unlimited"
        data-testid="invite-max-uses"
      />
      <p v-if="maxUsesProblem" class="problem" data-testid="invite-max-problem">{{ maxUsesProblem }}</p>

      <BaseButton variant="primary" :disabled="busy || !!maxUsesProblem" data-testid="invite-create" @click="create">
        {{ busy ? "Creating…" : "Create invite" }}
      </BaseButton>

      <div v-if="invite" class="result" data-testid="invite-result">
        <p class="label">Share this link (it works once per person until it expires or runs out):</p>
        <p class="link" data-testid="invite-link">{{ invite.link }}</p>
        <p class="note">
          Expires {{ expiresText }} ·
          {{ invite.maxUses === null ? "unlimited uses" : `${invite.usesRemaining ?? invite.maxUses} of ${invite.maxUses} uses left` }}
        </p>
        <BaseButton variant="secondary" @click="copy">{{ copied ? "Copied" : "Copy link" }}</BaseButton>
      </div>

      <!--
        The relay exposes exactly two invite operations — mint (`POST /api/invites`)
        and claim (`POST /api/invites/claim`, router.rs:108,124). There is no
        endpoint to list outstanding invites or to revoke one, and only the
        SHA-256 of each code is stored, so the codes cannot be re-displayed even
        in principle. Rather than showing an empty "Active invites" table or a
        Revoke button that could do nothing, the limitation is stated plainly.
      -->
      <p class="note limits" data-testid="invite-limits">
        Invites can't be listed or revoked after they're created — the relay stores only a hash of
        each code, never the code itself. Set a short expiry or a use limit if you need one to stop
        working.
      </p>
    </template>

    <p v-if="error" class="problem" data-testid="invite-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.limits {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.invites {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.label,
.note {
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
.result {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.link {
  margin: 0;
  font-family: monospace;
  font-size: var(--font-size-xs);
  word-break: break-all;
  color: var(--color-text);
}
.problem {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
</style>
