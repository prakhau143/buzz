/**
 * Phase 4 final QA — threads, channel/thread attachments and reactions against
 * the REAL relay, in a REPEATABLE shape.
 *
 * Until now the only live coverage of threads and reactions sat inside the
 * operator-gated `liveRelay` / `reactions` specs, which provision a community
 * per run and exhaust `MAX_COMMUNITIES_PER_OWNER` after one pass (see
 * `docs/PHASE_4_RUN_STATE.md` §E2E quota). This file follows the pattern that
 * does repeat — `readState` / `moderation` / `searchInbox`: reuse the existing
 * dev community, its existing members and an existing open channel. It creates
 * no community and no channel.
 *
 * What only a live relay can settle, and is asserted here:
 *   - the relay accepts NIP-10 reply markers and `fetchThread` scopes them to
 *     the root — an unrelated message posted in between stays out;
 *   - reply overlays (edit, self-delete kind:5, admin-delete kind:9005) are
 *     reachable through the thread fetch, which is structurally blind to them
 *     unless it asks by reply id (the Part C defect);
 *   - root edit/delete folds the same way;
 *   - an `imeta` attachment on a channel message and on a thread reply survives
 *     the real wire, and the blob is readable only with a Blossom GET token from
 *     a relay member — anonymous and non-member reads are refused;
 *   - a reaction aggregates and retracts.
 *
 * Media uploads are rate-limited per (community, pubkey) per minute, so this
 * file uploads exactly once as each identity. Run live specs one file at a time.
 *
 * Env (test process only, never written to the tree):
 *   SWF_E2E_DM_SK_A (owner), SWF_E2E_DM_SK_B (plain member), SWF_E2E_DM_HOST.
 */
import dns from "node:dns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { hexToBytes } from "nostr-tools/utils";
import { generateSecretKey } from "nostr-tools/pure";
import { useWebSocketImplementation } from "nostr-tools/relay";
import WebSocket from "ws";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { setActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { channelService } from "@/features/channels/ChannelService";
import { messageService } from "@/features/messages/MessageService";
import { threadService, type ThreadData } from "@/features/threads/ThreadService";
import { reactionService } from "@/features/reactions/ReactionService";
import { mediaService } from "@/services/MediaService";
import {
  applyDelete,
  applyEdit,
  emptyOverlays,
  renderTimeline,
} from "@/features/messages/messageOverlay";
import type { Message } from "@/types/domain";
import { compareMessages } from "@/features/messages/messageCursor";

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

/**
 * Node has no XMLHttpRequest, which `MediaService.upload` uses for upload
 * progress. Same test-process-only shim as `dmAttachments.e2e.spec.ts`: it
 * performs the REAL PUT with the real headers and body — only progress events
 * are not simulated, and nothing here asserts on them.
 */
class FetchBackedXhr {
  private method = "GET";
  private url = "";
  private readonly headers: Record<string, string> = {};
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readonly upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: Blob | ArrayBuffer | string) {
    void (async () => {
      try {
        const res = await fetch(this.url, { method: this.method, headers: this.headers, body: body as BodyInit });
        this.status = res.status;
        this.responseText = await res.text();
        this.onload?.();
      } catch {
        this.onerror?.();
      }
    })();
  }
}
(globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest ??= FetchBackedXhr;

const SK_A = process.env.SWF_E2E_DM_SK_A?.trim() ?? "";
const SK_B = process.env.SWF_E2E_DM_SK_B?.trim() ?? "";
const HOST = process.env.SWF_E2E_DM_HOST?.trim() ?? "";
const HAS_ENV = /^[0-9a-f]{64}$/i.test(SK_A) && /^[0-9a-f]{64}$/i.test(SK_B) && HOST.length > 0;
const RELAY_URL = `ws://${HOST}`;

/** NIP-42 binds the pubkey to the socket: every identity switch reconnects. */
async function actAs(signer: DevSigningService): Promise<void> {
  relayConnectionService.disconnect();
  setActiveSigningService(signer);
  await relayConnectionService.connect(RELAY_URL);
}

/** Fold a thread fetch exactly as `useThread` does. */
function renderThread(data: ThreadData): { root: Message | undefined; replies: Message[] } {
  const overlays = emptyOverlays();
  for (const edit of data.edits) applyEdit(overlays, edit);
  for (const del of data.deletes) applyDelete(overlays, del);
  const [root] = data.root ? renderTimeline([data.root], overlays) : [];
  return { root, replies: renderTimeline(data.replies, overlays) };
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 12_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    last = await fn();
  }
  return last;
}

/** 1×1 PNG — sniffed by the relay as image/png, so it takes the image path. */
function tinyPng(): Uint8Array<ArrayBuffer> {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return new Uint8Array(Buffer.from(b64, "base64"));
}

describe.skipIf(!HAS_ENV)("Phase 4 final QA — threads, attachments, reactions (repeatable)", () => {
  let signerA: DevSigningService;
  let signerB: DevSigningService;
  let pubkeyA = "";
  let pubkeyB = "";
  let channelId = "";

  beforeAll(async () => {
    setActivePinia(createPinia());
    signerA = new DevSigningService(hexToBytes(SK_A));
    signerB = new DevSigningService(hexToBytes(SK_B));
    pubkeyA = await signerA.getPublicKey();
    pubkeyB = await signerB.getPublicKey();
    expect(pubkeyA).not.toBe(pubkeyB);

    await actAs(signerA);
    const channels = await waitFor(
      () => channelService.discoverChannels(),
      (list) => list.some((c) => c.visibility !== "private"),
    );
    // Reuse an existing open channel: no channel creation, no quota, repeatable.
    channelId = channels.find((c) => c.visibility !== "private")!.id;
    expect(channelId).toBeTruthy();
  }, 60_000);

  afterAll(() => relayConnectionService.disconnect());

  it("creates and loads a thread scoped to its root, with mentions, and nothing unrelated leaks in", async () => {
    const tag = Date.now().toString(36);
    await actAs(signerA);
    const root = await messageService.send({ channelId, content: `qa-root ${tag}` });

    await actAs(signerB);
    const reply1 = await messageService.send({
      channelId,
      content: `qa-reply-1 ${tag}`,
      reply: { rootEventId: root.id, parentEventId: root.id, parentAuthorPubkey: pubkeyA },
    });
    // An unrelated top-level message in the same channel, between the replies.
    const unrelated = await messageService.send({ channelId, content: `qa-unrelated ${tag}` });
    const reply2 = await messageService.send({
      channelId,
      content: `qa-reply-2 ${tag} @owner`,
      reply: { rootEventId: root.id, parentEventId: reply1.id, parentAuthorPubkey: pubkeyB },
      mentionPubkeys: [pubkeyA],
    });

    await actAs(signerA);
    const data = await waitFor(
      () => threadService.fetchThread(root.id),
      (d) => d.replies.length >= 2,
    );
    const { root: r, replies } = renderThread(data);

    expect(r?.id).toBe(root.id);
    // Canonical (createdAt, id) order — the same rule as the channel timeline.
    expect(replies.map((m) => m.id)).toEqual([reply1, reply2].sort(compareMessages).map((m) => m.id));
    expect(new Set(replies.map((m) => m.id)).size, "no duplicate replies").toBe(replies.length);
    expect(replies.some((m) => m.id === unrelated.id), "unrelated message must stay out").toBe(false);
    expect(replies.every((m) => m.thread.rootId === root.id)).toBe(true);
    const second = replies.find((m) => m.id === reply2.id)!;
    expect(second.thread.parentId ?? second.thread.rootId).toBeTruthy();
    expect(second.mentions).toContain(pubkeyA);
  }, 90_000);

  it("folds reply edit, reply self-delete, reply admin-delete and root edit through the thread fetch", async () => {
    const tag = Date.now().toString(36);
    await actAs(signerA);
    const root = await messageService.send({ channelId, content: `qa-root-v1 ${tag}` });

    await actAs(signerB);
    const reply = (content: string) =>
      messageService.send({
        channelId,
        content,
        reply: { rootEventId: root.id, parentEventId: root.id, parentAuthorPubkey: pubkeyA },
      });
    const edited = await reply(`edit-me ${tag}`);
    const selfDeleted = await reply(`self-delete-me ${tag}`);
    const adminDeleted = await reply(`admin-delete-me ${tag}`);
    const kept = await reply(`kept ${tag}`);

    await messageService.edit({ channelId, targetEventId: edited.id, content: `edited ${tag}` });
    await messageService.remove({ channelId, targetEventId: selfDeleted.id, mode: "self" });
    // A plain member cannot admin-delete the owner's root.
    await expect(
      messageService.remove({ channelId, targetEventId: root.id, mode: "admin" }),
    ).rejects.toThrow();

    await actAs(signerA);
    await messageService.remove({ channelId, targetEventId: adminDeleted.id, mode: "admin" });
    await messageService.edit({ channelId, targetEventId: root.id, content: `qa-root-v2 ${tag}` });

    const view = await waitFor(
      async () => renderThread(await threadService.fetchThread(root.id)),
      (v) => v.root?.content === `qa-root-v2 ${tag}` && v.replies.length === 2,
    );
    expect(view.root?.content).toBe(`qa-root-v2 ${tag}`);
    expect(view.replies.map((m) => m.id)).toEqual([edited, kept].sort(compareMessages).map((m) => m.id));
    const editedRow = view.replies.find((m) => m.id === edited.id)!;
    expect(editedRow.content).toBe(`edited ${tag}`);
    expect(editedRow.editedAt).toBeGreaterThan(0);

    // Root self-delete: the thread's root disappears through the same fold.
    await messageService.remove({ channelId, targetEventId: root.id, mode: "self" });
    const afterRootDelete = await waitFor(
      async () => renderThread(await threadService.fetchThread(root.id)),
      (v) => v.root === undefined,
    );
    expect(afterRootDelete.root, "deleted root must not render").toBeUndefined();
  }, 120_000);

  it("a reply posted while an identity is disconnected is present after it reconnects", async () => {
    const tag = Date.now().toString(36);
    await actAs(signerB);
    const root = await messageService.send({ channelId, content: `qa-gap-root ${tag}` });
    relayConnectionService.disconnect();

    await actAs(signerA);
    const late = await messageService.send({
      channelId,
      content: `qa-gap-reply ${tag}`,
      reply: { rootEventId: root.id, parentEventId: root.id, parentAuthorPubkey: pubkeyB },
    });

    await actAs(signerB);
    const { replies } = renderThread(
      await waitFor(() => threadService.fetchThread(root.id), (d) => d.replies.length > 0),
    );
    expect(replies.map((m) => m.id)).toEqual([late.id]);
  }, 90_000);

  it("carries a generic file on a channel message and an image on a thread reply; media reads need member auth", async () => {
    const tag = Date.now().toString(36);

    // ---- Channel surface: A attaches a generic file (filename has spaces) --
    await actAs(signerA);
    const fileBytes = new TextEncoder().encode(`phase 4 qa file ${tag}\n`);
    const file = await mediaService.upload(new Blob([fileBytes], { type: "text/plain" }), {
      relayUrl: RELAY_URL,
    });
    const channelMsg = await messageService.send({
      channelId,
      content: `qa-file ${tag}`,
      attachments: [
        {
          url: file.url,
          mimeType: file.mimeType,
          sha256: file.sha256,
          size: file.size,
          filename: "qa notes final.txt",
        },
      ],
    });

    // ---- Thread surface: B replies with an image --------------------------
    await actAs(signerB);
    const png = tinyPng();
    const image = await mediaService.upload(new Blob([png], { type: "image/png" }), {
      relayUrl: RELAY_URL,
    });
    const replyMsg = await messageService.send({
      channelId,
      content: `qa-image-reply ${tag}`,
      reply: { rootEventId: channelMsg.id, parentEventId: channelMsg.id, parentAuthorPubkey: pubkeyA },
      attachments: [
        { url: image.url, mimeType: "image/png", sha256: image.sha256, size: png.length, filename: "tiny reply.png" },
      ],
    });

    // ---- A reads both back over the real wire ------------------------------
    await actAs(signerA);
    const data = await waitFor(
      () => threadService.fetchThread(channelMsg.id),
      (d) => d.replies.some((m) => m.id === replyMsg.id),
    );
    const rootAtt = data.root?.attachments ?? [];
    expect(rootAtt).toHaveLength(1);
    expect(rootAtt[0].sha256).toBe(file.sha256);
    expect(rootAtt[0].filename, "first-space-only imeta split over the wire").toBe("qa notes final.txt");
    const replyAtt = data.replies.find((m) => m.id === replyMsg.id)!.attachments;
    expect(replyAtt).toHaveLength(1);
    expect(replyAtt[0].mimeType).toBe("image/png");
    expect(replyAtt[0].filename).toBe("tiny reply.png");

    // ---- Authorization boundary on the bytes --------------------------------
    const anonymous = await fetch(image.url);
    expect(anonymous.status, "anonymous media read must be refused").toBeGreaterThanOrEqual(400);

    const blobUrl = await mediaService.fetchAuthorizedBlobUrl(image.url, image.sha256);
    expect(blobUrl.startsWith("blob:")).toBe(true);
    const bytes = new Uint8Array(await (await fetch(blobUrl)).arrayBuffer());
    expect(Buffer.from(bytes).equals(Buffer.from(png)), "authorized read returns the stored bytes").toBe(true);
    URL.revokeObjectURL(blobUrl);

    // A validly signed GET token from a pubkey that is NOT a relay member.
    setActiveSigningService(new DevSigningService(generateSecretKey()));
    await expect(
      mediaService.fetchAuthorizedBlobUrl(file.url, file.sha256),
      "a signed read from a non-member must be refused",
    ).rejects.toBeTruthy();
    setActiveSigningService(signerA);
  }, 120_000);

  it("aggregates a reaction and retracts it", async () => {
    const tag = Date.now().toString(36);
    await actAs(signerA);
    const target = await messageService.send({ channelId, content: `qa-react ${tag}` });

    await actAs(signerB);
    await reactionService.react(target.id, "👍");

    await actAs(signerA);
    const after = await waitFor(
      () => reactionService.fetchChannelReactions(channelId),
      (m) => (m.get(target.id) ?? []).some((r) => r.emoji === "👍" && r.count > 0),
    );
    const thumbs = (after.get(target.id) ?? []).find((r) => r.emoji === "👍");
    expect(thumbs?.count).toBe(1);
    expect(thumbs?.reactorPubkeys).toEqual([pubkeyB]);

    await actAs(signerB);
    // reactorEventIds maps reactor pubkey → that reactor's kind:7 event id.
    const reactionEventId = thumbs!.reactorEventIds[pubkeyB];
    expect(reactionEventId).toMatch(/^[0-9a-f]{64}$/);
    await reactionService.unreact(reactionEventId);

    await actAs(signerA);
    const retracted = await waitFor(
      () => reactionService.fetchChannelReactions(channelId),
      (m) => !(m.get(target.id) ?? []).some((r) => r.emoji === "👍" && r.count > 0),
    );
    expect((retracted.get(target.id) ?? []).some((r) => r.emoji === "👍" && r.count > 0)).toBe(false);
  }, 90_000);
});
