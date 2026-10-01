/**
 * Phase L regression — reactions (kind:7) vanished from the app because
 * nostr-tools re-applies `#h` against LITERAL tags and the relay serves `#h`
 * for kind:7/kind:5 from its derived channel. The client-side rule below must
 * mirror the relay's (`buzz-core::filter::filter_match_one`): leniency for the
 * `#h` clause ONLY when the event carries no `h` tag at all, everything else
 * still enforced. Live counterpart: tests/integration/reactions.e2e.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { matchesAllowingVirtualChannelTag } from "@/services/RelayConnectionService";
import type { RawNostrEvent } from "@/protocol/types";

const sk = generateSecretKey();
const CH = "c164c4ee-9a44-4430-9458-5a4f566a5cd9";
const OTHER_CH = "8bf93c3f-8ca2-4097-8510-df95ad5bc811";
const TARGET = "3c".repeat(32);

function signed(kind: number, tags: string[][], created_at = 1_700_000_000): RawNostrEvent {
  return finalizeEvent({ kind, content: "👍", tags, created_at }, sk) as unknown as RawNostrEvent;
}

describe("matchesAllowingVirtualChannelTag", () => {
  it("delivers a kind:7 (no h tag) under a #h filter — the relay scoped it, the client must not re-reject it", () => {
    const reaction = signed(7, [["e", TARGET]]);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [7], "#h": [CH] }], reaction)).toBe(true);
  });

  it("still enforces every other clause on such an event: kinds, since/until, #e, authors", () => {
    const reaction = signed(7, [["e", TARGET]]);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [9], "#h": [CH] }], reaction)).toBe(false);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [7], "#h": [CH], since: 1_700_000_001 }], reaction)).toBe(false);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [7], "#h": [CH], until: 1_699_999_999 }], reaction)).toBe(false);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [7], "#h": [CH], "#e": ["ab".repeat(32)] }], reaction)).toBe(false);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [7], "#h": [CH], "#e": [TARGET] }], reaction)).toBe(true);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [7], "#h": [CH], authors: ["cd".repeat(32)] }], reaction)).toBe(false);
  });

  it("gives NO leniency to an event that carries an h tag which does not match (kind:9 in another channel)", () => {
    const message = signed(9, [["h", OTHER_CH]]);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [9], "#h": [CH] }], message)).toBe(false);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [9], "#h": [OTHER_CH] }], message)).toBe(true);
  });

  it("is a no-op for filters without #h: an h-less event must match on its own merits", () => {
    const reaction = signed(7, [["e", TARGET]]);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [7] }], reaction)).toBe(true);
    expect(matchesAllowingVirtualChannelTag([{ kinds: [9] }], reaction)).toBe(false);
  });

  it("honours NIP-01 OR across filters: any one lenient filter matching is enough", () => {
    const reaction = signed(7, [["e", TARGET]]);
    expect(
      matchesAllowingVirtualChannelTag([{ kinds: [9], "#h": [CH] }, { kinds: [7], "#h": [CH] }], reaction),
    ).toBe(true);
  });
});
