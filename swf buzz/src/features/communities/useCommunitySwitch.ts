import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "@/features/auth/useAuth";
import { useConnectionStore } from "@/stores/connection";
import { activeRelayUrl, communities, relayHost } from "./relayCommunities";
import { useAccessibleCommunities } from "./useAccessibleCommunities";

/**
 * THE community switch — shared by the sidebar's community switcher (context /
 * management) and the community rail (fast switching), so both show the same
 * "Switching to …" state, the same error, and can never race each other.
 *
 * Switching is NOT sign-out: the identity stays, the previous community's
 * session ends (`beginIdentitySession` tears it down), and the new community is
 * authenticated from scratch (NIP-42 + the relay's membership verdict). The
 * target is re-verified BEFORE the current community is left, and if it still
 * fails after that, the previous community is restored.
 */

// Module-level: one switch at a time, visible to every caller.
const switchingTo = ref<string | null>(null);
/**
 * The community being left, while a switch is in progress. Headers keep naming
 * it until the new community is ready, so the name and the content change
 * together instead of the name running ahead.
 */
const switchingFrom = ref<string | null>(null);
const switchError = ref<string | null>(null);
/** The community a failed switch was headed for (for "Retry"); cleared on success or dismissal. */
const failedTarget = ref<string | null>(null);
/**
 * Read-only view of the shared switch state, for surfaces that only DISPLAY it
 * (e.g. the mobile switch overlay) and must not construct the switch itself.
 */
export const communitySwitchError = computed(() => switchError.value);
export const communitySwitchingTo = computed(() => switchingTo.value);
export const communitySwitchingFrom = computed(() => switchingFrom.value);
export const communitySwitchFailedTarget = computed(() => failedTarget.value);
export function clearCommunitySwitchError(): void {
  switchError.value = null;
  failedTarget.value = null;
}

/** When memberships were last re-asked by a passive surface (the rail). */
let lastPassiveRefresh = 0;
const PASSIVE_REFRESH_MS = 5 * 60_000;

export function useCommunitySwitch() {
  const router = useRouter();
  const connection = useConnectionStore();
  const { switchCommunity, isLoading, error } = useAuth();
  const { accessible, verifying, verified, refresh, verify } = useAccessibleCommunities();

  const current = computed(() => {
    const url = switchingFrom.value ?? activeRelayUrl.value;
    const saved = communities.value.find((c) => c.relayUrl === url);
    return { url, name: saved?.name ?? relayHost(url ?? ""), host: relayHost(url ?? "") };
  });
  const others = computed(() => accessible.value.filter((m) => m.relayUrl !== current.value.url));
  const connected = computed(() => connection.status === "connected");

  /** Resolves true when the switch landed on `relayUrl`. */
  async function switchTo(relayUrl: string): Promise<boolean> {
    if (switchingTo.value || relayUrl === activeRelayUrl.value) return relayUrl === activeRelayUrl.value;
    const from = current.value.url;
    switchingTo.value = relayUrl;
    switchingFrom.value = from;
    switchError.value = null;
    failedTarget.value = null;
    try {
      const check = await verify(relayUrl);
      if (!check.ok) {
        switchError.value = check.reason;
        failedTarget.value = relayUrl;
        void refresh(); // it shouldn't have been listed — update the list
        return false;
      }
      await switchCommunity(relayUrl);
      if (connection.status !== "connected" || activeRelayUrl.value !== relayUrl) {
        const reason = error.value ?? connection.lastError ?? "Couldn't open that community.";
        if (from) await switchCommunity(from);
        switchError.value = `${reason} You're still in ${relayHost(from ?? "")}.`;
        failedTarget.value = relayUrl;
        return false;
      }
      return true;
    } finally {
      switchingTo.value = null;
      switchingFrom.value = null;
    }
  }

  /** The existing Add Community flow ("Choose a community" → URL / invite). */
  function openAddCommunity() {
    void router.push({ name: "communities" });
  }

  /**
   * For always-visible surfaces: re-ask the relays at most every few minutes,
   * not on every mount (each view mounts again). Sign-in already asked once.
   */
  function refreshIfStale() {
    if (Date.now() - lastPassiveRefresh < PASSIVE_REFRESH_MS) return;
    lastPassiveRefresh = Date.now();
    void refresh();
  }

  function clearError() {
    clearCommunitySwitchError();
  }

  /** Try the last failed switch again — the same verified path, nothing bypassed. */
  async function retryFailed(): Promise<boolean> {
    const target = failedTarget.value;
    return target ? switchTo(target) : false;
  }

  return {
    current,
    others,
    accessible,
    connected,
    verifying,
    verified,
    refresh,
    refreshIfStale,
    switchTo,
    retryFailed,
    openAddCommunity,
    clearError,
    isLoading,
    switchingTo: computed(() => switchingTo.value),
    switchError: computed(() => switchError.value),
  };
}
