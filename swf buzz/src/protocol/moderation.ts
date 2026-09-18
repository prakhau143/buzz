/**
 * Community moderation — NIP-56 report (kind:1984) + community moderation
 * commands (kinds 9040-9044). See docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §2b.
 *
 * Tag shapes verified against ../buzz's own desktop client, not guessed:
 * ../buzz/desktop/src/shared/api/moderation.ts. Report-type vocabulary
 * verified against ../buzz/crates/buzz-relay/src/handlers/report.rs:29-37
 * (`REPORT_TYPES`).
 *
 * "delete" is a valid resolution action server-side, but its enforcement
 * event (kind:9005, NIP-29 delete-event) is not implemented in this protocol
 * layer yet — its exact tag shape was not verified this pass. It is
 * deliberately omitted from `RESOLUTION_ACTIONS` below rather than guessed;
 * see docs/KNOWN_LIMITATIONS.md.
 */
import type { UnsignedEvent } from "@/features/signing/types";
import {
  KIND_MODERATION_BAN,
  KIND_MODERATION_RESOLVE_REPORT,
  KIND_MODERATION_TIMEOUT,
  KIND_MODERATION_UNBAN,
  KIND_MODERATION_UNTIMEOUT,
  KIND_REPORT,
} from "./kinds";

export const REPORT_TYPES = [
  "illegal",
  "nudity",
  "malware",
  "spam",
  "impersonation",
  "profanity",
  "other",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export type ResolutionStatus = "resolved" | "dismissed";

/** "delete" omitted — see module doc comment. */
export const RESOLUTION_ACTIONS = ["dismiss", "escalate", "ban", "timeout", "kick"] as const;
export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

function normalize(hex: string): string {
  return hex.trim().toLowerCase();
}

/** kind:1984 — the report type rides the `e` tag's third element. */
export function buildReportEvent(params: {
  authorPubkey: string;
  eventId: string;
  reportType: ReportType;
  note?: string;
}): UnsignedEvent {
  return {
    kind: KIND_REPORT,
    content: params.note?.trim() ? params.note.trim() : "",
    tags: [
      ["p", normalize(params.authorPubkey)],
      ["e", normalize(params.eventId), params.reportType],
    ],
  };
}

/** kind:9040. `expiresAt` unix-secs ⇒ temporary; omit ⇒ permanent. */
export function buildBanEvent(params: {
  pubkey: string;
  expiresAt?: number;
  reason?: string;
}): UnsignedEvent {
  const tags: string[][] = [["p", normalize(params.pubkey)]];
  if (params.expiresAt != null) tags.push(["expiration", String(params.expiresAt)]);
  if (params.reason?.trim()) tags.push(["reason", params.reason.trim()]);
  return { kind: KIND_MODERATION_BAN, content: "", tags };
}

/** kind:9041. */
export function buildUnbanEvent(pubkey: string): UnsignedEvent {
  return { kind: KIND_MODERATION_UNBAN, content: "", tags: [["p", normalize(pubkey)]] };
}

/** kind:9042. `expiresAt` (unix-secs) is required by the relay. */
export function buildTimeoutEvent(params: {
  pubkey: string;
  expiresAt: number;
  reason?: string;
}): UnsignedEvent {
  const tags: string[][] = [
    ["p", normalize(params.pubkey)],
    ["expiration", String(params.expiresAt)],
  ];
  if (params.reason?.trim()) tags.push(["reason", params.reason.trim()]);
  return { kind: KIND_MODERATION_TIMEOUT, content: "", tags };
}

/** kind:9043. */
export function buildUntimeoutEvent(pubkey: string): UnsignedEvent {
  return { kind: KIND_MODERATION_UNTIMEOUT, content: "", tags: [["p", normalize(pubkey)]] };
}

/**
 * kind:9044. `dismiss` pairs with `status: "dismissed"`; every other action
 * pairs with `status: "resolved"` — the relay enforces this pairing.
 */
export function buildResolveReportEvent(params: {
  reportEventId: string;
  status: ResolutionStatus;
  action: ResolutionAction;
  reason?: string;
}): UnsignedEvent {
  const tags: string[][] = [
    ["report", normalize(params.reportEventId)],
    ["status", params.status],
    ["action", params.action],
  ];
  if (params.reason?.trim()) tags.push(["reason", params.reason.trim()]);
  return { kind: KIND_MODERATION_RESOLVE_REPORT, content: "", tags };
}

/** The correct `status` for a given resolution action — the relay rejects any other pairing. */
export function statusForAction(action: ResolutionAction): ResolutionStatus {
  return action === "dismiss" ? "dismissed" : "resolved";
}
