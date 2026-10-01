/**
 * Phase 3.6 / P0 Phase L — reactions against the REAL relay.
 *
 * Regression for the "kind:7 + #h returns nothing" finding recorded in
 * docs/PHASE_3_IMPLEMENTATION_AUDIT.md §18.7. This file pins, empirically,
 * what the relay actually answers for each filter shape the app could use, so
 * the app's query (`buildReactionFilter`) is chosen from evidence.
 *
 * Needs the running relay and the throwaway operator (see liveRelay.e2e.spec.ts
 * header for how `SWF_E2E_OPERATOR_SK` is provided — never committed).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { hexToBytes } from "nostr-tools/utils";
import dns from "node:dns";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { setActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { operatorService } from "@/features/communities/OperatorService";
import { channelService } from "@/features/channels/ChannelService";
import { messageService } from "@/features/messages/MessageService";
import { reactionService } from "@/features/reactions/ReactionService";
import { buildReactionFilter } from "@/protocol/reactions";
import { KIND_REACTION } from "@/protocol/kinds";

const BASE_ORIGIN_WS = "ws://localhost:3000";
const THROWAWAY_OPERATOR_SK_HEX = process.env.SWF_E2E_OPERATOR_SK?.trim() ?? "";
const HAS_THROWAWAY_OPERATOR = /^[0-9a-f]{64}$/i.test(THROWAWAY_OPERATOR_SK_HEX);

// Same test-process-only `*.localhost` loopback patch as liveRelay.e2e.spec.ts.
const _origDnsLookup = dns.lookup;
type LookupCallback = (err: Error | null, address: unknown, family?: number) => void;
type LookupRest = [LookupCallback] | [{ all?: boolean } | number | undefined, LookupCallback];
(dns as { lookup: unknown }).lookup = (hostname: string, ...rest: LookupRest) => {
  if (typeof hostname === "string" && hostname.endsWith(".localhost")) {
    const cb = rest[rest.length - 1] as LookupCallback;
    const opts = rest.length > 1 ? rest[0] : undefined;
    if (opts && typeof opts === "object" && opts.all) return cb(null, [{ address: "127.0.0.1", family: 4 }]);
    return cb(null, "127.0.0.1", 4);
  }
  return (_origDnsLookup as unknown as (...args: unknown[]) => void).call(dns, hostname, ...rest);
};

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await fn();
    if (ok(last) || Date.now() > deadline) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
}

beforeEach(() => setActivePinia(createPinia()));

describe.skipIf(!HAS_THROWAWAY_OPERATOR)("Live relay — reactions: which REQ shapes return a kind:7 (evidence for the app's filter)", () => {
  it("kind:7 published with only an `e` tag is retrievable by #h (relay-derived channel) — and the app's own fetch sees it", async () => {
    const HOST = `swf-react-${Date.now()}.localhost:3000`;
    const owner = new DevSigningService(hexToBytes(THROWAWAY_OPERATOR_SK_HEX));
    const ownerPubkey = await owner.getPublicKey();
    setActiveSigningService(owner);
    const created = await operatorService.createCommunity(BASE_ORIGIN_WS, { host: HOST, ownerPubkey });
    await relayConnectionService.connect(created.relayUrl);

    await channelService.createChannel({ name: "reactions" });
    const channels = await waitFor(() => channelService.discoverChannels(), (l) => l.some((c) => c.name === "reactions"));
    const channelId = channels.find((c) => c.name === "reactions")!.id;
    const msg = await messageService.send({ channelId, content: "react to me" });

    await reactionService.react(msg.id, "👍");

    // Evidence table — each shape, what the relay answers.
    const byE = await waitFor(() => fetchEventsOnce([{ kinds: [KIND_REACTION], "#e": [msg.id] }]), (l) => l.length > 0);
    const byH = await waitFor(() => fetchEventsOnce([buildReactionFilter(channelId)]), (l) => l.length > 0);
    const bare = await fetchEventsOnce([{ kinds: [KIND_REACTION], limit: 50 }]);
    const byHAndE = await fetchEventsOnce([{ kinds: [KIND_REACTION], "#h": [channelId], "#e": [msg.id] }]);
    console.log(
      `[reactions-evidence] #e=${byE.length} #h=${byH.length} bare=${bare.length} #h+#e=${byHAndE.length}`,
    );

    expect(byE.length).toBe(1);
    expect(byH.length, "the app's own channel-scoped filter must see the reaction").toBe(1);
    expect(byH[0].id).toBe(byE[0].id);
    expect(byH[0].tags.some((t) => t[0] === "h"), "the stored kind:7 carries no literal h tag; #h is served from the relay's derived channel_id").toBe(false);

    // And the app's grouped view — what MessageItem renders.
    const grouped = await reactionService.fetchChannelReactions(channelId);
    const forMsg = grouped.get(msg.id);
    expect(forMsg?.[0]?.emoji).toBe("👍");
    expect(forMsg?.[0]?.count).toBe(1);
    expect(forMsg?.[0]?.reactedByMe).toBe(false); // session store has no pubkey in this bare harness → "me" unknown

    relayConnectionService.disconnect();
  }, 60_000);
});
