/**
 * Every feature that needs to sign+publish an event goes through this one
 * function — never `signEvent` and `relayConnectionService.publish` called
 * separately by feature code. See docs/ARCHITECTURE.md §6.
 */
import { getActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { relayConnectionService } from "./RelayConnectionService";
import { AppError } from "./errors";
import type { SignedEvent, UnsignedEvent } from "@/features/signing/types";

export async function signAndPublish(event: UnsignedEvent): Promise<SignedEvent> {
  const { signed } = await signAndPublishWithResponse(event);
  return signed;
}

/**
 * Same as `signAndPublish`, but also returns the relay's OK "reason" string —
 * needed for the few event kinds that encode a response in it, e.g. kind:41010
 * (DM open) returns `{"channel_id": "..."}"`. See docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §8a.
 */
export async function signAndPublishWithResponse(
  event: UnsignedEvent,
): Promise<{ signed: SignedEvent; okReason: string }> {
  let signer;
  try {
    signer = getActiveSigningService();
  } catch (err) {
    throw new AppError("auth_required", "Please sign in to continue.", err);
  }

  let signed: SignedEvent;
  try {
    signed = await signer.signEvent(event);
  } catch (err) {
    throw new AppError("signing_failed", "Couldn't sign that action. Please try again.", err);
  }

  const okReason = await relayConnectionService.publish(signed);
  return { signed, okReason };
}
