/**
 * Real two-identity DM round trip against the running local buzz-relay.
 *
 * WHY THIS FILE EXISTS: `Kind41010Transport.open` parsed the relay's OK reason
 * with a bare `JSON.parse`, but the relay answers command kinds with a
 * `response:`-prefixed JSON document (`command_executor.rs` `handle_dm_open`,
 * `format!("response:{}", …)`). Every real DM-open therefore failed with "The
 * server didn't return a conversation id for this DM." The unit suite missed it
 * because its fixture encoded the same wrong assumption — only a real relay
 * settles the wire format, so this test talks to one.
 *
 * NOT part of `npm run test` (excluded via `*.e2e.spec.ts`). Run explicitly:
 *
 *   npx vitest run --config vitest.e2e.config.ts tests/integration/dmLiveRelay.e2e.spec.ts
 *
 * PRECONDITIONS — the test skips (never fails) unless all are supplied:
 *   SWF_E2E_DM_SK_A   64-hex secret key of an existing community member
 *   SWF_E2E_DM_SK_B   64-hex secret key of a second member of the SAME community
 *   SWF_E2E_DM_HOST   that community's host, e.g. `swf-xyz.localhost:3000`
 *
 * Both identities must already be rows in that community's `relay_members`,
 * because NIP-42 auth and `Scope::MessagesWrite` are enforced per tenant. No
 * secret is written into this repository: the keys reach the process only
 * through the environment, and nothing here prints them.
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
import { dmService } from "@/features/dm/DmService";
import { messageService } from "@/features/messages/MessageService";
import {
  applyDelete,
  applyEdit,
  emptyOverlays,
  renderTimeline,
} from "@/features/messages/messageOverlay";

// Node's `dns.lookup` does not treat arbitrary `*.localhost` subdomains as
// loopback (a browser does). Test-process-only patch, scoped to `.localhost`;
// every other hostname falls through untouched. Same approach as
// liveRelay.e2e.spec.ts.
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

// Node 22's bundled undici WebSocket recurses without bound when nostr-tools
// calls `ws.close()` from inside its own `onerror`; pin to the `ws` client so
// this behaves identically on every Node version. Before any Relay is built.
useWebSocketImplementation(WebSocket);

const SK_A = process.env.SWF_E2E_DM_SK_A?.trim() ?? "";
const SK_B = process.env.SWF_E2E_DM_SK_B?.trim() ?? "";
const HOST = process.env.SWF_E2E_DM_HOST?.trim() ?? "";
const HAS_ENV = /^[0-9a-f]{64}$/i.test(SK_A) && /^[0-9a-f]{64}$/i.test(SK_B) && HOST.length > 0;
const RELAY_URL = `ws://${HOST}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe.runIf(HAS_ENV)("DM end to end — two real identities, real relay", () => {
  beforeAll(() => {
    setActivePinia(createPinia());
  });

  afterAll(() => {
    relayConnectionService.disconnect();
  });

  it(
    "opens a DM, dedups a re-open, and the receiver discovers it with the message",
    async () => {
      const signerA = new DevSigningService(hexToBytes(SK_A));
      const signerB = new DevSigningService(hexToBytes(SK_B));
      const pubkeyA = await signerA.getPublicKey();
      const pubkeyB = await signerB.getPublicKey();
      expect(pubkeyA).not.toBe(pubkeyB);

      // ---- A enters the community (real NIP-42 auth) ----------------------
      setActiveSigningService(signerA);
      await relayConnectionService.connect(RELAY_URL);
      expect(useConnectionStore().status).toBe("connected");

      // ---- THE REGRESSION: open a DM and actually get a channel id --------
      // Pre-fix this threw AppError("relay_rejected", "The server didn't
      // return a conversation id for this DM.").
      let conversationId: string;
      try {
        conversationId = await dmService.openConversation([pubkeyB]);
      } catch (err) {
        // Surface the relay's own reason — the whole point of this test is to
        // learn what the real server says, not to assert a guess about it.
        const cause = (err as { cause?: unknown }).cause;
        throw new Error(
          `openConversation failed: ${(err as Error).message} | ${String(
            cause instanceof Error ? cause.message : cause,
          )}`,
          { cause: err },
        );
      }
      expect(conversationId).toMatch(UUID_RE);

      // ---- Re-opening the same pair returns the SAME conversation ---------
      // `open_dm` is find-or-create keyed on the participant set, so the
      // sidebar must not accumulate duplicate threads.
      const reopenedId = await dmService.openConversation([pubkeyB]);
      expect(reopenedId).toBe(conversationId);

      // ---- A sends into the DM --------------------------------------------
      const body = `dm round trip ${Date.now()}`;
      const sent = await dmService.sendMessage(conversationId, body);
      expect(sent.content).toBe(body);

      // ---- B takes over the connection as an independent identity ---------
      relayConnectionService.disconnect();
      setActiveSigningService(signerB);
      await relayConnectionService.connect(RELAY_URL);
      expect(useConnectionStore().status).toBe("connected");

      // ---- Receiver side: B discovers the conversation without being told --
      const conversations = await dmService.discoverConversations(pubkeyB);
      const found = conversations.find((c) => c.id === conversationId);
      expect(found, "B must discover the DM A opened").toBeTruthy();
      expect(found!.channelType).toBe("dm");
      expect(found!.dmParticipants).toEqual(expect.arrayContaining([pubkeyA, pubkeyB]));

      // ---- B reads A's message --------------------------------------------
      // 4E: fetchHistory returns the whole TimelinePage (messages + overlays),
      // not a bare message array, so an edit landing in the same page as its
      // target is not silently discarded.
      const history = (await dmService.fetchHistory(conversationId)).messages;
      const delivered = history.find((m) => m.id === sent.id);
      expect(delivered, "B must see the message A sent").toBeTruthy();
      expect(delivered!.content).toBe(body);

      // ---- B opening the same pair resolves to the same conversation ------
      // Proves the dedup is keyed on the participant set, not on the opener.
      const fromBsSide = await dmService.openConversation([pubkeyA]);
      expect(fromBsSide).toBe(conversationId);
    },
    60_000,
  );

  /**
   * Phase 4E. A DM conversation is a channel, so the edit/delete events 4B put
   * on the channel timeline subscription are real here too — the transport used
   * to drop them, leaving a DM showing stale text after an edit and still
   * rendering deleted rows. This proves the relay actually accepts and serves
   * them on a DM channel, which no unit test can establish.
   */
  it(
    "carries edits and deletions on a DM, and backfills them after a reconnect",
    async () => {
      const signerA = new DevSigningService(hexToBytes(SK_A));
      const signerB = new DevSigningService(hexToBytes(SK_B));
      const pubkeyA = await signerA.getPublicKey();
      const pubkeyB = await signerB.getPublicKey();

      setActiveSigningService(signerA);
      await relayConnectionService.connect(RELAY_URL);
      const conversationId = await dmService.openConversation([pubkeyB]);

      const original = `dm overlay ${Date.now()}`;
      const sent = await dmService.sendMessage(conversationId, original);

      // Edit and delete two separate messages, so one overlay of each kind is
      // observable without them masking each other.
      const doomed = await dmService.sendMessage(conversationId, `dm doomed ${Date.now()}`);
      const edited = `${original} (edited)`;
      await messageService.edit({
        channelId: conversationId,
        targetEventId: sent.id,
        content: edited,
      });
      await messageService.remove({
        channelId: conversationId,
        targetEventId: doomed.id,
        mode: "self",
      });

      // ---- B reconnects fresh and must see the final state -----------------
      // This is the backfill path, not the live path: B was never connected
      // while any of the above happened, so everything arrives as history.
      relayConnectionService.disconnect();
      setActiveSigningService(signerB);
      await relayConnectionService.connect(RELAY_URL);

      const page = await dmService.fetchHistory(conversationId);

      const editOverlay = page.edits.find((e) => e.targetId === sent.id);
      expect(editOverlay, "B must receive A's DM edit as an overlay").toBeTruthy();
      expect(editOverlay!.content).toBe(edited);
      expect(editOverlay!.authorPubkey).toBe(pubkeyA);

      // Deletions: history now comes from the relay's channel window over the
      // HTTP bridge, which is served only from rows with `deleted_at IS NULL`
      // (buzz-db `store/thread.rs`). The relay therefore applies a deletion by
      // omitting the row, not by shipping its kind:5. Either mechanism is fine;
      // what must never happen is a deleted message that renders. So: a deleted
      // row that DOES come back must carry its deletion, and the rendered
      // timeline — folded exactly as the UI folds it — must not contain it.
      const deleteOverlay = page.deletes.find((d) => d.targetId === doomed.id);
      if (page.messages.some((m) => m.id === doomed.id)) {
        expect(deleteOverlay, "a returned deleted row must carry its deletion").toBeTruthy();
        expect(deleteOverlay!.isAdminDelete).toBe(false);
      }
      const overlays = emptyOverlays();
      for (const edit of page.edits) applyEdit(overlays, edit);
      for (const del of page.deletes) applyDelete(overlays, del);
      const rendered = renderTimeline(page.messages, overlays);
      expect(rendered.some((m) => m.id === doomed.id), "B must not see A's deleted DM").toBe(false);
      expect(rendered.find((m) => m.id === sent.id)?.content, "B sees the edit applied").toBe(edited);

      // The base events are untouched — folding is a render-time concern, which
      // is what makes out-of-order overlay delivery safe.
      expect(page.messages.find((m) => m.id === sent.id)?.content).toBe(original);

      // ---- The gap backfill returns the same overlays, not just messages ----
      const since = Math.min(sent.createdAt, doomed.createdAt) - 1;
      const repaired = await dmService.fetchSince(conversationId, since);
      expect(repaired.edits.some((e) => e.targetId === sent.id)).toBe(true);
      expect(repaired.deletes.some((d) => d.targetId === doomed.id)).toBe(true);
    },
    60_000,
  );
});
