import type { UnsignedEvent } from "@/features/signing/types";
import { signAndPublish } from "@/services/publish";
import { AppError } from "@/services/errors";

/**
 * Leave a community — OLD BUZZ's NIP-43 relay leave, byte for byte
 * (`relayClientSession` leave; relay `ingest.rs` NIP-43 leave handler):
 *
 *   kind 28936, content "", tags [["-"]]   (NIP-70 protected: only the author may send it)
 *
 * The relay removes the SIGNER from `relay_members` (it must be sent over the
 * authenticated socket, `created_at` within ±120 s), publishes a fresh roster,
 * and answers `info: you have left this relay`. Nothing is removed locally
 * until the relay has accepted — the address book entry is dropped afterwards.
 */
export const KIND_NIP43_LEAVE_REQUEST = 28936;

export function buildLeaveCommunityEvent(): UnsignedEvent {
  return { kind: KIND_NIP43_LEAVE_REQUEST, content: "", tags: [["-"]] };
}

export type LeaveOutcome = "left" | "already-left";

export async function leaveCommunity(): Promise<LeaveOutcome> {
  try {
    await signAndPublish(buildLeaveCommunityEvent());
    return "left";
  } catch (err) {
    const reason =
      err instanceof AppError && err.cause instanceof Error ? err.cause.message : String((err as Error)?.message ?? "");
    // Same as OLD BUZZ: the relay says we're not a member → we're already out.
    if (/not a relay member/i.test(reason)) return "already-left";
    if (/relay owner cannot leave/i.test(reason)) {
      throw new AppError("relay_rejected", "You own this community, so you can't leave it.", (err as AppError).cause);
    }
    if (reason && err instanceof AppError && err.code === "relay_rejected") {
      throw new AppError("relay_rejected", `The server refused: ${reason}`, err.cause);
    }
    throw err;
  }
}
