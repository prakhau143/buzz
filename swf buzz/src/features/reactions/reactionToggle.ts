import type { Reaction } from "@/types/domain";

/**
 * What reacting with `emoji` means right now: reacting again on a reaction I
 * already made retracts it (kind:5 of MY reaction event), otherwise it adds one.
 * One rule for the desktop quick-react buttons and the mobile action sheet.
 */
export function reactionToggle(
  reactions: readonly Reaction[] | undefined,
  emoji: string,
  myPubkey: string | null,
): { kind: "unreact"; reactionEventId: string } | { kind: "react" } {
  const mine = reactions?.find((r) => r.emoji === emoji && r.reactedByMe);
  const myEventId = mine && myPubkey ? mine.reactorEventIds[myPubkey] : undefined;
  return mine && myEventId ? { kind: "unreact", reactionEventId: myEventId } : { kind: "react" };
}
