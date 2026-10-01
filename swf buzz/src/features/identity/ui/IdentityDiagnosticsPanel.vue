<script setup lang="ts">
/**
 * DEVELOPMENT-ONLY identity diagnostics (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md
 * §17). Mounted by App.vue only when `import.meta.env.DEV`; never part of a
 * production build. Shows, side by side, every place the app holds "who am I"
 * and what the relay last answered, so an identity/role problem is diagnosed
 * from evidence instead of guessed at:
 *
 *   Rust identity (get_identity)  ·  session.pubkey  ·  signer pubkey
 *   ·  NIP-42 authenticated pubkey  ·  NIP-98 probe (status, signer)
 *   ·  platformRole  ·  communityRole  ·  route  ·  stale-identity check
 *
 * PUBLIC INFORMATION ONLY. Every value is a public key, a fingerprint, a role,
 * an HTTP status or a route name. There is no code path here that can reach a
 * private key: Rust never returns one, the signer only reports its pubkey.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import { useSessionStore } from "@/stores/session";
import { useConnectionStore } from "@/stores/connection";
import { useAccessStore } from "@/stores/access";
import { useDiagnosticsStore } from "@/stores/diagnostics";
import { getActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { getLocalIdentity } from "@/features/signing/signingService.tauri";
import { queryClient } from "@/app/providers/queryClient";

/**
 * `inline` renders it as an ordinary item (the sidebar footer) instead of a
 * floating badge. Floating is kept only for screens that have no sidebar —
 * sign-in — where nothing else occupies the corner. As a floating badge it
 * covered the sidebar's own actions and the thread composer.
 */
const props = withDefaults(defineProps<{ inline?: boolean }>(), { inline: false });

const session = useSessionStore();
const connection = useConnectionStore();
const access = useAccessStore();
const diag = useDiagnosticsStore();
const route = useRoute();

const open = ref(false);
const rustPubkey = ref<string | null>(null);
const rustStorage = ref<string>("—");
const signerPubkey = ref<string | null>(null);
const signerError = ref<string | null>(null);
const cacheIdentities = ref<string[]>([]);

const fp = (k: string | null | undefined) => (k ? `${k.slice(0, 8)}…${k.slice(-8)}` : "—");

async function refresh() {
  if (isTauri()) {
    try {
      const info = await getLocalIdentity();
      rustPubkey.value = info.pubkey;
      rustStorage.value = info.storage;
    } catch (err) {
      rustPubkey.value = null;
      rustStorage.value = err instanceof Error ? err.message : "error";
    }
  }
  try {
    signerPubkey.value = await getActiveSigningService().getPublicKey();
    signerError.value = null;
  } catch (err) {
    signerPubkey.value = null;
    signerError.value = err instanceof Error ? err.message : "no signer";
  }
  // Which identities the query cache holds entries for (keys are ["identity", <pubkey>, ...]).
  const ids = new Set<string>();
  for (const q of queryClient.getQueryCache().getAll()) {
    const key = q.queryKey;
    if (Array.isArray(key) && key[0] === "identity" && typeof key[1] === "string") ids.add(key[1]);
  }
  cacheIdentities.value = [...ids];
}

/**
 * "Stale previous identity detected" — YES when any live holder of identity
 * disagrees with the session's pubkey, or the cache holds another identity's
 * entries. With no session at all, YES if a signer, a socket auth or a cache
 * entry still names anyone.
 */
const stale = computed(() => {
  const me = session.pubkey;
  const holders = [signerPubkey.value, connection.authenticatedPubkey, ...cacheIdentities.value].filter(
    (k): k is string => !!k && k !== "anonymous",
  );
  if (!me) return holders.length > 0;
  return holders.some((k) => k !== me);
});

const probe = computed(() => diag.lastOperatorProbe);
const decision = computed(() => diag.lastAccessDecision);
const pubkeyMatch = computed(() => {
  if (!rustPubkey.value || !session.pubkey) return "—";
  return rustPubkey.value === session.pubkey ? "YES" : "NO";
});

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 2000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
watch(() => [session.pubkey, connection.authenticatedPubkey, route.fullPath], () => void refresh());
</script>

<template>
  <div class="diag" :class="{ open, inline: props.inline }" data-testid="identity-diagnostics">
    <button type="button" class="toggle" :aria-expanded="open" aria-controls="identity-diag-body" @click="open = !open">
      <span class="dot" :class="stale ? 'bad' : 'ok'" aria-hidden="true"></span>
      Identity diagnostics
    </button>
    <dl v-if="open" id="identity-diag-body" class="body">
      <dt>Rust identity</dt>
      <dd data-testid="diag-rust-pubkey">{{ fp(rustPubkey) }} <small>({{ rustStorage }})</small></dd>
      <dt>session.pubkey</dt>
      <dd data-testid="diag-session-pubkey">{{ fp(session.pubkey) }}</dd>
      <dt>Rust = session</dt>
      <dd data-testid="diag-pubkey-match">{{ pubkeyMatch }}</dd>
      <dt>Signer pubkey</dt>
      <dd data-testid="diag-signer-pubkey">{{ signerPubkey ? fp(signerPubkey) : signerError ?? "—" }}</dd>
      <dt>NIP-42 AUTH pubkey</dt>
      <dd data-testid="diag-auth-pubkey">{{ fp(connection.authenticatedPubkey) }} <small>({{ connection.status }})</small></dd>
      <dt>NIP-98 operator probe</dt>
      <dd data-testid="diag-probe">
        <template v-if="probe">
          {{ probe.status ?? probe.error }} — signed by {{ fp(probe.signerPubkey) }}
          <small>for {{ fp(probe.forPubkey) }} @ {{ probe.origin }}</small>
        </template>
        <template v-else>not run</template>
      </dd>
      <dt>platformRole</dt>
      <dd data-testid="diag-platform-role">{{ session.platformRole ?? "null" }}</dd>
      <dt>communityRole</dt>
      <dd data-testid="diag-community-role">{{ session.communityRole ?? "null" }}</dd>
      <dt>Access decision</dt>
      <dd data-testid="diag-decision">
        <template v-if="decision">{{ decision.kind }}<template v-if="decision.destination"> → {{ decision.destination }}</template> ({{ decision.membershipCount }} memberships)</template>
        <template v-else>—</template>
      </dd>
      <dt>Identity mismatch</dt>
      <dd data-testid="diag-mismatch">
        <template v-if="diag.lastIdentityMismatch">
          YES — expected {{ fp(diag.lastIdentityMismatch.expected) }}, signer {{ fp(diag.lastIdentityMismatch.signer) }}
        </template>
        <template v-else>no</template>
      </dd>
      <dt>Route</dt>
      <dd data-testid="diag-route">{{ route.fullPath }}</dd>
      <dt>Cache identities</dt>
      <dd data-testid="diag-cache">{{ cacheIdentities.length ? cacheIdentities.map(fp).join(", ") : "none" }}</dd>
      <dt>Stale previous identity</dt>
      <dd data-testid="diag-stale" :class="stale ? 'bad-text' : ''">{{ stale ? "YES" : "NO" }}</dd>
      <dt>access.isOperator</dt>
      <dd>{{ access.isOperator }}</dd>
    </dl>
  </div>
</template>

<style scoped>
/**
 * Anchored to the LEFT edge, above the sidebar footer — the right-hand side is
 * where the thread panel's "Reply in thread…" composer and its Send button
 * live, and a floating badge there covered them. Nothing on the left is an
 * input, at any width.
 */
.diag {
  position: fixed;
  left: var(--space-3);
  bottom: var(--space-3);
  z-index: var(--z-toast, 60);
  font-size: var(--font-size-xs);
  font-family: monospace;
  max-width: min(420px, calc(100vw - 2 * var(--space-3)));
}

/* Narrow widths: the sidebar is a drawer and the composer spans the screen, so
   sit above it rather than beside it. */
@media (max-width: 768px) {
  .diag:not(.inline) {
    bottom: calc(var(--space-3) + 64px);
  }
}

/*
  In the sidebar footer: an ordinary item, so it can never cover anything.

  The expanded body used to be `position: absolute` even here, and no ancestor
  was positioned — so it resolved against a containing block near the viewport
  and landed on top of the footer's own buttons, with a toast-level z-index
  guaranteeing it won. In inline mode it is now a normal block that pushes the
  footer taller and scrolls with it: the overlap is impossible rather than
  merely nudged out of the way.
*/
.diag.inline {
  position: static;
  max-width: 100%;
}
.diag.inline .body {
  position: static;
  margin-top: var(--space-2);
  max-height: 40vh;
  overflow-y: auto;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-muted);
  cursor: pointer;
}
.toggle:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot.ok {
  background: var(--color-success);
}
.dot.bad {
  background: var(--color-danger);
}
.body {
  margin: var(--space-1) 0 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-md);
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px var(--space-3);
  max-height: 60vh;
  overflow: auto;
}
.body dt {
  color: var(--color-text-muted);
}
.body dd {
  margin: 0;
  word-break: break-all;
}
.body small {
  color: var(--color-text-subtle);
}
.bad-text {
  color: var(--color-danger);
  font-weight: 600;
}
</style>
