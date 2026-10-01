import { computed, onMounted, toValue, watch, type MaybeRefOrGetter } from "vue";
import { usePresenceStore } from "@/stores/presence";
import { useConnectionStore } from "@/stores/connection";
import { PRESENCE_HEARTBEAT_INTERVAL_MS, type PresenceStatus } from "@/protocol/presence";
import type { RelaySubscriptionHandle } from "@/services/RelayConnectionService";
import { logError } from "@/services/errors";
import { presenceService } from "./PresenceService";
import { userStatusService } from "./UserStatusService";
import { useUserStatusStore } from "@/stores/userStatus";
import { communitySessionGeneration } from "@/features/communities/communitySession";
import type { UserStatus } from "@/protocol/userStatus";

/** OLD BUZZ refetches statuses every 120 s; expiry is re-checked every 30 s. */
const STATUS_REFRESH_MS = 120_000;
const STATUS_CLOCK_MS = 30_000;

/**
 * Keeps the presence store current for everyone the UI is showing — the same
 * lifecycle as OLD BUZZ (`usePresenceSubscription` + `usePresenceQuery`):
 *  - components declare who they show (`trackPresence`), by pubkey;
 *  - newly tracked people get a relay snapshot, batched;
 *  - one live subscription covers every tracked pubkey (re-issued as the set grows);
 *  - every tracked pubkey is re-snapshotted every 60 s and after a reconnect.
 * One engine, one subscription — no component fetches presence itself.
 */
const tracked = new Set<string>();
const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let liveSub: RelaySubscriptionHandle | null = null;
let statusSub: RelaySubscriptionHandle | null = null;
let statusRefreshTimer: ReturnType<typeof setInterval> | null = null;
let statusClock: ReturnType<typeof setInterval> | null = null;
let liveFor = "";
let stopConnectionWatch: (() => void) | null = null;
let running = false;

const DEV = import.meta.env.DEV;

async function snapshot(pubkeys: string[]): Promise<void> {
  if (pubkeys.length === 0) return;
  const store = usePresenceStore();
  try {
    const statuses = await presenceService.fetchSnapshot(pubkeys);
    for (const info of statuses.values()) {
      store.apply(info.pubkey, {
        status: info.status,
        updatedAt: info.updatedAt,
        source: "snapshot",
      });
    }
    if (DEV)
      console.debug(
        `[Presence] snapshot pubkeys=${pubkeys.length} online=${[...statuses.values()].filter((i) => i.status === "online").length}`,
      );
  } catch (err) {
    // Keep what we have; the next refresh tries again.
    logError("presenceSync.snapshot", err);
  }
}

async function fetchStatuses(pubkeys: string[]): Promise<void> {
  if (pubkeys.length === 0) return;
  try {
    const store = useUserStatusStore();
    for (const u of await userStatusService.fetch(pubkeys))
      store.apply(u.pubkey, u.status, u.updatedAt);
  } catch (err) {
    logError("presenceSync.statuses", err);
  }
}

function resubscribe(): void {
  const key = [...tracked].sort().join(",");
  if (!running || key === liveFor) return;
  liveSub?.close();
  liveFor = key;
  liveSub = tracked.size
    ? presenceService.subscribe([...tracked], (info) => {
        usePresenceStore().apply(info.pubkey, {
          status: info.status,
          updatedAt: info.updatedAt,
          source: "live",
        });
        if (DEV)
          console.debug(
            `[Presence] pubkey=${info.pubkey.slice(0, 8)} status=${info.status} source=live updatedAt=${info.updatedAt}`,
          );
      })
    : null;
}

function flush(): void {
  flushTimer = null;
  const batch = [...pending];
  pending.clear();
  resubscribe();
  void snapshot(batch);
  void fetchStatuses(batch);
}

/** Declare pubkeys the UI is showing. Cheap to call repeatedly; only new ones cost a request. */
export function trackPresence(pubkeys: Iterable<string>): void {
  for (const pubkey of pubkeys) {
    if (!/^[0-9a-f]{64}$/.test(pubkey) || tracked.has(pubkey)) continue;
    tracked.add(pubkey);
    pending.add(pubkey);
  }
  if (running && pending.size && !flushTimer) flushTimer = setTimeout(flush, 50);
}

/** Start syncing (once per signed-in session). Returns the stop function. */
export function startPresenceSync(): () => void {
  if (running) return stopPresenceSync;
  running = true;
  for (const pubkey of tracked) pending.add(pubkey);
  if (pending.size) flushTimer = setTimeout(flush, 0);
  refreshTimer = setInterval(() => void snapshot([...tracked]), PRESENCE_HEARTBEAT_INTERVAL_MS);
  const connection = useConnectionStore();
  stopConnectionWatch = watch(
    () => connection.status,
    (status, previous) => {
      if (status === "connected" && previous !== "connected") {
        void snapshot([...tracked]);
        void fetchStatuses([...tracked]);
      }
    },
  );
  // Statuses: one live subscription for the community (a status is set rarely),
  // a periodic refetch as OLD BUZZ does, and a clock so expiries take effect.
  statusSub = userStatusService.subscribe((u) =>
    useUserStatusStore().apply(u.pubkey, u.status, u.updatedAt),
  );
  statusRefreshTimer = setInterval(() => void fetchStatuses([...tracked]), STATUS_REFRESH_MS);
  statusClock = setInterval(() => useUserStatusStore().tick(), STATUS_CLOCK_MS);
  return stopPresenceSync;
}

/** Stop and forget everything — an identity switch must never inherit the last person's view. */
export function stopPresenceSync(): void {
  running = false;
  if (flushTimer) clearTimeout(flushTimer);
  if (refreshTimer) clearInterval(refreshTimer);
  flushTimer = null;
  refreshTimer = null;
  stopConnectionWatch?.();
  stopConnectionWatch = null;
  liveSub?.close();
  liveSub = null;
  liveFor = "";
  statusSub?.close();
  statusSub = null;
  if (statusRefreshTimer) clearInterval(statusRefreshTimer);
  if (statusClock) clearInterval(statusClock);
  statusRefreshTimer = null;
  statusClock = null;
  tracked.clear();
  pending.clear();
  usePresenceStore().reset();
  useUserStatusStore().reset();
}

/**
 * A person's status for rendering, from the one store. Tracks the pubkey so
 * the engine keeps it current. `null` = the relay hasn't answered yet.
 */
export function usePresenceOf(pubkey: MaybeRefOrGetter<string | null | undefined>) {
  const store = usePresenceStore();
  const track = () => {
    const value = toValue(pubkey);
    if (value) trackPresence([value]);
  };
  onMounted(track);
  // Re-declared per community session: a switch forgets every tracked pubkey,
  // and a person shown in both communities keeps the same (mounted) avatar.
  watch([() => toValue(pubkey), communitySessionGeneration], track);
  return computed<PresenceStatus | null>(() => store.statusOf(toValue(pubkey)));
}

/** A person's custom status (NIP-38) from the one store; tracks the pubkey like `usePresenceOf`. */
export function useUserStatusOf(pubkey: MaybeRefOrGetter<string | null | undefined>) {
  const store = useUserStatusStore();
  const track = () => {
    const value = toValue(pubkey);
    if (value) trackPresence([value]);
  };
  onMounted(track);
  watch([() => toValue(pubkey), communitySessionGeneration], track);
  return computed<UserStatus | null>(() => store.statusOf(toValue(pubkey)));
}
