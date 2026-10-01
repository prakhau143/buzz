import { useSessionStore } from "@/stores/session";
import { activeRelayUrl } from "@/features/communities/relayCommunities";

/**
 * Centralized Vue Query key factory — keeps cache keys consistent across features.
 *
 * Every key is prefixed with the ACTIVE IDENTITY's public key
 * (`["identity", <pubkey>, ...]`). Relay-backed server state is what the relay
 * answered *that* signer — channels it may see, rosters, messages, DMs,
 * reactions, presence — and must never be served to a different identity that
 * signs in later in the same process. Scoping the key is the structural
 * guarantee; `endIdentitySession()` additionally calls `queryClient.clear()`
 * on every sign-out/switch so the previous identity's entries are freed rather
 * than merely unreachable. No key ever carries private material — the pubkey
 * is public.
 *
 * Outside an active Pinia (some unit tests) the scope falls back to
 * `"anonymous"` instead of throwing.
 */
export function identityScope(): readonly ["identity", string] {
  let pubkey: string | null;
  try {
    pubkey = useSessionStore().pubkey;
  } catch {
    pubkey = null;
  }
  return ["identity", pubkey ?? "anonymous"] as const;
}

/**
 * The COMMUNITY this data belongs to.
 *
 * Relay-backed state is per tenant: the roster, channels, messages and DMs of
 * community A say nothing about community B. Identity alone was not enough of
 * a key — two communities opened by the same person shared one cache entry, and
 * the only thing preventing cross-community bleed was `queryClient.clear()`
 * running during teardown. That is a behavioural guarantee; this is a
 * structural one, and it holds even if a future path forgets to tear down.
 *
 * (No leak was reproducible before this change — see
 * docs/U0_UI_PROFILE_AUDIT.md §3. This closes the hole rather than fixing an
 * observed bug.)
 */
export function communityScope(): string {
  try {
    // Imported lazily-by-value: the active relay URL identifies the tenant.
    return activeRelayUrl.value || "no-community";
  } catch {
    return "no-community";
  }
}

const scoped = <T extends readonly unknown[]>(...parts: T) => [...identityScope(), ...parts] as const;

/** Identity + community scoped — for anything the relay answers per tenant. */
const communityScoped = <T extends readonly unknown[]>(...parts: T) =>
  [...identityScope(), "community", communityScope(), ...parts] as const;

export const queryKeys = {
  // Community-scoped: everything below is what ONE tenant's relay answered.
  channels: () => communityScoped("channels"),
  channel: (channelId: string) => communityScoped("channel", channelId),
  channelMessages: (channelId: string) => communityScoped("channel-messages", channelId),
  thread: (rootEventId: string) => communityScoped("thread", rootEventId),
  threadSummaries: (rootEventIds: string[]) => communityScoped("thread-summaries", ...rootEventIds),
  dmList: () => communityScoped("dm-list"),
  dm: (conversationId: string) => communityScoped("dm", conversationId),
  members: (channelId: string) => communityScoped("members", channelId),
  relayMembers: () => communityScoped("relay-members"),
  /** NIP-30 palette: the union of every member's kind 30030 set in this community. */
  customEmoji: () => communityScoped("custom-emoji"),
  moderationReports: (status?: string) => communityScoped("moderation-reports", status ?? "all"),
  moderationAudit: () => communityScoped("moderation-audit"),
  moderationRestrictions: () => communityScoped("moderation-restrictions"),
  adminProbe: () => scoped("admin-probe"),
  /** Prefix for every `adminReports(status)` key — for invalidating them all at once. */
  adminReportsAll: () => scoped("admin-reports"),
  adminReports: (status?: string) => scoped("admin-reports", status ?? "default"),
  adminFeedback: () => scoped("admin-feedback"),
  adminOperators: () => scoped("admin-operators"),
  agentProfile: (pubkey: string) => communityScoped("agent-profile", pubkey),
  /**
   * Profiles stay IDENTITY-scoped, not community-scoped, on purpose: a profile
   * belongs to a pubkey and is replicated to every community, so the same
   * person resolves to the same profile everywhere. Scoping it per community
   * would refetch the identical event on every switch for no benefit.
   */
  profile: (pubkey: string) => scoped("profile", pubkey),
  /** One entry per SET of pubkeys — callers pass a deduplicated, sorted list. */
  profileBatch: (pubkeys: readonly string[]) => scoped("profile-batch", pubkeys.join(",")),
  reactions: (channelId: string) => communityScoped("reactions", channelId),
  invites: (channelId: string) => communityScoped("invites", channelId),
  presence: () => communityScoped("presence"),
  /**
   * One entry per (query, channel scope). Community-scoped because the relay
   * answers search against the tenant's own FTS index and the caller's
   * accessible channels within it — the same words mean different results in a
   * different community.
   */
  messageSearch: (query: string, channelId?: string) =>
    communityScoped("message-search", channelId ?? "all", query),
  inbox: (category: string) => communityScoped("inbox", category),
};
