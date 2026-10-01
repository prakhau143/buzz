/**
 * Channel access — ONE answer to "may this identity use this channel, and as
 * what?", shared by every screen that shows a channel (desktop ChannelsView,
 * mobile MobileChannelView; pins and edit/delete permissions read its role).
 * docs/PHASE_G_PINNED_MESSAGES_EVERYONE.md §12 (community switching & access).
 *
 * It is a state machine, not a boolean, because the old boolean
 * (`isMember = myRole !== null`) could not tell "the roster says no" from "the
 * roster hasn't answered", "the relay refused to answer yet" or "the request
 * failed" — and showed all four as "You're not a member of this channel yet"
 * + "Join channel", including for channels whose messages were on screen.
 *
 *   unknown     no identity or no channel selected
 *   checking    no authoritative answer yet (first fetch in flight, or retrying)
 *   member      the roster lists me (role known) — or, in a PRIVATE channel the
 *               relay just served me history for (see below)
 *   not_member  the relay answered with a complete roster (EOSE) without me
 *   error       the roster could not be fetched and nothing was known before
 *
 * The rules that matter:
 *  - ONLY `not_member` may produce "You're not a member" / "Join channel".
 *  - A known answer is never downgraded by a re-check: while a refetch runs or
 *    after it fails, the last authoritative answer stands (`rechecking: true`).
 *  - Private-channel history is relay-authorized evidence: the relay serves a
 *    private channel's messages only to its members, so a roster that says
 *    "no" while the relay is serving me that channel's history is the stale
 *    answer, and access resolves to `member`. (Open channels are readable by
 *    anyone, so there history proves nothing.)
 *
 * This is presentation state. It never grants anything: the relay enforces
 * membership on every read and write regardless of what this says.
 */
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import type { Member } from "@/types/domain";
import type { MemberRole } from "@/protocol/membership";
import { useChannelMembers } from "./useChannelMembers";

export type ChannelAccessStatus = "unknown" | "checking" | "member" | "not_member" | "error";

export interface ChannelAccess {
  status: ChannelAccessStatus;
  /** My channel role when `status === "member"`, else null. */
  role: MemberRole | null;
  /** A known answer is being re-verified (refetch in flight or just failed). */
  rechecking: boolean;
  /** Where a `member` answer came from. */
  source: "roster" | "history" | null;
}

export interface RosterState {
  /** The last COMPLETE roster, if any (vue-query keeps it across refetches and refetch errors). */
  data: readonly Member[] | undefined;
  isFetching: boolean;
  isError: boolean;
}

export interface ResolveChannelAccessInput {
  me: string | null;
  channelId: string | null;
  roster: RosterState;
  visibility: "open" | "private" | null;
  /** The relay has served this channel's history to me (≥ 1 relay-confirmed message). */
  historyReadable?: boolean;
}

const UNKNOWN: ChannelAccess = { status: "unknown", role: null, rechecking: false, source: null };

export function resolveChannelAccess(input: ResolveChannelAccessInput): ChannelAccess {
  const { me, channelId, roster } = input;
  if (!me || !channelId) return UNKNOWN;
  const rechecking = roster.isFetching || roster.isError;

  if (roster.data !== undefined) {
    const mine = roster.data.find((m) => m.pubkey.toLowerCase() === me.toLowerCase());
    if (mine) return { status: "member", role: mine.role ?? "member", rechecking, source: "roster" };
    if (input.visibility === "private" && input.historyReadable) {
      // Relay-authorized read beats a roster snapshot that has not caught up.
      return { status: "member", role: "member", rechecking: true, source: "history" };
    }
    return { status: "not_member", role: null, rechecking, source: null };
  }

  // No authoritative roster yet. Private history still proves access.
  if (input.visibility === "private" && input.historyReadable) {
    return { status: "member", role: "member", rechecking: true, source: "history" };
  }
  if (roster.isError && !roster.isFetching) return { status: "error", role: null, rechecking: false, source: null };
  return { status: "checking", role: null, rechecking: false, source: null };
}

/** Only an authoritative negative may offer "Join channel". */
export const showsJoin = (access: ChannelAccess): boolean => access.status === "not_member";

/**
 * The composable every channel screen uses. `channelId` keys the roster query,
 * which is identity- AND community-scoped (`queryKeys.members`), so community
 * A's answer can never be read in community B; the transport additionally
 * drops anything that arrives for an ended community session.
 */
export function useChannelAccess(params: {
  channelId: MaybeRefOrGetter<string | null>;
  me: MaybeRefOrGetter<string | null>;
  visibility: MaybeRefOrGetter<"open" | "private" | null>;
  historyReadable?: MaybeRefOrGetter<boolean>;
}) {
  const roster = useChannelMembers(params.channelId);
  const access: ComputedRef<ChannelAccess> = computed(() =>
    resolveChannelAccess({
      me: toValue(params.me),
      channelId: toValue(params.channelId),
      roster: {
        data: roster.data.value,
        isFetching: roster.isFetching.value,
        isError: roster.isError.value,
      },
      visibility: toValue(params.visibility),
      historyReadable: params.historyReadable ? toValue(params.historyReadable) : false,
    }),
  );
  return {
    access,
    /** The roster query itself (members list, refetch). */
    roster,
    myRole: computed(() => (access.value.status === "member" ? access.value.role : null)),
    isMember: computed(() => access.value.status === "member"),
    showJoin: computed(() => showsJoin(access.value)),
    /** The roster has answered at least once (pins judge roles only then). */
    rosterReady: computed(() => roster.data.value !== undefined),
  };
}

/**
 * "Has the relay served me this channel's history?" — relay-confirmed rows
 * only (an optimistic/failed send of my own is not evidence).
 */
export function historyIsReadable(messages: readonly { status: string }[] | undefined, isError: boolean): boolean {
  return !isError && !!messages?.some((m) => m.status === "sent");
}
