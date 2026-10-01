/**
 * Private-channel membership, end to end, with two real identities against the
 * running local buzz-relay.
 *
 * This is the test the "Add members" fix actually rests on. The unit tests
 * prove the candidate set is `community ∖ channel`; only the relay can prove
 * that publishing kind:9000 for that candidate really grants access to a
 * private channel, and that the added member can then read and write it.
 *
 * NOT part of `npm run test`. Run explicitly:
 *
 *   npx vitest run --config vitest.e2e.config.ts tests/integration/privateChannelMembers.e2e.spec.ts
 *
 * PRECONDITIONS — skips (never fails) unless all are supplied:
 *   SWF_E2E_DM_SK_A   64-hex secret key of a community owner/admin
 *   SWF_E2E_DM_SK_B   64-hex secret key of another member of the SAME community
 *   SWF_E2E_DM_HOST   that community's host
 * No secret is written into this repository; keys arrive only through the
 * environment and nothing here prints them.
 */
import dns from "node:dns";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { hexToBytes } from "nostr-tools/utils";
import { useWebSocketImplementation } from "nostr-tools/relay";
import WebSocket from "ws";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { setActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { useConnectionStore } from "@/stores/connection";
import { channelService } from "@/features/channels/ChannelService";
import { messageService } from "@/features/messages/MessageService";
import { relayMembersService } from "@/features/community-members/RelayMembersService";

const _origDnsLookup = dns.lookup;
type LookupCallback = (err: Error | null, address: unknown, family?: number) => void;
type LookupRest = [LookupCallback] | [{ all?: boolean } | number | undefined, LookupCallback];
(dns as { lookup: unknown }).lookup = (hostname: string, ...rest: LookupRest) => {
  if (typeof hostname === "string" && hostname.endsWith(".localhost")) {
    const cb = rest[rest.length - 1] as LookupCallback;
    const opts = rest.length > 1 ? rest[0] : undefined;
    if (opts && typeof opts === "object" && opts.all) {
      return cb(null, [{ address: "127.0.0.1", family: 4 }]);
    }
    return cb(null, "127.0.0.1", 4);
  }
  return (_origDnsLookup as unknown as (...args: unknown[]) => void).call(dns, hostname, ...rest);
};
useWebSocketImplementation(WebSocket);

const SK_A = process.env.SWF_E2E_DM_SK_A?.trim() ?? "";
const SK_B = process.env.SWF_E2E_DM_SK_B?.trim() ?? "";
const HOST = process.env.SWF_E2E_DM_HOST?.trim() ?? "";
const HAS_ENV = /^[0-9a-f]{64}$/i.test(SK_A) && /^[0-9a-f]{64}$/i.test(SK_B) && HOST.length > 0;
const RELAY_URL = `ws://${HOST}`;

async function waitFor<T>(
  fn: () => Promise<T>,
  ok: (value: T) => boolean,
  { timeoutMs = 10_000, intervalMs = 400 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (ok(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe.runIf(HAS_ENV)("private channel membership — two real identities", () => {
  beforeAll(() => setActivePinia(createPinia()));
  afterAll(() => relayConnectionService.disconnect());

  it(
    "an owner/admin adds a community member to a private channel, who can then read and write it",
    async () => {
      const signerA = new DevSigningService(hexToBytes(SK_A));
      const signerB = new DevSigningService(hexToBytes(SK_B));
      const pubkeyA = await signerA.getPublicKey();
      const pubkeyB = await signerB.getPublicKey();
      expect(pubkeyA).not.toBe(pubkeyB);

      // ---- A enters the community -----------------------------------------
      setActiveSigningService(signerA);
      await relayConnectionService.connect(RELAY_URL);
      expect(useConnectionStore().status).toBe("connected");

      // ---- Both identities really are COMMUNITY members --------------------
      // This is the set the picker draws from; if B were not here, the picker
      // would be right to omit them.
      const roster = await relayMembersService.fetchMembershipList();
      const rosterKeys = (roster ?? []).map((m) => m.pubkey.toLowerCase());
      expect(rosterKeys, "A must be in the community roster").toContain(pubkeyA.toLowerCase());
      expect(rosterKeys, "B must be in the community roster").toContain(pubkeyB.toLowerCase());

      // ---- A creates a PRIVATE channel -------------------------------------
      const name = `private-${Date.now()}`;
      await channelService.createChannel({ name, visibility: "private" });
      const channels = await waitFor(
        () => channelService.discoverChannels(),
        (list) => list.some((c) => c.name === name),
      );
      const channel = channels.find((c) => c.name === name);
      expect(channel, "the private channel must appear to its creator").toBeTruthy();
      const channelId = channel!.id;

      // ---- Before the add: B is NOT a channel member ------------------------
      const before = await channelService.fetchMembers(channelId);
      expect(before.map((m) => m.pubkey.toLowerCase())).not.toContain(pubkeyB.toLowerCase());

      // ---- THE OPERATION the picker performs: kind:9000 --------------------
      await channelService.addMember({ channelId, pubkey: pubkeyB });

      const after = await waitFor(
        () => channelService.fetchMembers(channelId),
        (list) => list.some((m) => m.pubkey.toLowerCase() === pubkeyB.toLowerCase()),
      );
      expect(
        after.map((m) => m.pubkey.toLowerCase()),
        "B must be a channel member after the add",
      ).toContain(pubkeyB.toLowerCase());

      // Adding the same person again must not produce a second membership row.
      await channelService.addMember({ channelId, pubkey: pubkeyB });
      const afterDuplicate = await channelService.fetchMembers(channelId);
      const bRows = afterDuplicate.filter((m) => m.pubkey.toLowerCase() === pubkeyB.toLowerCase());
      expect(bRows, "a repeated add must not duplicate the member").toHaveLength(1);

      // ---- B reconnects as themselves and reaches the private channel ------
      relayConnectionService.disconnect();
      setActiveSigningService(signerB);
      await relayConnectionService.connect(RELAY_URL);
      expect(useConnectionStore().status).toBe("connected");

      const bChannels = await waitFor(
        () => channelService.discoverChannels(),
        (list) => list.some((c) => c.id === channelId),
      );
      expect(
        bChannels.some((c) => c.id === channelId),
        "the private channel must be visible to the newly added member",
      ).toBe(true);

      // ---- B writes into it -------------------------------------------------
      const body = `hello from the added member ${Date.now()}`;
      const sent = await messageService.send({ channelId, content: body });
      expect(sent.content).toBe(body);

      // ---- A sees it --------------------------------------------------------
      relayConnectionService.disconnect();
      setActiveSigningService(signerA);
      await relayConnectionService.connect(RELAY_URL);

      const history = await waitFor(
        async () => (await messageService.fetchMessages(channelId)).messages,
        (list) => list.some((m) => m.id === sent.id),
      );
      const delivered = history.find((m) => m.id === sent.id);
      expect(delivered, "the adder must receive the added member's message").toBeTruthy();
      expect(delivered!.content).toBe(body);
    },
    90_000,
  );
});
