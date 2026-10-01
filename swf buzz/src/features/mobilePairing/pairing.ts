import { isTauri, invoke } from "@tauri-apps/api/core";

/**
 * Settings → Mobile, backed by src-tauri/src/pairing.rs (NIP-AB, OLD BUZZ's
 * protocol via buzz-core). The desktop is the "source": it shows a QR with an
 * ephemeral key + session secret, both screens show the same 6-digit code, and
 * after confirmation an encrypted payload is sent. In this build that payload
 * holds NO secret — the private key stays in the OS keyring (pairing.rs).
 */
export type PairingStep =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "qr"; qrUri: string; pairingRelay: string; expiresAt: number }
  | { step: "sas"; sas: string; expiresAt: number }
  | { step: "confirming" }
  | { step: "sent"; expiresAt: number }
  | { step: "done" }
  | { step: "expired" }
  | { step: "aborted"; message: string }
  | { step: "error"; message: string };

export interface PairingStarted {
  qrUri: string;
  pairingRelay: string;
  expiresInSecs: number;
}

/** Pure reducer for the pairing screen — unit-tested without Tauri. */
export type PairingSignal =
  | { type: "start" }
  | { type: "started"; started: PairingStarted; now: number }
  | { type: "sas"; sas: string }
  | { type: "confirm" }
  | { type: "confirmed"; now: number }
  | { type: "complete" }
  | { type: "aborted"; message: string }
  | { type: "error"; message: string }
  | { type: "tick"; now: number }
  | { type: "reset" };

export function pairingReducer(state: PairingStep, signal: PairingSignal): PairingStep {
  switch (signal.type) {
    case "start":
      return { step: "starting" };
    case "started":
      return {
        step: "qr",
        qrUri: signal.started.qrUri,
        pairingRelay: signal.started.pairingRelay,
        expiresAt: signal.now + signal.started.expiresInSecs * 1000,
      };
    case "sas":
      // A code only means something while we are waiting for the phone.
      return state.step === "qr" ? { step: "sas", sas: signal.sas, expiresAt: state.expiresAt } : state;
    case "confirm":
      return state.step === "sas" ? { step: "confirming" } : state;
    case "confirmed":
      return state.step === "confirming" ? { step: "sent", expiresAt: signal.now + 30_000 } : state;
    case "complete":
      return state.step === "sent" || state.step === "confirming" ? { step: "done" } : state;
    case "aborted":
      return isActive(state) ? { step: "aborted", message: signal.message } : state;
    case "error":
      if (!isActive(state)) return state;
      return /timed out/i.test(signal.message) ? { step: "expired" } : { step: "error", message: signal.message };
    case "tick":
      return "expiresAt" in state && signal.now >= state.expiresAt ? { step: "expired" } : state;
    case "reset":
      return { step: "idle" };
  }
}

export function isActive(state: PairingStep): boolean {
  return ["starting", "qr", "sas", "confirming", "sent"].includes(state.step);
}

export function pairingAvailable(): boolean {
  return isTauri();
}

export async function startPairing(relayUrl: string): Promise<PairingStarted> {
  return invoke<PairingStarted>("start_pairing", { relayUrl });
}

export async function confirmPairing(): Promise<{ identityTransferred: boolean }> {
  return invoke("confirm_pairing_sas");
}

export async function cancelPairing(): Promise<void> {
  await invoke("cancel_pairing");
}
