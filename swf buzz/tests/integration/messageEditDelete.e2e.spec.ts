/**
 * Phase 4B acceptance — edit / self-delete / admin-delete against the REAL relay.
 *
 * The unit tests prove the overlay algebra. Only the relay can prove that
 * kind:40003 is accepted from the author and refused from anyone else, that
 * kind:9005 is the path an admin must use, and — the one that matters most —
 * that kind:5 is NOT a usable admin-delete path. That last assertion is the
 * whole reason this file exists: a client that implemented admin delete as
 * "kind:5 plus a role check" would pass every mock-based test and fail silently
 * in production.
 *
 *   npx vitest run --config vitest.e2e.config.ts tests/integration/messageEditDelete.e2e.spec.ts
 *
 * Env: SWF_E2E_DM_SK_A (channel owner), SWF_E2E_DM_SK_B (plain member),
 *      SWF_E2E_DM_HOST.
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
import { channelService } from "@/features/channels/ChannelService";
import { messageService } from "@/features/messages/MessageService";
import {
  applyDelete,
  applyEdit,
  emptyOverlays,
  renderTimeline,
} from "@/features/messages/messageOverlay";

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

/**
 * Act as a given identity.
 *
 * NIP-42 binds the authenticated pubkey to the SOCKET, so swapping the signer
 * alone leaves the connection authenticated as the previous identity and the
 * relay refuses the publish with "event pubkey does not match authenticated
 * identity". Every identity switch therefore has to reconnect.
 */
async function actAs(signer: DevSigningService): Promise<void> {
  relayConnectionService.disconnect();
  setActiveSigningService(signer);
  await relayConnectionService.connect(RELAY_URL);
}

/** Read the whole timeline back, folding overlays exactly as the UI does. */
async function renderedTimeline(channelId: string) {
  const page = await messageService.fetchMessages(channelId, 100);
  const overlays = emptyOverlays();
  for (const edit of page.edits) applyEdit(overlays, edit);
  for (const del of page.deletes) applyDelete(overlays, del);
  return renderTimeline(page.messages, overlays);
}

describe.skipIf(!HAS_ENV)("Phase 4B — edit and delete on the real relay", () => {
  let signerA: DevSigningService;
  let signerB: DevSigningService;
  let channelId: string | null = null;

  beforeAll(async () => {
    setActivePinia(createPinia());
    signerA = new DevSigningService(hexToBytes(SK_A));
    signerB = new DevSigningService(hexToBytes(SK_B));
    setActiveSigningService(signerA);
    await relayConnectionService.connect(RELAY_URL);

    // createChannel publishes kind:9007; the relay assigns the id, which
    // arrives via discovery — so poll for it rather than assuming a return value.
    const name = `4b-edit-delete-${Date.now()}`;
    await channelService.createChannel({ name, visibility: "open" });
    for (let attempt = 0; attempt < 20 && !channelId; attempt++) {
      const list = await channelService.discoverChannels();
      channelId = list.find((c) => c.name === name)?.id ?? null;
      if (!channelId) await new Promise((r) => setTimeout(r, 500));
    }
    expect(channelId, "the new channel must appear to its creator").toBeTruthy();
  }, 60_000);

  afterAll(() => relayConnectionService.disconnect());

  it(
    "the author can edit; the edit renders and the original is retained",
    async () => {
      await actAs(signerA);
      const sent = await messageService.send({ channelId: channelId!, content: "before edit" });
      await messageService.edit({
        channelId: channelId!,
        targetEventId: sent.id,
        content: "after edit",
      });

      const timeline = await renderedTimeline(channelId!);
      const row = timeline.find((m) => m.id === sent.id);

      expect(row?.content).toBe("after edit");
      expect(row?.editedAt).toBeGreaterThan(0);

      // The base event is still on the relay — the overlay is applied at render
      // time, the original was never rewritten.
      const raw = await messageService.fetchMessages(channelId!, 100);
      expect(raw.messages.find((m) => m.id === sent.id)?.content).toBe("before edit");
    },
    60_000,
  );

  it(
    "the newest edit wins after several edits",
    async () => {
      await actAs(signerA);
      const sent = await messageService.send({ channelId: channelId!, content: "v1" });
      for (const text of ["v2", "v3", "v4"]) {
        await messageService.edit({
          channelId: channelId!,
          targetEventId: sent.id,
          content: text,
        });
        // Distinct seconds, so "newest" is unambiguous rather than a tie-break.
        await new Promise((r) => setTimeout(r, 1100));
      }

      const timeline = await renderedTimeline(channelId!);
      expect(timeline.find((m) => m.id === sent.id)?.content).toBe("v4");
    },
    90_000,
  );

  it(
    "another member's edit of my message is REFUSED by the relay",
    async () => {
      await actAs(signerA);
      const sent = await messageService.send({ channelId: channelId!, content: "A's message" });

      await actAs(signerB);
      await expect(
        messageService.edit({
          channelId: channelId!,
          targetEventId: sent.id,
          content: "B rewriting A's words",
        }),
      ).rejects.toThrow();

      await actAs(signerA);
      const timeline = await renderedTimeline(channelId!);
      expect(timeline.find((m) => m.id === sent.id)?.content).toBe("A's message");
    },
    60_000,
  );

  it(
    "the author can self-delete with kind:5 and the row disappears",
    async () => {
      await actAs(signerA);
      const sent = await messageService.send({ channelId: channelId!, content: "delete me" });

      await messageService.remove({
        channelId: channelId!,
        targetEventId: sent.id,
        mode: "self",
      });

      const timeline = await renderedTimeline(channelId!);
      expect(timeline.find((m) => m.id === sent.id)).toBeUndefined();
    },
    60_000,
  );

  it(
    "a channel owner deletes another member's message with kind:9005 — and kind:5 CANNOT do it",
    async () => {
      // B (a plain member of this open channel) posts.
      await actAs(signerB);
      const sent = await messageService.send({ channelId: channelId!, content: "B's message" });

      // A is the channel creator, i.e. its owner. The wrong implementation —
      // kind:5 with a local role check — must be refused, because kind:5 is
      // gated on authorship alone.
      await actAs(signerA);
      await expect(
        messageService.remove({ channelId: channelId!, targetEventId: sent.id, mode: "self" }),
      ).rejects.toThrow();

      // Still there: the refused kind:5 changed nothing.
      expect((await renderedTimeline(channelId!)).find((m) => m.id === sent.id)?.content).toBe(
        "B's message",
      );

      // The correct path.
      await messageService.remove({ channelId: channelId!, targetEventId: sent.id, mode: "admin" });

      const timeline = await renderedTimeline(channelId!);
      expect(timeline.find((m) => m.id === sent.id)).toBeUndefined();
    },
    90_000,
  );

  it(
    "a plain member cannot admin-delete somebody else's message",
    async () => {
      await actAs(signerA);
      const sent = await messageService.send({ channelId: channelId!, content: "owner's post" });

      await actAs(signerB);
      await expect(
        messageService.remove({ channelId: channelId!, targetEventId: sent.id, mode: "admin" }),
      ).rejects.toThrow();

      await actAs(signerA);
      expect((await renderedTimeline(channelId!)).find((m) => m.id === sent.id)?.content).toBe(
        "owner's post",
      );
    },
    60_000,
  );

  it(
    "a second identity sees the edit and the deletion without being told",
    async () => {
      await actAs(signerA);
      const edited = await messageService.send({ channelId: channelId!, content: "original" });
      const removed = await messageService.send({ channelId: channelId!, content: "doomed" });
      await messageService.edit({
        channelId: channelId!,
        targetEventId: edited.id,
        content: "updated by A",
      });
      await messageService.remove({
        channelId: channelId!,
        targetEventId: removed.id,
        mode: "self",
      });

      // B reads independently — a fresh connection, no shared client state.
      await actAs(signerB);

      const timeline = await renderedTimeline(channelId!);
      expect(timeline.find((m) => m.id === edited.id)?.content).toBe("updated by A");
      expect(timeline.find((m) => m.id === removed.id)).toBeUndefined();
    },
    90_000,
  );
});
