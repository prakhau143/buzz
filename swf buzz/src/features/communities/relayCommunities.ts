import { computed, ref } from "vue";
import { config } from "@/app/config";

/**
 * The communities this device knows how to reach.
 *
 * This is **only a list of relay addresses** kept on this device — the same
 * thing the reference desktop keeps (`communityStorage.ts`). It is not a
 * community database: membership, roles, owners and invites all live on the
 * Buzz relay (`relay_members`), and nothing here grants access to anything. A
 * relay address alone lets nobody in — the relay still demands a NIP-42 proof of
 * the private key and a `relay_members` row.
 *
 * A "community" on the relay is a tenant selected by the request `Host`, so each
 * one is reached at its own relay URL (`ws://acme.example.com`).
 */

export interface RelayCommunity {
  relayUrl: string;
  name: string;
  addedAt: number;
}

const LIST_KEY = "swf_relay_communities.v1";
const ACTIVE_KEY = "swf_active_relay.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / blocked storage: the list simply won't persist.
  }
}

/**
 * The SELECTED community is session state, not device state: it lives in
 * sessionStorage, so a webview reload keeps it but an app restart does not —
 * the next session starts at "Choose a community" (see useAuth `resolveAccess`).
 * The address book above stays in localStorage: it is a list of non-secret
 * relay addresses offered as one-click "recent communities", never auto-opened.
 */
function readSession(key: string): string | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked storage: the selection simply lasts until the page unloads.
  }
}

/** Earlier builds persisted the selection in localStorage; never honour that copy. */
function dropLegacyActiveSelection(): void {
  try {
    localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // ignore
  }
}

export const communities = ref<RelayCommunity[]>(read<RelayCommunity[]>(LIST_KEY, []));
dropLegacyActiveSelection();
const activeUrl = ref<string | null>(readSession(ACTIVE_KEY));

/** The relay the app connects to: the chosen community, else the build default. */
export const activeRelayUrl = computed(() => activeUrl.value ?? config.relayUrl);

/** `ws://host:3000` → `host:3000` (what the relay treats as the community). */
export function relayHost(relayWsUrl: string): string {
  try {
    return new URL(relayWsUrl).host;
  } catch {
    return relayWsUrl;
  }
}

/** `ws://` → `http://`, `wss://` → `https://` (no trailing slash). */
export function relayHttpBase(relayWsUrl: string): string {
  return relayWsUrl.replace(/^ws/i, "http").replace(/\/+$/, "");
}

export function addCommunity(relayUrl: string, name?: string): RelayCommunity {
  const existing = communities.value.find((c) => c.relayUrl === relayUrl);
  if (existing) return existing;
  const community = { relayUrl, name: name?.trim() || relayHost(relayUrl), addedAt: Date.now() };
  communities.value = [...communities.value, community];
  write(LIST_KEY, communities.value);
  return community;
}

/**
 * Rename this device's label for a community. Local only, like OLD BUZZ's
 * "Edit Community → Name": the relay stores no community name.
 */
export function renameCommunity(relayUrl: string, name: string): void {
  const label = name.trim() || relayHost(relayUrl);
  if (!communities.value.some((c) => c.relayUrl === relayUrl)) addCommunity(relayUrl, label);
  communities.value = communities.value.map((c) => (c.relayUrl === relayUrl ? { ...c, name: label } : c));
  write(LIST_KEY, communities.value);
}

/**
 * Drop an address the relay says it has no community for (a 404 to a signed
 * membership probe). The address book is only a list of places to ask; an entry
 * the server does not recognise is stale and would otherwise be re-probed on
 * every sign-in forever. Never called for the build's home relay.
 */
export function forgetCommunity(relayUrl: string): void {
  const remaining = communities.value.filter((c) => c.relayUrl !== relayUrl);
  if (remaining.length === communities.value.length) return;
  communities.value = remaining;
  write(LIST_KEY, communities.value);
  if (activeUrl.value === relayUrl) clearActiveRelay();
}

export function setActiveRelay(relayUrl: string): void {
  activeUrl.value = relayUrl;
  writeSession(ACTIVE_KEY, relayUrl);
}

/**
 * Forget which community was last opened. Called on every session teardown so
 * the next identity never inherits the previous person's selection (Part D of
 * the identity hardening pass): the community to open is decided again, for
 * the new pubkey, by `resolveAccess`. The address book itself stays — it is a
 * list of relay addresses, not a grant of anything.
 */
export function clearActiveRelay(): void {
  activeUrl.value = null;
  writeSession(ACTIVE_KEY, null);
  dropLegacyActiveSelection();
}

export function clearCommunitiesForTests(): void {
  communities.value = [];
  activeUrl.value = null;
}
