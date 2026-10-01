import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "@/features/auth/useAuth";
import { useConnectionStore } from "@/stores/connection";
import { useIdentitySessionStore } from "@/features/auth/identitySession";
import { normaliseRelayUrl } from "@/features/communities/RelayInviteService";
import { addCommunity, communities, forgetCommunity } from "@/features/communities/relayCommunities";
import type { AuthDenial } from "@/stores/connection";

/**
 * Connecting to a community is: validate the URL → open the relay → NIP-42 →
 * the relay's membership verdict → role → open. A URL or a public key alone is
 * never proof of membership; every "yes" below is the relay's.
 */

/** `wss://` only; plain `ws://` is accepted for a loopback dev relay. */
export function validateCommunityUrl(input: string): string | null {
  const url = normaliseRelayUrl(input);
  if (!url) return null;
  return url.startsWith("wss://") || /^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(url) ? url : null;
}

export type ConnectFailureKind = "unreachable" | "not_member" | "banned" | "rejected";

export interface ConnectFailure {
  kind: ConnectFailureKind;
  title: string;
  detail: string;
}

/**
 * Turn what the connection pipeline recorded into something a person can act
 * on. Pure, so every branch is unit-tested. The distinction that matters:
 * "you are not a member" (the relay answered, and said no) is not "we could
 * not reach it" (it never answered) — they need different next steps.
 */
export function classifyConnectFailure(input: {
  authDenial: AuthDenial | null;
  failedAt: string | null;
  lastError: string | null;
}): ConnectFailure {
  if (input.authDenial === "not_member") {
    return {
      kind: "not_member",
      title: "You're not a member of this community",
      detail: "Ask a community owner or administrator for an invitation, or choose another community.",
    };
  }
  if (input.authDenial === "banned") {
    return {
      kind: "banned",
      title: "This community has blocked your identity",
      detail: "Contact the community's owner if you think this is a mistake.",
    };
  }
  if (input.failedAt === "NIP42_AUTHENTICATED" || input.authDenial === "other") {
    return {
      kind: "rejected",
      title: "The community didn't accept your sign-in",
      detail: input.lastError ?? "Its server refused the authentication. Try again, or choose another community.",
    };
  }
  return {
    kind: "unreachable",
    title: "Community unavailable",
    detail: "We couldn't reach this community's server. Check the address and your connection, then try again.",
  };
}

export type StepState = "done" | "active" | "failed" | "pending";

export interface ConnectStep {
  label: string;
  state: StepState;
}

/**
 * The three visible steps, derived from the REAL session lifecycle — never a
 * timer. Identity is verified before this screen is reachable at all.
 */
export function connectSteps(phase: string, failedAt: string | null, connecting: boolean): ConnectStep[] {
  // A membership refusal happens AT the NIP-42 handshake (the relay answers the
  // AUTH with `restricted: not a relay member`), so it fails the relay step.
  const relayFailed = failedAt === "RELAY_CONNECTING" || failedAt === "NIP42_AUTHENTICATED";
  const relayDone = !relayFailed && ["NIP42_AUTHENTICATED", "ROLE_RESOLVED", "READY"].includes(phase);
  const memberFailed = failedAt === "ROLE_RESOLVED";
  const memberDone = phase === "READY";
  const relay: StepState = relayFailed ? "failed" : relayDone ? "done" : connecting ? "active" : "pending";
  const member: StepState = memberFailed
    ? "failed"
    : memberDone
      ? "done"
      : relayDone && connecting
        ? "active"
        : "pending";
  return [
    { label: "Identity verified", state: "done" },
    { label: relay === "done" ? "Relay connected" : "Connecting to relay", state: relay },
    { label: member === "done" ? "Membership confirmed" : "Checking membership", state: member },
  ];
}

/**
 * The connect action shared by "Choose a community", Welcome and "Add
 * community". On failure the person stays where they are with a classified
 * reason; a brand-new address that failed is not kept in the recent list.
 */
export function useCommunityConnect() {
  const router = useRouter();
  const connection = useConnectionStore();
  const lifecycle = useIdentitySessionStore();
  const { switchCommunity } = useAuth();

  const connecting = ref(false);
  const target = ref<string | null>(null);
  const failure = ref<ConnectFailure | null>(null);

  const steps = computed(() => connectSteps(lifecycle.phase, lifecycle.failedAt, connecting.value));

  async function connect(relayUrl: string): Promise<boolean> {
    if (connecting.value) return false;
    connecting.value = true;
    target.value = relayUrl;
    failure.value = null;
    const known = communities.value.some((c) => c.relayUrl === relayUrl);
    const from = router.currentRoute.value.name;
    addCommunity(relayUrl);
    await switchCommunity(relayUrl); // navigates into the community on success
    const opened = router.currentRoute.value.name !== from;
    if (!opened) {
      if (!known) forgetCommunity(relayUrl);
      failure.value = classifyConnectFailure({
        authDenial: connection.authDenial,
        failedAt: lifecycle.failedAt,
        lastError: connection.lastError,
      });
    }
    connecting.value = false;
    return opened;
  }

  return { connect, connecting, target, failure, steps };
}
