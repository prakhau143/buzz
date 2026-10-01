/**
 * Phase 4C final QA — search (NIP-50) and inbox (bridge `feed_types`) against
 * the REAL relay.
 *
 * Closes the last "unit-proven, never run live" gap in Phase 4C. The properties
 * below are precisely the ones a unit test cannot establish, because they are
 * the relay's behaviour rather than ours:
 *
 *   - search is answered by the relay's Postgres FTS at all;
 *   - a message in a channel the caller cannot read is NOT returned — the
 *     access boundary is the relay (`buzz-search/src/lib.rs:12-15`), and the
 *     client deliberately does not re-filter hits;
 *   - the bridge really does canonicalize `agent_activity` → `activity`, so
 *     "Agent updates" must be a client-side narrowing or rows would double;
 *   - a non-member is refused the feed rather than shown an empty one.
 *
 * The private-channel leak test asserts BOTH directions on purpose: the author
 * must find their own message and the outsider must not. A one-sided assertion
 * would pass just as happily if the message had never been indexed at all.
 *
 * Reuses the existing community and its existing members — no community is
 * provisioned, so this consumes none of the operator's
 * `MAX_COMMUNITIES_PER_OWNER` quota (see `docs/PHASE_4_RUN_STATE.md` §E2E quota).
 * One private channel is created, which is what the leak test is about.
 *
 * Credentials come from the out-of-repo files, via env, for the test process
 * only — never printed, never written into the repository:
 *
 *   $env:SWF_E2E_MEMBER_SK = <hex secret of 2dffa5eb… (MEMBER_A)>
 *   $env:SWF_E2E_OWNER_SK  = <hex secret of 07227e7a… (OWNER_A)>
 *   npx vitest run --config vitest.e2e.config.ts tests/integration/searchInbox.e2e.spec.ts
 *
 * Without them the whole describe skips, exactly as the other live specs do.
 */
import dns from "node:dns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { hexToBytes } from "nostr-tools/utils";
import { useWebSocketImplementation } from "nostr-tools/relay";
import WebSocket from "ws";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { setActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { channelService } from "@/features/channels/ChannelService";
import { messageService } from "@/features/messages/MessageService";
import { searchService } from "@/features/search/SearchService";
import { inboxService } from "@/features/inbox/InboxService";
import { isAgentActivityKind } from "@/protocol/inbox";
import { generateSecretKey } from "nostr-tools/pure";

useWebSocketImplementation(WebSocket);

/** Both identities are existing members of this community — see Phase 4 run state. */
const COMMUNITY_WS = "ws://swf-development-1790079628466.localhost:3000";

const MEMBER_SK_HEX = process.env.SWF_E2E_MEMBER_SK?.trim() ?? "";
const OWNER_SK_HEX = process.env.SWF_E2E_OWNER_SK?.trim() ?? "";
const HAS_KEYS = /^[0-9a-f]{64}$/i.test(MEMBER_SK_HEX) && /^[0-9a-f]{64}$/i.test(OWNER_SK_HEX);

// Same test-process-only `*.localhost` loopback patch the other live specs use:
// Node does not resolve `*.localhost`, but the relay selects its tenant from the
// HTTP Host header, so the subdomain must survive to the request.
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
  ok: (value: T) => boolean,
  { timeoutMs = 12_000, intervalMs = 500 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

/** Re-point the singleton connection at a different identity. */
async function connectAs(secretHex: string): Promise<string> {
  relayConnectionService.disconnect();
  const signer = new DevSigningService(hexToBytes(secretHex));
  setActiveSigningService(signer);
  await relayConnectionService.connect(COMMUNITY_WS);
  return signer.getPublicKey();
}

/** A token the FTS can match on and nothing else in the corpus will collide with. */
function uniqueToken(label: string): string {
  return `swfqa${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!HAS_KEYS)("Phase 4C live — search and inbox against the real relay", () => {
  let memberPubkey = "";
  let ownerPubkey = "";
  let sharedChannelId = "";

  beforeAll(async () => {
    setActivePinia(createPinia());
    ownerPubkey = await connectAs(OWNER_SK_HEX);
    const channels = await waitFor(
      () => channelService.discoverChannels(),
      (list) => list.length > 0,
    );
    expect(channels.length).toBeGreaterThan(0);
    // Any channel the owner can see and the member also belongs to; the first
    // public one is the safe pick for the "accessible" half of the test.
    sharedChannelId = (channels.find((c) => c.visibility !== "private") ?? channels[0]).id;
    memberPubkey = await connectAs(MEMBER_SK_HEX);
    expect(memberPubkey).toMatch(/^[0-9a-f]{64}$/);
    // The leak test is vacuous if both keys resolve to the same identity.
    expect(memberPubkey).not.toBe(ownerPubkey);
  }, 60_000);

  afterAll(() => relayConnectionService.disconnect());

  it("finds a message the searcher is allowed to read", async () => {
    const token = uniqueToken("acc");
    await connectAs(OWNER_SK_HEX);
    await messageService.send({ channelId: sharedChannelId, content: `accessible ${token}` });

    await connectAs(MEMBER_SK_HEX);
    const hits = await waitFor(
      () => searchService.searchMessages(token),
      (list) => list.length > 0,
    );

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].message.content).toContain(token);
    expect(hits[0].channelId).toBe(sharedChannelId);
  }, 90_000);

  it("does not leak a private channel's message to a non-member — and the author still finds it", async () => {
    const token = uniqueToken("priv");
    const channelName = `qa-private-${Date.now().toString(36)}`;

    await connectAs(OWNER_SK_HEX);
    await channelService.createChannel({ name: channelName, visibility: "private" });
    const channels = await waitFor(
      () => channelService.discoverChannels(),
      (list) => list.some((c) => c.name === channelName),
    );
    const privateChannel = channels.find((c) => c.name === channelName);
    expect(privateChannel, "private channel should have been created").toBeDefined();

    // The private message also MENTIONS the outsider, so the same event probes
    // the inbox boundary: `event_mentions` indexes it for the outsider's pubkey,
    // and only the relay's accessible-channel filter keeps it out of their feed.
    const secret = await messageService.send({
      channelId: privateChannel!.id,
      content: `secret ${token}`,
      mentionPubkeys: [memberPubkey],
    });
    // Positive control for the inbox half: the same mention in a readable channel.
    const visible = await messageService.send({
      channelId: sharedChannelId,
      content: `visible ${token}`,
      mentionPubkeys: [memberPubkey],
    });

    // The author must be able to find it. Without this half, a zero result for
    // the outsider would be indistinguishable from "never indexed".
    const ownerHits = await waitFor(
      () => searchService.searchMessages(`secret ${token}`),
      (list) => list.some((h) => h.message.id === secret.id),
    );
    expect(
      ownerHits.some((h) => h.message.id === secret.id),
      "author must find their own private message",
    ).toBe(true);

    // The outsider must not — neither by search nor through their inbox.
    await connectAs(MEMBER_SK_HEX);
    const memberHits = await searchService.searchMessages(token);
    expect(
      memberHits.some((h) => h.channelId === privateChannel!.id),
      "private channel content must not leak to a non-member via search",
    ).toBe(false);

    const mentions = await waitFor(
      () => inboxService.fetchFeed("mentions", memberPubkey, { relayUrl: COMMUNITY_WS }),
      (list) => list.some((e) => e.event.id === visible.id),
    );
    expect(mentions.some((e) => e.event.id === visible.id), "readable mention must arrive").toBe(true);
    expect(
      mentions.some((e) => e.event.id === secret.id || e.channelId === privateChannel!.id),
      "a mention inside an inaccessible channel must not reach the inbox",
    ).toBe(false);
  }, 120_000);

  it("returns a mention to the mentioned identity's inbox", async () => {
    const token = uniqueToken("men");
    await connectAs(OWNER_SK_HEX);
    const sent = await messageService.send({
      channelId: sharedChannelId,
      content: `hello ${token}`,
      mentionPubkeys: [memberPubkey],
    });

    await connectAs(MEMBER_SK_HEX);
    const entries = await waitFor(
      () => inboxService.fetchFeed("mentions", memberPubkey, { relayUrl: COMMUNITY_WS }),
      (list) => list.some((e) => e.event.id === sent.id),
    );
    expect(entries.some((e) => e.event.id === sent.id)).toBe(true);
  }, 90_000);

  it("partitions activity and agent activity without duplicating or losing rows", async () => {
    await connectAs(MEMBER_SK_HEX);
    const activity = await inboxService.fetchFeed("activity", memberPubkey, {
      relayUrl: COMMUNITY_WS,
    });
    const agent = await inboxService.fetchFeed("agent_activity", memberPubkey, {
      relayUrl: COMMUNITY_WS,
    });

    // The relay aliases agent_activity → activity, so both calls hit the SAME
    // server query. The split must therefore happen client-side and be exact.
    const activityIds = new Set(activity.map((e) => e.event.id));
    const agentIds = new Set(agent.map((e) => e.event.id));
    expect(activityIds.size, "no duplicate rows in activity").toBe(activity.length);
    expect(agentIds.size, "no duplicate rows in agent activity").toBe(agent.length);
    for (const id of agentIds) {
      expect(activityIds.has(id), "an agent row must not also appear in activity").toBe(false);
    }
    for (const entry of agent) {
      expect(isAgentActivityKind(entry.event.kind)).toBe(true);
    }
    for (const entry of activity) {
      expect(isAgentActivityKind(entry.event.kind)).toBe(false);
    }
  }, 60_000);

  it("serves needs_action scoped to the caller: only approval/reminder kinds tagged with them", async () => {
    // needs_action rows are workflow approvals (46010) and reminders (40007),
    // emitted by the relay's workflow engine — a client cannot mint one, so a
    // positive row is not producible here. What IS provable live: the relay
    // accepts the category and never widens it past the caller's own rows.
    await connectAs(MEMBER_SK_HEX);
    const rows = await inboxService.fetchFeed("needs_action", memberPubkey, {
      relayUrl: COMMUNITY_WS,
    });
    expect(new Set(rows.map((e) => e.event.id)).size, "no duplicate rows").toBe(rows.length);
    for (const entry of rows) {
      expect([46010, 40007]).toContain(entry.event.kind);
      expect(entry.event.tags.some((t) => t[0] === "p" && t[1] === memberPubkey)).toBe(true);
    }
  }, 60_000);

  it("refuses the inbox to an identity that is not a member of the community", async () => {
    const outsider = new DevSigningService(generateSecretKey());
    const outsiderPubkey = await outsider.getPublicKey();
    setActiveSigningService(outsider);

    await expect(
      inboxService.fetchFeed("mentions", outsiderPubkey, { relayUrl: COMMUNITY_WS }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  }, 60_000);
});
