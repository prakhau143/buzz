import { describe, expect, it } from "vitest";
import {
  buildReadStateBlob,
  buildReadStateTags,
  channelContextKey,
  escapeContextId,
  generateSlotId,
  isMsgContextKey,
  isThreadContextKey,
  isValidReadStateDTag,
  isWellFormedReadStateEvent,
  MAX_CONTEXTS,
  mergeContexts,
  msgContextKey,
  parseReadStateBlob,
  READ_STATE_KIND,
  threadContextKey,
  unescapeContextId,
} from "@/protocol/readState";

const HEX64 = "a".repeat(64);

/**
 * These assert the rules stated in `../buzz/docs/nips/NIP-RS.md`, not our
 * implementation's current behaviour. Where the spec says MUST, the test says
 * MUST — so a "simplification" that breaks interoperability with OLD BUZZ's
 * own clients fails here rather than silently in the field.
 */
describe("NIP-RS read state — wire format", () => {
  it("uses kind 30078", () => {
    expect(READ_STATE_KIND).toBe(30078);
  });

  it("generates a slot id of exactly 32 lowercase hex characters", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateSlotId()).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("generates distinct slot ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateSlotId()));
    expect(ids.size).toBe(50);
  });

  it("accepts only a 32-hex slot id in the d tag", () => {
    expect(isValidReadStateDTag(`read-state:${"0".repeat(32)}`)).toBe(true);
    // The desktop client is looser here (1-64 ASCII); the spec is not.
    expect(isValidReadStateDTag("read-state:short")).toBe(false);
    expect(isValidReadStateDTag(`read-state:${"0".repeat(31)}`)).toBe(false);
    expect(isValidReadStateDTag(`read-state:${"0".repeat(33)}`)).toBe(false);
    expect(isValidReadStateDTag(`read-state:${"A".repeat(32)}`)).toBe(false);
    expect(isValidReadStateDTag("something-else")).toBe(false);
    expect(isValidReadStateDTag(undefined)).toBe(false);
  });

  it("emits exactly one d tag and one t tag", () => {
    const tags = buildReadStateTags(generateSlotId());
    expect(tags.filter((t) => t[0] === "d")).toHaveLength(1);
    expect(tags.filter((t) => t[0] === "t" && t[1] === "read-state")).toHaveLength(1);
  });

  it("rejects events with zero, duplicate or malformed d tags", () => {
    const slot = generateSlotId();
    expect(isWellFormedReadStateEvent(buildReadStateTags(slot))).toBe(true);

    expect(isWellFormedReadStateEvent([["t", "read-state"]])).toBe(false);
    expect(
      isWellFormedReadStateEvent([
        ["d", `read-state:${slot}`],
        ["d", `read-state:${generateSlotId()}`],
        ["t", "read-state"],
      ]),
    ).toBe(false);
    expect(
      isWellFormedReadStateEvent([
        ["d", "read-state:not-hex"],
        ["t", "read-state"],
      ]),
    ).toBe(false);
  });

  it("rejects events without exactly one read-state t tag", () => {
    const slot = generateSlotId();
    expect(isWellFormedReadStateEvent([["d", `read-state:${slot}`]])).toBe(false);
    expect(
      isWellFormedReadStateEvent([
        ["d", `read-state:${slot}`],
        ["t", "read-state"],
        ["t", "read-state"],
      ]),
    ).toBe(false);
  });
});

describe("NIP-RS read state — context identifiers", () => {
  it("uses the Buzz shapes named by the spec", () => {
    expect(channelContextKey("uuid-1")).toBe("uuid-1");
    expect(threadContextKey(HEX64)).toBe(`thread:${HEX64}`);
    expect(msgContextKey(HEX64)).toBe(`msg:${HEX64}`);
  });

  it("recognises well-known scheme keys only with a 64-hex event id", () => {
    expect(isThreadContextKey(`thread:${HEX64}`)).toBe(true);
    expect(isMsgContextKey(`msg:${HEX64}`)).toBe(true);
    expect(isThreadContextKey("thread:nope")).toBe(false);
    expect(isMsgContextKey("msg:")).toBe(false);
    // A bare channel UUID is neither.
    expect(isThreadContextKey("uuid-1")).toBe(false);
    expect(isMsgContextKey("uuid-1")).toBe(false);
  });

  it("escapes reserved prefixes, and escape/unescape is the identity", () => {
    expect(escapeContextId("ov_s:evil")).toBe("esc:ov_s:evil");
    expect(escapeContextId("esc:foo")).toBe("esc:esc:foo");
    expect(escapeContextId("uuid-1")).toBe("uuid-1");

    for (const raw of ["ov_s:evil", "esc:foo", "uuid-1", `thread:${HEX64}`]) {
      expect(unescapeContextId(escapeContextId(raw))).toBe(raw);
    }
  });

  it("strips at most one esc: prefix per receive", () => {
    // Two levels on the wire must decode to one level, not zero.
    expect(unescapeContextId("esc:esc:foo")).toBe("esc:foo");
  });
});

describe("NIP-RS read state — blob validation", () => {
  const valid = { v: 1, client_id: "client-a", contexts: { "uuid-1": 1_700_000_000 } };

  it("accepts a well-formed blob", () => {
    expect(parseReadStateBlob(valid)?.contexts).toEqual({ "uuid-1": 1_700_000_000 });
  });

  it("discards blobs that are not objects", () => {
    for (const bad of [null, undefined, 42, "str", []]) {
      expect(parseReadStateBlob(bad)).toBeNull();
    }
  });

  it("discards a missing, non-integer or unknown schema version", () => {
    expect(parseReadStateBlob({ ...valid, v: undefined })).toBeNull();
    expect(parseReadStateBlob({ ...valid, v: "1" })).toBeNull();
    expect(parseReadStateBlob({ ...valid, v: 1.5 })).toBeNull();
    expect(parseReadStateBlob({ ...valid, v: 2 })).toBeNull();
  });

  it("discards a missing or out-of-range client_id", () => {
    expect(parseReadStateBlob({ ...valid, client_id: undefined })).toBeNull();
    expect(parseReadStateBlob({ ...valid, client_id: "" })).toBeNull();
    expect(parseReadStateBlob({ ...valid, client_id: 5 })).toBeNull();
    expect(parseReadStateBlob({ ...valid, client_id: "x".repeat(65) })).toBeNull();
    expect(parseReadStateBlob({ ...valid, client_id: "x".repeat(64) })).not.toBeNull();
  });

  it("discards a missing or non-object contexts field", () => {
    expect(parseReadStateBlob({ ...valid, contexts: undefined })).toBeNull();
    expect(parseReadStateBlob({ ...valid, contexts: [] })).toBeNull();
    expect(parseReadStateBlob({ ...valid, contexts: "x" })).toBeNull();
  });

  it("rejects a blob exceeding the context cap", () => {
    const contexts: Record<string, number> = {};
    for (let i = 0; i <= MAX_CONTEXTS; i += 1) contexts[`c${i}`] = 1;
    expect(parseReadStateBlob({ ...valid, contexts })).toBeNull();
  });

  it("drops only the bad entries, keeping the rest of the blob", () => {
    const parsed = parseReadStateBlob({
      ...valid,
      contexts: {
        good: 1_700_000_000,
        notInteger: 1.5,
        negative: -1,
        tooBig: 4_294_967_296,
        notNumber: "1700000000",
        [`${"k".repeat(257)}`]: 1,
      },
    });
    // The spec is explicit that a bad entry is dropped rather than discarding
    // the blob — one malformed context must not cost the user their frontier.
    expect(parsed?.contexts).toEqual({ good: 1_700_000_000 });
  });

  it("accepts the uint32 boundaries exactly", () => {
    const parsed = parseReadStateBlob({
      ...valid,
      contexts: { lo: 0, hi: 4_294_967_295 },
    });
    expect(parsed?.contexts).toEqual({ lo: 0, hi: 4_294_967_295 });
  });

  it("drops override-counter groups rather than interpreting them", () => {
    const parsed = parseReadStateBlob({
      ...valid,
      contexts: {
        "uuid-1": 1_700_000_000,
        "ov_s:uuid-1": 5,
        "ov_c:uuid-1": 6,
        "ov_b:uuid-1": 7,
      },
    });
    // We do not implement the override layer; the frontier entry must survive.
    expect(parsed?.contexts).toEqual({ "uuid-1": 1_700_000_000 });
  });

  it("unescapes wire keys back to raw context ids", () => {
    const parsed = parseReadStateBlob({
      ...valid,
      contexts: { "esc:ov_s:evil": 10 },
    });
    expect(parsed?.contexts).toEqual({ "ov_s:evil": 10 });
  });
});

describe("NIP-RS read state — merge rule", () => {
  it("keeps the newest marker per context", () => {
    const merged = mergeContexts({ a: 100, b: 50 }, { a: 90, b: 70, c: 10 });
    expect(merged).toEqual({ a: 100, b: 70, c: 10 });
  });

  it("is grow-only — a lower incoming value never rewinds the frontier", () => {
    // This is why manual "mark unread" cannot be expressed in the frontier
    // alone; the spec adds the ov_* layer for it. Pinned so nobody "fixes"
    // merge into last-write-wins and silently breaks convergence.
    expect(mergeContexts({ a: 100 }, { a: 1 })).toEqual({ a: 100 });
  });

  it("does not mutate its input", () => {
    const into = { a: 1 };
    mergeContexts(into, { a: 99 });
    expect(into).toEqual({ a: 1 });
  });

  it("is commutative across devices", () => {
    const a = { chan: 100, other: 5 };
    const b = { chan: 80, other: 9 };
    expect(mergeContexts(a, b)).toEqual(mergeContexts(b, a));
  });
});

describe("NIP-RS read state — blob building", () => {
  it("round-trips through parse", () => {
    const blob = buildReadStateBlob("client-a", { "uuid-1": 1_700_000_000 });
    expect(parseReadStateBlob(blob)?.contexts).toEqual({ "uuid-1": 1_700_000_000 });
  });

  it("escapes reserved keys on publish so a peer can decode them", () => {
    const blob = buildReadStateBlob("client-a", { "ov_s:evil": 10 });
    expect(Object.keys(blob.contexts)).toEqual(["esc:ov_s:evil"]);
    expect(parseReadStateBlob(blob)?.contexts).toEqual({ "ov_s:evil": 10 });
  });

  it("omits entries that could not be represented", () => {
    const blob = buildReadStateBlob("client-a", {
      good: 1,
      bad: Number.NaN,
      huge: 4_294_967_296,
      ["k".repeat(257)]: 1,
    });
    expect(blob.contexts).toEqual({ good: 1 });
  });
});
