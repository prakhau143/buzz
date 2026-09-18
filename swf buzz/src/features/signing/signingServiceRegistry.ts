import type { SigningService } from "./types";

/**
 * Holds whichever SigningService instance is active for the current session
 * (dev in-memory signer, or the NIP-46 bunker signer). Every feature that
 * needs to sign/encrypt reads from here rather than constructing its own
 * signer — there is exactly one signing identity per session.
 */
let active: SigningService | null = null;

export function setActiveSigningService(service: SigningService): void {
  active = service;
}

export function getActiveSigningService(): SigningService {
  if (!active) {
    throw new Error("No signing service is active yet — sign in first.");
  }
  return active;
}

export function clearActiveSigningService(): void {
  active = null;
}
