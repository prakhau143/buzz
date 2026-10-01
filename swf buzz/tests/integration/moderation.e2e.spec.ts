/**
 * Phase 4 Part E — moderation against the REAL relay.
 *
 * Closes the gap recorded in `docs/PHASE_4_RUN_STATE.md`: moderation rendering
 * was implemented, but `moderation_actions` had never held a single real row,
 * so nothing had proven the chain action → relay → audit query → UI data.
 * "The table is empty" and "the pipe is broken" look identical until a real
 * row exists.
 *
 * Deliberately REVERSIBLE: a timeout with a short expiry, immediately undone
 * by an untimeout. No ban (which persists until lifted), no kick, no report
 * resolution, and nothing touched outside the existing dev community.
 *
 * Credentials come from the out-of-repo files via env, for the test process
 * only — see `readState.e2e.spec.ts` for the invocation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { hexToBytes } from "nostr-tools/utils";
import dns from "node:dns";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { setActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { signAndPublish } from "@/services/publish";
import { moderationService } from "@/features/moderation/ModerationService";
import { setActiveRelay } from "@/features/communities/relayCommunities";
import { buildTimeoutEvent } from "@/protocol/moderation";

const COMMUNITY_WS = "ws://swf-development-1790079628466.localhost:3000";

const MEMBER_SK_HEX = process.env.SWF_E2E_MEMBER_SK?.trim() ?? "";
const OWNER_SK_HEX = process.env.SWF_E2E_OWNER_SK?.trim() ?? "";
const HAS_KEYS = /^[0-9a-f]{64}$/i.test(MEMBER_SK_HEX) && /^[0-9a-f]{64}$/i.test(OWNER_SK_HEX);

const _origDnsLookup = dns.lookup;
type LookupCallback = (err: Error | null, address: unknown, family?: number) => void;
type LookupRest = [LookupCallback] | [{ all?: boolean } | number | undefined, LookupCallback];
(dns as { lookup: unknown }).lookup = (hostname: string, ...rest: LookupRest) => {
  if (typeof hostname === "string" && hostname.endsWith(".localhost")) {
    const cb = rest[rest.length - 1] as LookupCallback;
    const opts = rest.length > 1 ? rest[0] : undefined;
    if (opts && typeof opts === "object" && opts.all)
      return cb(null, [{ address: "127.0.0.1", family: 4 }]);
    return cb(null, "127.0.0.1", 4);
  }
  return (_origDnsLookup as unknown as (...args: unknown[]) => void).call(dns, hostname, ...rest);
};

async function waitFor<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await fn();
    if (ok(last) || Date.now() > deadline) return last;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * The moderation REST calls are tenant-scoped by `activeRelayUrl` (the selected
 * community), NOT by whichever socket happens to be open — `moderationGet`
 * builds its URL, and therefore its NIP-98 signature and the relay's Host-based
 * tenant binding, from that. Connecting the socket alone leaves it at
 * `config.relayUrl`, so the request lands on the bootstrap tenant where these
 * identities hold no role and the relay correctly answers 403. Worth stating
 * plainly: a 403 here can mean "wrong community", not "wrong role".
 */
beforeEach(() => {
  setActivePinia(createPinia());
  setActiveRelay(COMMUNITY_WS);
});

describe.skipIf(!HAS_KEYS)("Live relay — moderation produces a real audit row", () => {
  it("owner times out a member: the action reaches moderation_actions and the audit query returns it", async () => {
    const owner = new DevSigningService(hexToBytes(OWNER_SK_HEX));
    // A THROWAWAY target, not MEMBER_A.
    //
    // Restrictions are global relay state keyed by pubkey. Timing out a real
    // test identity made every other live spec that signs as it fail with
    // `restricted: you are timed out until …` when the files ran in parallel —
    // caught in a full e2e run, not in isolation. Targeting a fresh keypair
    // that no other spec uses makes the isolation structural instead of
    // depending on file order or on the untimeout landing in time.
    const target = new DevSigningService("ephemeral");
    const memberPubkey = await target.getPublicKey();

    setActiveSigningService(owner);
    await relayConnectionService.connect(COMMUNITY_WS);

    const before = await moderationService.listAuditActions(50);

    // Short, self-expiring, and undone immediately below.
    const expiresAt = Math.floor(Date.now() / 1000) + 60;
    await moderationService.timeoutMember({
      pubkey: memberPubkey,
      targetRole: "member",
      actingRole: "owner",
      expiresAt,
      reason: "phase-4 part E verification (auto-expires, untimeout follows)",
    });

    // The real row, through the app's own audit query — not a DB peek.
    const after = await waitFor(
      () => moderationService.listAuditActions(50),
      (rows) => rows.length > before.length,
    );
    expect(after.length).toBeGreaterThan(before.length);

    const row = after[0];
    expect(row.action.toLowerCase()).toContain("timeout");
    expect(row.targetPubkey).toBe(memberPubkey);
    expect(row.actorPubkey).toBe(await owner.getPublicKey());

    // And it shows up as an active restriction while it lasts.
    const restrictions = await waitFor(
      () => moderationService.listRestrictions(),
      (rows) => rows.some((r) => r.pubkey === memberPubkey),
    );
    expect(restrictions.some((r) => r.pubkey === memberPubkey)).toBe(true);

    // Undo — leave the relay exactly as found.
    await moderationService.untimeoutMember({ pubkey: memberPubkey, actingRole: "owner" });
    const lifted = await waitFor(
      () => moderationService.listRestrictions(),
      (rows) => !rows.some((r) => r.pubkey === memberPubkey),
    );
    expect(lifted.some((r) => r.pubkey === memberPubkey)).toBe(false);
  });

  it("an ordinary member cannot moderate — enforced by the RELAY, not just the client guard", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK_HEX));
    const memberPubkey = await member.getPublicKey();
    setActiveSigningService(member);
    await relayConnectionService.connect(COMMUNITY_WS);

    // The client guard is asserted in unit tests. What matters here is that the
    // relay refuses even when the guard is bypassed entirely, so a patched or
    // hostile client gains nothing. Build and publish the event directly.
    const event = buildTimeoutEvent({
      pubkey: memberPubkey,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      reason: "should be refused",
    });

    await expect(signAndPublish(event)).rejects.toBeTruthy();
  });

  it("an ordinary member cannot read the moderation audit", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK_HEX));
    setActiveSigningService(member);
    await relayConnectionService.connect(COMMUNITY_WS);

    await expect(moderationService.listAuditActions(10)).rejects.toMatchObject({
      code: "permission_denied",
    });
  });
});
