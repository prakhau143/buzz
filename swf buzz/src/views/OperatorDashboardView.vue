<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import BaseButton from "@/components/BaseButton.vue";
import { ensureLocalSigner, useAuth } from "@/features/auth/useAuth";
import { useAccessStore } from "@/stores/access";
import { communities, relayHost } from "@/features/communities/relayCommunities";
import { discoverMemberships } from "@/features/access/communityDiscovery";
import { operatorService, type OwnedCommunity } from "@/features/communities/OperatorService";
import type { JoinedCommunity } from "@/features/communities/useJoinInvite";
import { pendingLink } from "@/features/deeplink/pendingLink";
import { shortKey } from "@/features/identity/format";
import { userMessageFor } from "@/services/errors";
import { config } from "@/app/config";
import CreateCommunityDialog from "@/features/communities/ui/CreateCommunityDialog.vue";
import IdentityModal from "@/features/identity/ui/IdentityModal.vue";
import JoinInvitePanel from "@/features/onboarding/ui/JoinInvitePanel.vue";

/**
 * The Operator's home: where a relay *operator* lands after signing in.
 *
 * OPERATOR ≠ OWNER. "Operator" is deployment-level authority (the relay's
 * `RELAY_OPERATOR_PUBKEYS`, proven by a signed NIP-98 request to `/operator/*`).
 * "Owner", "Admin" and "Member" are roles *inside one community*
 * (`relay_members.role`, proven by NIP-42). An operator is not automatically a
 * member or owner of any community: it can create one and name its first owner, and
 * only appears in a community's roster if it was named owner or added like anyone else.
 *
 * Who is an operator is the relay's decision. This view asks it again on arrival
 * (a NIP-98-signed probe) and sends anyone it refuses back to sign-in, so being
 * on this route never depends on a client-side flag. Creating a community is a
 * signed operator request that the relay checks itself.
 *
 * The list is the communities this identity owns (`GET /operator/communities`) plus
 * the ones it belongs to (each relay's answer to a signed membership probe). The
 * relay has no "list every community" call, so that is the honest extent of it.
 */
interface Row {
  relayUrl: string;
  name: string;
  host: string;
  /** `null` when the relay published no role for this identity — not "member". */
  role: string | null;
}

const router = useRouter();
const access = useAccessStore();
const { switchCommunity, isLoading, error } = useAuth();

const inTauri = isTauri();
const pubkey = ref<string | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
const owned = ref<OwnedCommunity[]>([]);
const showCreate = ref(false);
const showJoin = ref(false);
const showIdentity = ref(false);

function labelFor(relayUrl: string): string {
  return communities.value.find((c) => c.relayUrl === relayUrl)?.name ?? relayHost(relayUrl);
}

const rows = computed<Row[]>(() => {
  const byUrl = new Map<string, Row>();
  for (const m of access.memberships) {
    byUrl.set(m.relayUrl, { relayUrl: m.relayUrl, name: labelFor(m.relayUrl), host: m.host, role: m.role });
  }
  for (const o of owned.value) {
    byUrl.set(o.relayUrl, { relayUrl: o.relayUrl, name: labelFor(o.relayUrl), host: o.host, role: "owner" });
  }
  return [...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name));
});

async function load() {
  loadError.value = null;
  const me = pubkey.value;
  if (!me) return;
  const [ownedResult, found] = await Promise.allSettled([
    operatorService.listOwnedCommunities(config.relayUrl, me),
    discoverMemberships(me),
  ]);
  if (ownedResult.status === "fulfilled") owned.value = ownedResult.value;
  else loadError.value = userMessageFor(ownedResult.reason);
  if (found.status === "fulfilled") {
    access.$patch({ memberships: found.value.memberships, unreachable: found.value.unreachable });
  }
}

onMounted(async () => {
  try {
    pubkey.value = await ensureLocalSigner();
  } catch {
    pubkey.value = null;
  }
  if (!pubkey.value) return void router.replace({ name: "login" });
  if (pendingLink.value) return void router.replace({ name: "join" });
  // The relay decides who is an operator — ask it again rather than trust a cache.
  const operator = await operatorService.isOperator(config.relayUrl).catch(() => false);
  if (!operator) return void router.replace({ name: "login" });
  access.$patch({ isOperator: true });
  await load();
  loading.value = false;
});

async function onCreateClosed() {
  showCreate.value = false;
  await load();
}

async function open(row: Row) {
  await switchCommunity(row.relayUrl);
}

async function onJoined(community: JoinedCommunity) {
  await switchCommunity(community.relay);
}
</script>

<template>
  <div class="page">
    <div class="card">
      <h1>Operator Dashboard</h1>

      <p v-if="!inTauri" class="note">Open the SWF Buzz desktop app to continue.</p>
      <p v-else-if="loading" class="note">Loading…</p>

      <template v-else>
        <p class="identity" data-testid="operator-identity">Signed in as {{ shortKey(pubkey) }}</p>
        <p class="note" data-testid="operator-scope">
          Deployment-level access. It does not make you a member or owner of any community.
        </p>

        <h2>Communities</h2>
        <p v-if="rows.length === 0" class="lead" data-testid="operator-empty">You don't have any communities yet.</p>
        <ul v-else class="list" data-testid="operator-communities">
          <li v-for="row in rows" :key="row.relayUrl" class="row">
            <div class="info">
              <strong data-testid="operator-community-name">{{ row.name }}</strong>
              <span v-if="row.role" class="meta">{{ row.role }}</span>
            </div>
            <BaseButton variant="secondary" :disabled="isLoading" data-testid="operator-open" @click="open(row)">
              Open
            </BaseButton>
          </li>
        </ul>
        <p v-if="loadError" class="problem" data-testid="operator-load-error">{{ loadError }}</p>

        <BaseButton variant="primary" data-testid="operator-create-community" @click="showCreate = true">
          {{ rows.length === 0 ? "Create your first community" : "Create Community" }}
        </BaseButton>
        <BaseButton variant="secondary" data-testid="operator-join-toggle" @click="showJoin = !showJoin">
          Join with invite
        </BaseButton>
        <JoinInvitePanel v-if="showJoin" @joined="onJoined" />

        <p v-if="error" class="problem" data-testid="operator-error">{{ error }}</p>

        <div class="links">
          <BaseButton variant="ghost" data-testid="operator-my-identity" @click="showIdentity = true">My identity</BaseButton>
          <BaseButton variant="ghost" @click="router.push({ name: 'login' })">Back to sign-in</BaseButton>
        </div>
      </template>
    </div>

    <CreateCommunityDialog v-if="showCreate" :my-pubkey="pubkey" @close="onCreateClosed" />
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
  max-width: 460px;
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
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* Community hosts are long unbroken tokens (`swf-x-1790….localhost:3000`);
   without this the tail is clipped under the Open button at ≤375px —
   observed in the real Tauri window, not just a browser. */
.info strong {
  overflow-wrap: anywhere;
}
.meta {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.problem {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-danger);
}
.links {
  display: flex;
  justify-content: space-between;
}
</style>
