<script setup lang="ts">
import { computed, ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { useJoinInvite, type JoinedCommunity } from "@/features/communities/useJoinInvite";
import { classifyInviteInput, describeRelay } from "@/features/communities/RelayInviteService";

/**
 * "Join with invite": paste a `swfbuzz://join…` link, the relay's `/invite/…` page
 * URL, or a bare invite code (used with `defaultRelay`). The claim is signed with
 * the local identity's own key — knowing a community's address or someone's public
 * key lets nobody in; only a valid invite plus a signature from your key does.
 */
const props = defineProps<{ defaultRelay?: string | null }>();
const emit = defineEmits<{ joined: [community: JoinedCommunity] }>();

const text = ref("");
const { busy, error, claim } = useJoinInvite();

const classified = computed(() => classifyInviteInput(text.value, props.defaultRelay ?? null));
const parsed = computed(() => (classified.value.kind === "invite" ? classified.value.invite : null));
/** A connection link is a valid thing pasted in the wrong box — say so specifically. */
const connection = computed(() => (classified.value.kind === "connection" ? classified.value : null));
const unrecognised = computed(
  () => text.value.trim().length > 0 && classified.value.kind === "unrecognised",
);

async function join() {
  if (!parsed.value) return;
  const joined = await claim(parsed.value);
  if (joined) {
    text.value = "";
    emit("joined", joined);
  }
}
</script>

<template>
  <form class="join" @submit.prevent="join">
    <label class="label" for="invite-input">Invite link or code</label>
    <textarea
      id="invite-input"
      v-model="text"
      class="field"
      rows="3"
      spellcheck="false"
      placeholder="swfbuzz://join?relay=…&code=…  or  v2.…"
      data-testid="invite-input"
    />
    <p v-if="parsed" class="target" data-testid="invite-target">Joining {{ describeRelay(parsed.relay) }}</p>
    <p v-else-if="connection" class="problem" data-testid="invite-is-connection">
      That's a community connection link for
      {{ connection.communityName || describeRelay(connection.relay) }}, not a membership
      invite. Open it to connect to that community — or paste a membership invite, which
      an owner or admin can create for you.
    </p>
    <p v-else-if="unrecognised" class="problem" data-testid="invite-unrecognised">
      That doesn't look like an invite. Paste the full swfbuzz:// link you were sent.
    </p>
    <BaseButton type="submit" variant="primary" :disabled="!parsed || busy" data-testid="invite-join">
      {{ busy ? "Joining…" : "Join with invite" }}
    </BaseButton>
    <p v-if="error" class="problem" data-testid="invite-error">{{ error }}</p>
  </form>
</template>

<style scoped>
.join {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.label {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.field {
  width: 100%;
  box-sizing: border-box;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-family: inherit;
  resize: vertical;
}
.target {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.problem {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
</style>
