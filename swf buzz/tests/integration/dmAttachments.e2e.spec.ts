/**
 * DM attachments end to end against the running local buzz-relay.
 *
 * WHY THIS FILE EXISTS: `useSendDm.send` had no attachment parameter at all —
 * `attachments: []` in the optimistic message was filling a required field,
 * not dropping an argument. So the DM path could not carry a file, and no test
 * failed, because an empty array is indistinguishable from "this message has
 * no attachments". Unit tests now pin the parameter through each layer; this
 * proves the relay actually stores the blob and serves the `imeta` tag back on
 * a DM channel, which only a real relay can settle.
 *
 * It also proves the audio refusal is real rather than a client-side guess:
 * `buzz-media` rejects audio outright (`validation.rs:198-207`), so a recorder
 * would be a button that always fails. That refusal is asserted here against
 * the live endpoint.
 *
 * NOT part of `npm run test` (excluded via `*.e2e.spec.ts`). Run explicitly:
 *
 *   npx vitest run --config vitest.e2e.config.ts tests/integration/dmAttachments.e2e.spec.ts
 *
 * PRECONDITIONS — the test skips (never fails) unless all are supplied:
 *   SWF_E2E_DM_SK_A   64-hex secret key of an existing community member
 *   SWF_E2E_DM_SK_B   64-hex secret key of a second member of the SAME community
 *   SWF_E2E_DM_HOST   that community's host, e.g. `swf-xyz.localhost:3000`
 *
 * Reuses an existing community and existing members — it provisions nothing.
 * `MAX_COMMUNITIES_PER_OWNER = 5` with no teardown makes community-creating
 * specs single-use, so this one deliberately creates no global state. No
 * secret is written into this repository; keys arrive via the environment and
 * nothing here prints them.
 *
 * RATE LIMIT — space consecutive runs by at least a minute. The relay rate
 * limits media uploads per (community, pubkey) over a 60-second window
 * (`api/media.rs` `MEDIA_UPLOAD_RATE_WINDOW`), and this spec uploads on every
 * run. Back-to-back runs, or running the whole `tests/integration` directory
 * in one go, will fail the upload here with a 429. That is the relay
 * protecting itself, NOT a regression — verify in isolation before treating a
 * failure here as a defect. The refusal is deliberately not swallowed: a spec
 * that skipped on 429 could hide a genuine upload break.
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
import { mediaService } from "@/services/MediaService";
import { rejectionReasonFor } from "@/features/messages/attachments";

// Node's `dns.lookup` does not treat arbitrary `*.localhost` subdomains as
// loopback (a browser does). Test-process-only patch, scoped to `.localhost`.
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
 * `MediaService.upload` uses XMLHttpRequest — not for the request itself, but
 * because XHR is the only browser API that reports UPLOAD progress. Node has
 * no XHR. This is a test-process-only shim over `fetch`, in the same spirit as
 * the `dns.lookup` and WebSocket patches above.
 *
 * It deliberately performs the real PUT with the real headers and the real
 * body: the point of this spec is that the relay validates and stores the
 * bytes. A shim that faked the response would test nothing. Progress events
 * are not simulated — nothing here asserts on them.
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
        const res = await fetch(this.url, {
          method: this.method,
          headers: this.headers,
          body: body as BodyInit,
        });
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

/**
 * A canonical 1x1 PNG — real encoder output, metadata-free (no tEXt/iTXt/zTXt
 * chunk, which is what `validate_png_metadata_free` refuses).
 *
 * PNG rather than JPEG deliberately: a hand-built JPEG has to satisfy the
 * relay's entropy-data walk AND `imagesize::blob_size`, so getting it wrong
 * tests the fixture rather than the code. The JPEG path has its own proven
 * coverage — `stripJpegMetadata` unit tests plus the avatar upload verified
 * against this same relay. What this spec needs is a byte-exact image the
 * relay stores, so the imeta round trip is what's under test.
 */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function tinyPng(): Uint8Array {
  return Uint8Array.from(Buffer.from(TINY_PNG_BASE64, "base64"));
}

describe.runIf(HAS_ENV)("DM attachments — two real identities, real relay", () => {
  beforeAll(() => {
    setActivePinia(createPinia());
  });

  afterAll(() => {
    relayConnectionService.disconnect();
  });

  it(
    "uploads a real blob, sends it on a DM, and the receiver gets the imeta back",
    async () => {
      const signerA = new DevSigningService(hexToBytes(SK_A));
      const signerB = new DevSigningService(hexToBytes(SK_B));
      const pubkeyA = await signerA.getPublicKey();
      const pubkeyB = await signerB.getPublicKey();
      expect(pubkeyA).not.toBe(pubkeyB);

      setActiveSigningService(signerA);
      await relayConnectionService.connect(RELAY_URL);
      expect(useConnectionStore().status).toBe("connected");

      const conversationId = await dmService.openConversation([pubkeyB]);

      // ---- Real Blossom upload: the bytes must actually land -------------
      const imageBytes = tinyPng();
      const blob = new Blob([imageBytes], { type: "image/png" });
      const uploaded = await mediaService.upload(blob, { relayUrl: RELAY_URL });
      expect(uploaded.url, "relay must return a hash-addressed URL").toMatch(/^https?:\/\//);

      // ---- Media reads are permission-scoped, and that is deliberate ------
      // `/media/{sha256}` requires a Blossom GET auth event AND relay
      // membership (`api/media.rs:527-550`). This is what keeps a private
      // channel's attachments private, so assert the refusal rather than
      // treating it as an obstacle.
      const unauthenticated = await fetch(uploaded.url);
      expect(
        unauthenticated.status,
        "an unauthenticated media read must be refused",
      ).toBeGreaterThanOrEqual(400);

      // ---- With auth, the bytes really are stored and served back ---------
      // This is the path the UI takes: a browser cannot put an Authorization
      // header on `<img src>`, so attachments are fetched and turned into
      // `blob:` URLs. Pre-fix the UI pointed `<img>` straight at this URL and
      // every attachment rendered broken.
      const blobUrl = await mediaService.fetchAuthorizedBlobUrl(uploaded.url, uploaded.sha256);
      expect(blobUrl.startsWith("blob:"), "must hand the DOM a blob: URL").toBe(true);

      // ---- A sends the DM carrying that attachment ------------------------
      const body = `dm attachment ${Date.now()}`;
      const sent = await dmService.sendMessage(
        conversationId,
        body,
        [],
        [
          {
            url: uploaded.url,
            mimeType: "image/png",
            sha256: uploaded.sha256,
            size: imageBytes.length,
            filename: "tiny test.png",
          },
        ],
      );
      expect(sent.attachments, "the sent message must carry its attachment").toHaveLength(1);

      // ---- B takes over as an independent identity ------------------------
      relayConnectionService.disconnect();
      setActiveSigningService(signerB);
      await relayConnectionService.connect(RELAY_URL);
      expect(useConnectionStore().status).toBe("connected");

      // ---- The receiver parses the imeta back out of the real event -------
      const history = (await dmService.fetchHistory(conversationId)).messages;
      const delivered = history.find((m) => m.id === sent.id);
      expect(delivered, "B must receive the attachment DM").toBeTruthy();
      expect(delivered!.attachments, "imeta must survive the round trip").toHaveLength(1);

      const got = delivered!.attachments[0]!;
      expect(got.url).toBe(uploaded.url);
      expect(got.mimeType).toBe("image/png");
      expect(got.sha256).toBe(uploaded.sha256);
      expect(got.size).toBe(imageBytes.length);
      // The filename contains a space: proof the pair is split on the FIRST
      // space only, over the real wire rather than in a fixture.
      expect(got.filename).toBe("tiny test.png");

      // The markdown reference is in the content too, so a client that does
      // not parse imeta still shows something rather than a blank message.
      expect(delivered!.content).toContain(uploaded.url);
    },
    90_000,
  );

  it(
    "refuses audio before upload, and the relay refuses it too",
    async () => {
      // Client side: the picker rejects audio without attempting an upload,
      // so the user never watches a doomed progress bar.
      const audioFile = new File([new Uint8Array([0, 1, 2, 3])], "note.mp3", {
        type: "audio/mpeg",
      });
      expect(rejectionReasonFor(audioFile)).toBeTruthy();

      // Relay side: prove that refusal mirrors reality rather than being an
      // over-cautious client guess. If this ever returns 2xx, voice notes
      // stopped being protocol-limited and this test should fail loudly.
      const signerA = new DevSigningService(hexToBytes(SK_A));
      setActiveSigningService(signerA);
      await relayConnectionService.connect(RELAY_URL);

      const audioBlob = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], {
        type: "audio/mpeg",
      });
      await expect(
        mediaService.upload(audioBlob, { relayUrl: RELAY_URL }),
        "the relay must refuse audio — see validation.rs:198-207",
      ).rejects.toThrow();
    },
    60_000,
  );

  it(
    "does not crash the DM timeline on a malformed imeta tag",
    async () => {
      // A hostile or buggy peer can put anything in a tag. Parsing must
      // degrade to "no attachments", never throw and blank the conversation.
      const { parseMessageEvent } = await import("@/protocol/messages");
      const malformed = {
        id: "f".repeat(64),
        pubkey: "a".repeat(64),
        created_at: Math.floor(Date.now() / 1000),
        kind: 9,
        tags: [
          ["h", "some-channel"],
          ["imeta"], // no pairs at all
          ["imeta", "url"], // key with no value
          ["imeta", "size not-a-number", "url http://x/y.jpg", "m image/jpeg"],
        ],
        content: "still readable",
        sig: "s".repeat(128),
      };

      expect(() => parseMessageEvent(malformed)).not.toThrow();
      const parsed = parseMessageEvent(malformed);
      expect(parsed.content).toBe("still readable");
    },
    30_000,
  );
});
