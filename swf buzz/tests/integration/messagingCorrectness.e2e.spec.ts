/**
 * Phase 4A acceptance — messaging correctness against the REAL relay.
 *
 * Unit tests prove the cursor/merge logic. Only the relay can prove that the
 * `before_id` keyset actually walks history without losing same-second
 * messages, and that a reconnect backfill really recovers what was published
 * while the socket was down.
 *
 *   npx vitest run --config vitest.e2e.config.ts tests/integration/messagingCorrectness.e2e.spec.ts
 *
 * Env: SWF_E2E_DM_SK_A (owner/admin), SWF_E2E_DM_SK_B (member), SWF_E2E_DM_HOST.
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
import {
  mergeMessages,
  newestCreatedAt,
  oldestCursor,
  compareMessages,
} from "@/features/messages/messageCursor";
import { backfillSince } from "@/features/messages/reconnectRepair";
import type { Message } from "@/types/domain";

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

/** Walk the whole timeline with the keyset cursor, exactly as loadOlder() does. */
async function walkHistory(channelId: string, pageSize: number): Promise<Message[]> {
  // Phase 4B split the timeline into base messages plus edit/delete overlays;
  // history walking is about the base messages, so `.messages` throughout.
  let timeline = (await messageService.fetchMessages(channelId, pageSize)).messages;
  for (let guard = 0; guard < 50; guard++) {
    const cursor = oldestCursor(timeline);
    if (!cursor) break;
    const older = (await messageService.fetchOlderMessages(channelId, cursor, pageSize)).messages;
    if (older.length === 0) break; // genuine exhaustion: the relay excluded the boundary itself
    timeline = mergeMessages(timeline, older);
  }
  return timeline;
}

function assertNoDuplicates(timeline: readonly Message[]): void {
  const ids = timeline.map((m) => m.id);
  expect(new Set(ids).size, "no duplicate event ids in the timeline").toBe(ids.length);
}

function assertCanonicalOrder(timeline: readonly Message[]): void {
  const resorted = [...timeline].sort(compareMessages);
  expect(timeline.map((m) => m.id), "timeline is in canonical order").toEqual(
    resorted.map((m) => m.id),
  );
}

describe.runIf(HAS_ENV)("Phase 4A — messaging correctness, real relay", () => {
  beforeAll(() => setActivePinia(createPinia()));
  afterAll(() => relayConnectionService.disconnect());

  it(
    "paginates a full history without loss or duplicates, then recovers a disconnect gap",
    async () => {
      const signerA = new DevSigningService(hexToBytes(SK_A));
      const signerB = new DevSigningService(hexToBytes(SK_B));
      const pubkeyB = await signerB.getPublicKey();

      // ---- A creates a channel B is a member of ---------------------------
      setActiveSigningService(signerA);
      await relayConnectionService.connect(RELAY_URL);
      expect(useConnectionStore().status).toBe("connected");

      const name = `p4a-${Date.now()}`;
      await channelService.createChannel({ name, visibility: "private" });
      let channelId: string | null = null;
      for (let i = 0; i < 20 && !channelId; i++) {
        channelId = (await channelService.discoverChannels()).find((c) => c.name === name)?.id ?? null;
        if (!channelId) await new Promise((r) => setTimeout(r, 400));
      }
      expect(channelId, "the channel must be discoverable").toBeTruthy();
      await channelService.addMember({ channelId: channelId!, pubkey: pubkeyB });

      // ---- Enough history to require several pages -------------------------
      // Sent back to back, so many of these SHARE a created_at second — which
      // is precisely what the old timestamp-only paging destroyed.
      const TOTAL = 25;
      const sent: string[] = [];
      for (let i = 0; i < TOTAL; i++) {
        const m = await messageService.send({ channelId: channelId!, content: `p4a message ${i}` });
        sent.push(m.id);
      }
      await new Promise((r) => setTimeout(r, 1200));

      // ---- B walks the history with the keyset cursor ----------------------
      relayConnectionService.disconnect();
      setActiveSigningService(signerB);
      await relayConnectionService.connect(RELAY_URL);

      const walked = await walkHistory(channelId!, 5); // small pages ⇒ real pagination
      assertNoDuplicates(walked);
      assertCanonicalOrder(walked);

      const walkedIds = new Set(walked.map((m) => m.id));
      const missing = sent.filter((id) => !walkedIds.has(id));
      expect(missing, "every sent message must survive pagination").toEqual([]);

      // Same-second coverage: prove the history really did contain a burst, so
      // this test would have caught the original defect.
      const bySecond = new Map<number, number>();
      for (const m of walked) bySecond.set(m.createdAt, (bySecond.get(m.createdAt) ?? 0) + 1);
      const busiest = Math.max(...bySecond.values());
      expect(busiest, "at least one second must carry >1 message for this to be a real test").toBeGreaterThan(1);

      // ---- Disconnect B, A publishes, B reconnects and repairs -------------
      const newestBefore = newestCreatedAt(walked);
      relayConnectionService.disconnect();

      setActiveSigningService(signerA);
      await relayConnectionService.connect(RELAY_URL);
      const duringOutage: string[] = [];
      for (let i = 0; i < 5; i++) {
        const m = await messageService.send({ channelId: channelId!, content: `outage ${i}` });
        duringOutage.push(m.id);
      }
      await new Promise((r) => setTimeout(r, 1200));

      relayConnectionService.disconnect();
      setActiveSigningService(signerB);
      await relayConnectionService.connect(RELAY_URL);

      const since = backfillSince(newestBefore);
      expect(since).not.toBeNull();
      let repaired = mergeMessages(
        walked,
        (await messageService.fetchMessagesSince(channelId!, since!)).messages,
      );

      assertNoDuplicates(repaired);
      assertCanonicalOrder(repaired);
      const repairedIds = new Set(repaired.map((m) => m.id));
      expect(
        duringOutage.filter((id) => !repairedIds.has(id)),
        "every message sent during the outage must arrive after reconnect",
      ).toEqual([]);

      // ---- A second disconnect/reconnect cycle stays safe ------------------
      const newestAfterFirst = newestCreatedAt(repaired);
      relayConnectionService.disconnect();

      setActiveSigningService(signerA);
      await relayConnectionService.connect(RELAY_URL);
      const secondOutage: string[] = [];
      for (let i = 0; i < 3; i++) {
        const m = await messageService.send({ channelId: channelId!, content: `outage2 ${i}` });
        secondOutage.push(m.id);
      }
      await new Promise((r) => setTimeout(r, 1200));

      relayConnectionService.disconnect();
      setActiveSigningService(signerB);
      await relayConnectionService.connect(RELAY_URL);

      const before = repaired.length;
      repaired = mergeMessages(
        repaired,
        (await messageService.fetchMessagesSince(channelId!, backfillSince(newestAfterFirst)!)).messages,
      );

      assertNoDuplicates(repaired);
      assertCanonicalOrder(repaired);
      const finalIds = new Set(repaired.map((m) => m.id));
      expect(secondOutage.filter((id) => !finalIds.has(id)), "second cycle must also recover").toEqual([]);
      expect(repaired.length, "repeated repair adds only the new messages").toBe(
        before + secondOutage.length,
      );

      // ---- Re-running the same repair changes nothing (idempotent) ---------
      const twice = mergeMessages(
        repaired,
        (await messageService.fetchMessagesSince(channelId!, backfillSince(newestAfterFirst)!)).messages,
      );
      expect(twice.map((m) => m.id), "a repeated repair is a no-op").toEqual(
        repaired.map((m) => m.id),
      );
    },
    180_000,
  );
});
