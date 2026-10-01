/**
 * Phase 4C Part A — NIP-RS read state (`kind:30078`) against the REAL relay.
 *
 * Closes the gap recorded in `docs/PHASE_4_RUN_STATE.md`: read state was
 * implemented and unit-proven, but nothing had ever verified that the relay
 * *accepts* a read-state event, that the wire shape is what the spec demands,
 * or that a second identity cannot read the blob. Those are exactly the
 * properties a unit test cannot establish, because they are the relay's
 * behaviour and real NIP-44 sealing, not ours.
 *
 * Deliberately reuses the EXISTING community and its existing members rather
 * than provisioning a new one: read state needs an authenticated member, not an
 * operator, and every community created by an E2E is permanent clutter on the
 * dev relay. This also keeps the run inside the relay's channel rate limits.
 *
 * Credentials come from the out-of-repo files, via env, for the test process
 * only — never printed, never written into the repository:
 *
 *   $env:SWF_E2E_MEMBER_SK = <hex secret of 2dffa5eb… (MEMBER_A)>
 *   $env:SWF_E2E_OWNER_SK  = <hex secret of 07227e7a… (OWNER_A)>
 *   npx vitest run --config vitest.e2e.config.ts tests/integration/readState.e2e.spec.ts
 *
 * Without them the whole describe skips, exactly as the other live specs do.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { hexToBytes } from "nostr-tools/utils";
import dns from "node:dns";
import { DevSigningService } from "@/features/signing/signingService.dev";
import { setActiveSigningService } from "@/features/signing/signingServiceRegistry";
import { relayConnectionService } from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { signAndPublish } from "@/services/publish";
import { fetchReadState, publishReadState } from "@/services/ReadStateService";
import {
  READ_STATE_D_TAG_PREFIX,
  READ_STATE_KIND,
  READ_STATE_T_TAG,
} from "@/protocol/readState";

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

/**
 * Minimal in-memory `localStorage`.
 *
 * `ReadStateService` persists the slot id there so an installation keeps ONE
 * addressable coordinate and replaces its own blob. Node has no localStorage,
 * and the service degrades to an ephemeral slot per call — which would silently
 * turn the "replaces its own coordinate" assertion into "publishes a second
 * coordinate". Shimming it makes the test represent the browser the app
 * actually runs in, rather than a degraded path no user is on.
 */
function installLocalStorageShim(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}

async function waitFor<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await fn();
    if (ok(last) || Date.now() > deadline) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
}

function readStateEventsOf(pubkey: string) {
  return fetchEventsOnce([
    { kinds: [READ_STATE_KIND], authors: [pubkey], "#t": [READ_STATE_T_TAG] },
  ]);
}

beforeAll(installLocalStorageShim);
beforeEach(() => {
  setActivePinia(createPinia());
  (globalThis as { localStorage: { clear(): void } }).localStorage.clear();
});

describe.skipIf(!HAS_KEYS)("Live relay — NIP-RS read state (kind:30078)", () => {
  it("relay accepts a read-state event, and the wire shape matches the spec", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK_HEX));
    const memberPubkey = await member.getPublicKey();
    setActiveSigningService(member);
    await relayConnectionService.connect(COMMUNITY_WS);

    const channelId = `11111111-2222-3333-4444-${Date.now().toString(16).padStart(12, "0")}`;
    await publishReadState(memberPubkey, { [channelId]: 1_700_000_000 });

    const events = await waitFor(
      () => readStateEventsOf(memberPubkey),
      (l) => l.length > 0,
    );
    expect(events.length).toBeGreaterThan(0);

    const event = events[0];
    expect(event.kind).toBe(READ_STATE_KIND);
    expect(event.pubkey).toBe(memberPubkey);

    // `d` tag: exactly `read-state:<32 lowercase hex>`. The spec fixes this
    // shape so a relay can recognise a read-state coordinate WITHOUT
    // decrypting; a client that invents its own shape forfeits that. This is
    // the assertion that catches drift back to the reference client's laxer
    // 1–64 ASCII slot id.
    const dTag = event.tags.find((t) => t[0] === "d")?.[1];
    expect(dTag).toMatch(
      new RegExp(`^${READ_STATE_D_TAG_PREFIX.replace(":", ":")}[0-9a-f]{32}$`),
    );

    expect(event.tags.some((t) => t[0] === "t" && t[1] === READ_STATE_T_TAG)).toBe(true);
  });

  it("content is NIP-44 sealed — the frontier is never legible on the wire", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK_HEX));
    const memberPubkey = await member.getPublicKey();
    setActiveSigningService(member);
    await relayConnectionService.connect(COMMUNITY_WS);

    const secretishChannelId = `deadbeef-cafe-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
    await publishReadState(memberPubkey, { [secretishChannelId]: 1_700_000_100 });

    const [event] = await waitFor(
      () => readStateEventsOf(memberPubkey),
      (l) => l.length > 0,
    );

    // Not JSON, and the context id does not appear anywhere in the payload.
    expect(() => JSON.parse(event.content)).toThrow();
    expect(event.content).not.toContain(secretishChannelId);
    // NIP-44 v2 payloads are base64 of `0x02 || nonce || ciphertext || mac`.
    // A leading 0x02 fixes the first base64 char to "A" and the second to the
    // range [g-v] (the low 2 bits of the version byte are the high 2 bits of
    // that sextet); asserting the whole prefix would be asserting the nonce.
    expect(event.content).toMatch(/^A[g-v][A-Za-z0-9+/]+=*$/);

    // And no key material rode along in the event.
    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain(MEMBER_SK_HEX);
    expect(serialised.toLowerCase()).not.toContain("nsec1");
  });

  it("round-trips through the relay: publish then fetch returns the frontier", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK_HEX));
    const memberPubkey = await member.getPublicKey();
    setActiveSigningService(member);
    await relayConnectionService.connect(COMMUNITY_WS);

    const channelId = `aaaaaaaa-bbbb-4ccc-8ddd-${Date.now().toString(16).padStart(12, "0")}`;
    await publishReadState(memberPubkey, { [channelId]: 1_700_000_200 });

    const fetched = await waitFor(
      () => fetchReadState(memberPubkey),
      (s) => s.contexts[channelId] === 1_700_000_200,
    );

    expect(fetched.hydrated).toBe(true);
    expect(fetched.contexts[channelId]).toBe(1_700_000_200);
  });

  /**
   * What the SERVICE guarantees, established empirically rather than assumed.
   *
   * This started as an assertion that publishing a lower value could not
   * rewind the stored frontier. The relay disagreed — and it was right:
   * `publishReadState` is a transport, NIP-33 replace semantics mean our
   * coordinate becomes whatever we hand it. The grow-only guarantee therefore
   * cannot live here, and asserting it here was testing the wrong layer.
   *
   * That finding was not cosmetic: the store *was* handing over rewinds, via
   * `markUnreadFrom` writing into the same map `publishFrontier` published.
   * Fixed in `stores/readState.ts` (`publishedFrontier`), pinned in
   * `tests/unit/stores/readStatePublishFrontier.spec.ts`. This test now records
   * the service's real contract so nobody re-derives the wrong expectation.
   */
  it("publish replaces our own coordinate (addressable semantics), downward included", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK_HEX));
    const memberPubkey = await member.getPublicKey();
    setActiveSigningService(member);
    await relayConnectionService.connect(COMMUNITY_WS);

    const channelId = `cccccccc-dddd-4eee-8fff-${Date.now().toString(16).padStart(12, "0")}`;

    await publishReadState(memberPubkey, { [channelId]: 1_700_000_500 });
    await waitFor(
      () => fetchReadState(memberPubkey),
      (s) => s.contexts[channelId] === 1_700_000_500,
    );

    // Hand the service a lower value for the same coordinate.
    await publishReadState(memberPubkey, { [channelId]: 1_600_000_000 });
    await new Promise((r) => setTimeout(r, 1_000));

    // The relay replaced the addressable event: the coordinate now holds the
    // lower value. This is why the caller must never hand over a rewind.
    const after = await fetchReadState(memberPubkey);
    expect(after.contexts[channelId]).toBe(1_600_000_000);
  });

  it("merge across coordinates is grow-only — a peer device's higher mark wins", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK_HEX));
    const memberPubkey = await member.getPublicKey();
    setActiveSigningService(member);
    await relayConnectionService.connect(COMMUNITY_WS);

    const channelId = `99999999-8888-4777-8666-${Date.now().toString(16).padStart(12, "0")}`;

    // This device's coordinate.
    await publishReadState(memberPubkey, { [channelId]: 1_700_000_500 });
    await waitFor(
      () => fetchReadState(memberPubkey),
      (s) => s.contexts[channelId] === 1_700_000_500,
    );

    // A second "device": same identity, different slot id. Clearing the shim
    // makes `getSlotId` mint a new coordinate, which is exactly what a second
    // installation does.
    (globalThis as { localStorage: { clear(): void } }).localStorage.clear();
    await publishReadState(memberPubkey, { [channelId]: 1_700_009_000 });

    // fetchReadState merges every coordinate this identity owns, taking the
    // max — so the lower device does not drag the frontier back.
    const merged = await waitFor(
      () => fetchReadState(memberPubkey),
      (s) => s.contexts[channelId] === 1_700_009_000,
    );
    expect(merged.contexts[channelId]).toBe(1_700_009_000);
  });

  it("a second identity cannot read this identity's frontier", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK_HEX));
    const memberPubkey = await member.getPublicKey();
    setActiveSigningService(member);
    await relayConnectionService.connect(COMMUNITY_WS);

    const privateChannelId = `eeeeeeee-ffff-4000-8111-${Date.now().toString(16).padStart(12, "0")}`;
    await publishReadState(memberPubkey, { [privateChannelId]: 1_700_000_700 });
    await waitFor(
      () => fetchReadState(memberPubkey),
      (s) => s.contexts[privateChannelId] === 1_700_000_700,
    );

    // Switch to the other identity entirely.
    const owner = new DevSigningService(hexToBytes(OWNER_SK_HEX));
    const ownerPubkey = await owner.getPublicKey();
    expect(ownerPubkey).not.toBe(memberPubkey);
    setActiveSigningService(owner);
    (globalThis as { localStorage: { clear(): void } }).localStorage.clear();

    const ownerView = await fetchReadState(ownerPubkey);
    expect(ownerView.contexts[privateChannelId]).toBeUndefined();

    // Even handed the other identity's raw events, decryption must fail and be
    // skipped rather than throw — the blob is sealed to the member's key.
    const memberEvents = await readStateEventsOf(memberPubkey);
    expect(memberEvents.length).toBeGreaterThan(0);
    for (const ev of memberEvents) {
      await expect(owner.nip44Decrypt(memberPubkey, ev.content)).rejects.toBeTruthy();
    }
  });

  it("a malformed kind:30078 from the same author is ignored, not fatal", async () => {
    const member = new DevSigningService(hexToBytes(MEMBER_SK_HEX));
    const memberPubkey = await member.getPublicKey();
    setActiveSigningService(member);
    await relayConnectionService.connect(COMMUNITY_WS);

    const goodChannelId = `12121212-3434-4565-8787-${Date.now().toString(16).padStart(12, "0")}`;
    await publishReadState(memberPubkey, { [goodChannelId]: 1_700_000_900 });
    await waitFor(
      () => fetchReadState(memberPubkey),
      (s) => s.contexts[goodChannelId] === 1_700_000_900,
    );

    // kind:30078 is shared with NIP-78 application data, so a foreign or
    // malformed event under this kind is EXPECTED, not exceptional. Publish
    // one carrying the right `t` tag but unparseable content, and confirm the
    // real frontier still hydrates.
    await signAndPublish({
      kind: READ_STATE_KIND,
      content: "this is not nip-44 ciphertext",
      tags: [
        ["d", `${READ_STATE_D_TAG_PREFIX}${"f".repeat(32)}`],
        ["t", READ_STATE_T_TAG],
      ],
    });

    await new Promise((r) => setTimeout(r, 1_000));

    const after = await fetchReadState(memberPubkey);
    expect(after.hydrated).toBe(true);
    expect(after.contexts[goodChannelId]).toBe(1_700_000_900);
  });
});
