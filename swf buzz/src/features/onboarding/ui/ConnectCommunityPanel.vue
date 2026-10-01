<script setup lang="ts">
import { computed, ref } from "vue";
import BaseButton from "@/components/BaseButton.vue";
import { relayHost } from "@/features/communities/relayCommunities";
import { useCommunityConnect, validateCommunityUrl } from "@/features/communities/useCommunityConnect";
import ConnectionStepper from "@/features/communities/ui/ConnectionStepper.vue";

/**
 * "Connect to a community by URL" — for an identity that is ALREADY a member of
 * a community whose address this device does not know yet (e.g. a key imported
 * from OLD Buzz). Same pipeline as the `swfbuzz://connect` link and the
 * "Choose a community" screen (`useCommunityConnect`): URL → relay → NIP-42 →
 * the relay's own membership verdict → role. Typing an address grants nothing:
 * a non-member is refused by the relay and a new address is dropped again.
 */
const emit = defineEmits<{ connected: [relay: string] }>();
const { connect, connecting, target, failure, steps } = useCommunityConnect();

const input = ref("");
const relay = computed(() => validateCommunityUrl(input.value));
const invalid = computed(() => input.value.trim().length > 0 && relay.value === null);

async function submit() {
  const url = relay.value;
  if (!url || connecting.value) return;
  if (await connect(url)) emit("connected", url);
}
</script>

<template>
  <form class="connect" data-testid="connect-community" @submit.prevent="submit">
    <label class="label" for="connect-relay">Community URL</label>
    <input
      id="connect-relay"
      v-model="input"
      class="input"
      type="text"
      inputmode="url"
      autocomplete="off"
      spellcheck="false"
      placeholder="wss://community.example.com"
      :aria-invalid="invalid ? 'true' : undefined"
      data-testid="connect-relay-input"
    />
    <p v-if="invalid" class="problem" data-testid="connect-relay-invalid">
      Enter a secure address like <code>wss://community.example.com</code> (no path or query).
    </p>
    <BaseButton type="submit" variant="primary" :disabled="!relay || connecting" data-testid="connect-submit">
      {{ connecting ? "Connecting…" : "Connect" }}
    </BaseButton>
    <ConnectionStepper v-if="connecting" :steps="steps" :host="target ? relayHost(target) : null" />
    <div v-else-if="failure" class="failure" role="alert">
      <p class="problem" data-testid="connect-problem">{{ failure.title }}</p>
      <p class="detail">{{ failure.detail }}</p>
    </div>
  </form>
</template>

<style scoped>
.connect {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.label {
  font-size: var(--font-size-sm);
  color: var(--color-text);
}
.input {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  min-width: 0;
}
.input:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: 0;
}
.failure {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.problem {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-danger);
}
.detail {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
</style>
