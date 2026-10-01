/**
 * Phase G — pinned-message rules (features/pins/pinModel.ts). These are the
 * rules EVERY reader applies to the relay's kind:40004 stream, so they are the
 * authorization boundary: an event that fails them is ignored by all clients.
 */
import { describe, expect, it } from "vitest";
import {
  canPinMessage,
  canPinNow,
  canUnpin,
  resolveActivePin,
  type ActivePin,
  type PinContext,
} from "@/features/pins/pinModel";
import type { PinEvent } from "@/protocol/pins";
import type { MemberRole } from "@/protocol/membership";

const OWNER = "0".repeat(63) + "1";
const ADMIN = "0".repeat(63) + "2";
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const OUTSIDER = "c".repeat(64);
const CH = "channel-1";

const ROLES: Record<string, MemberRole> = { [OWNER]: "owner", [ADMIN]: "admin", [ALICE]: "member", [BOB]: "member" };
// Message id → author.
const AUTHORS: Record<string, string> = {
  "m-alice": ALICE,
  "m-bob": BOB,
  "m-admin": ADMIN,
  "m-owner": OWNER,
};

function ctx(overrides: Partial<PinContext> = {}): PinContext {
  return {
    kind: "channel",
    roleOf: (pk) => ROLES[pk] ?? null,
    authorOf: (id) => AUTHORS[id],
    ...overrides,
  };
}

let serial = 0;
function ev(
  actor: string,
  messageId: string,
  createdAt: number,
  action: "pin" | "unpin" = "pin",
  extra: Partial<PinEvent> = {},
): PinEvent {
  serial += 1;
  return {
    id: extra.id ?? `ev-${String(serial).padStart(4, "0")}`,
    conversationId: CH,
    messageId,
    action,
    actorPubkey: actor,
    claimedAuthor: action === "pin" ? (AUTHORS[messageId] ?? null) : null,
    createdAt,
    ...extra,
  };
}

const pinned = (events: PinEvent[], c = ctx()) => resolveActivePin(events, c);

describe("permissions (channel)", () => {
  it("1. a member can pin their own message", () => {
    expect(canPinMessage("channel", ALICE, "member", ALICE)).toBe(true);
    expect(pinned([ev(ALICE, "m-alice", 10)])?.messageId).toBe("m-alice");
  });

  it("2. a member cannot pin another member's message", () => {
    expect(canPinMessage("channel", ALICE, "member", BOB)).toBe(false);
    expect(pinned([ev(ALICE, "m-bob", 10)])).toBeNull();
  });

  it("3. an admin can pin a member's message", () => {
    expect(pinned([ev(ADMIN, "m-bob", 10)])?.pinnedBy).toBe(ADMIN);
  });

  it("4. an owner can pin a member's message", () => {
    expect(pinned([ev(OWNER, "m-alice", 10)])?.pinnedBy).toBe(OWNER);
  });

  it("5. an admin can pin another admin's (or the owner's) message", () => {
    expect(pinned([ev(ADMIN, "m-owner", 10)])?.messageId).toBe("m-owner");
  });

  it("6. an owner can pin their own message", () => {
    expect(pinned([ev(OWNER, "m-owner", 10)])?.messageId).toBe("m-owner");
  });

  it("a non-member can neither pin nor unpin", () => {
    expect(canPinMessage("channel", OUTSIDER, null, OUTSIDER)).toBe(false);
    expect(pinned([ev(OUTSIDER, "m-alice", 10, "pin", { claimedAuthor: OUTSIDER })])).toBeNull();
  });

  it("7. a member can unpin their own pin", () => {
    expect(pinned([ev(ALICE, "m-alice", 10), ev(ALICE, "m-alice", 11, "unpin")])).toBeNull();
  });

  it("8. a member cannot unpin somebody else's pin", () => {
    const active = pinned([ev(ADMIN, "m-alice", 10), ev(ALICE, "m-alice", 11, "unpin")]);
    expect(active?.pinnedBy).toBe(ADMIN);
    expect(pinned([ev(BOB, "m-bob", 10), ev(ALICE, "m-bob", 11, "unpin")])?.pinnedBy).toBe(BOB);
  });

  it("9. an admin can unpin any pin", () => {
    expect(pinned([ev(BOB, "m-bob", 10), ev(ADMIN, "m-bob", 11, "unpin")])).toBeNull();
    expect(pinned([ev(OWNER, "m-owner", 10), ev(ADMIN, "m-owner", 11, "unpin")])).toBeNull();
  });

  it("10. an owner can unpin any pin", () => {
    expect(pinned([ev(ADMIN, "m-admin", 10), ev(OWNER, "m-admin", 11, "unpin")])).toBeNull();
  });
});

describe("one active pin", () => {
  it("11. a newer authorized pin replaces the current one", () => {
    const active = pinned([ev(ALICE, "m-alice", 10), ev(ADMIN, "m-bob", 20)]);
    expect(active?.messageId).toBe("m-bob");
  });

  it("12. there is only ever one active pin, whatever the history", () => {
    const active = pinned([ev(OWNER, "m-alice", 1), ev(OWNER, "m-bob", 2), ev(OWNER, "m-admin", 3)]);
    expect(active?.messageId).toBe("m-admin");
  });

  it("a member cannot replace somebody else's pin with their own", () => {
    const active = pinned([ev(BOB, "m-bob", 10), ev(ALICE, "m-alice", 20)]);
    expect(active?.messageId).toBe("m-bob");
    expect(canPinNow("channel", ALICE, "member", ALICE, active)).toBe(false);
  });

  it("a member can replace their OWN pin", () => {
    const active = pinned([ev(ALICE, "m-alice", 10)]);
    expect(canPinNow("channel", ALICE, "member", ALICE, active)).toBe(true);
  });

  it("13. duplicate deliveries of the same event count once", () => {
    const pin = ev(ALICE, "m-alice", 10);
    const unpin = ev(ALICE, "m-alice", 11, "unpin");
    expect(pinned([pin, unpin, pin, unpin, pin])).toBeNull();
  });

  it("14. a stale unpin (for a message no longer pinned) is ignored", () => {
    const active = pinned([ev(ADMIN, "m-alice", 10), ev(ADMIN, "m-bob", 20), ev(ADMIN, "m-alice", 30, "unpin")]);
    expect(active?.messageId).toBe("m-bob");
  });

  it("15. arrival order does not matter (reconnect replays, out-of-order history)", () => {
    const events = [ev(ADMIN, "m-alice", 10), ev(OWNER, "m-bob", 20), ev(ADMIN, "m-bob", 30, "unpin"), ev(ALICE, "m-alice", 40)];
    const forward = pinned(events);
    const backward = pinned([...events].reverse());
    const shuffled = pinned([events[2], events[0], events[3], events[1]]);
    expect(forward?.messageId).toBe("m-alice");
    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it("same-second events resolve by event id, identically for every client", () => {
    const a = ev(ADMIN, "m-alice", 50, "pin", { id: "aaa" });
    const b = ev(ADMIN, "m-bob", 50, "pin", { id: "bbb" });
    expect(pinned([a, b])?.messageId).toBe("m-bob");
    expect(pinned([b, a])?.messageId).toBe("m-bob");
  });
});

describe("authorship claims and unavailable messages", () => {
  it("a member's false author claim is rejected once the message is known", () => {
    const forged = ev(ALICE, "m-bob", 10, "pin", { claimedAuthor: ALICE });
    expect(pinned([forged])).toBeNull();
  });

  it("16/17. a pin of a message that is not loaded stands on its claim (shown as unavailable later)", () => {
    const pin = ev(ALICE, "m-gone", 10, "pin", { claimedAuthor: ALICE });
    const active = pinned([pin], ctx({ authorOf: () => undefined }));
    expect(active?.messageId).toBe("m-gone");
    expect(active?.messageAuthor).toBe(ALICE);
  });

  it("a member's pin with no author claim and an unknown message is not trusted", () => {
    const pin = ev(ALICE, "m-gone", 10, "pin", { claimedAuthor: null });
    expect(pinned([pin], ctx({ authorOf: () => undefined }))).toBeNull();
  });

  it("an admin may pin even when the message cannot be loaded", () => {
    const pin = ev(ADMIN, "m-gone", 10, "pin", { claimedAuthor: null });
    expect(pinned([pin], ctx({ authorOf: () => undefined }))?.messageId).toBe("m-gone");
  });
});

describe("DMs", () => {
  const dm = ctx({ kind: "dm", roleOf: () => null });

  it("either participant may pin any message and unpin any pin", () => {
    expect(pinned([ev(ALICE, "m-bob", 10)], dm)?.messageId).toBe("m-bob");
    expect(pinned([ev(ALICE, "m-bob", 10), ev(BOB, "m-bob", 11, "unpin")], dm)).toBeNull();
    const active: ActivePin = { eventId: "x", messageId: "m-bob", pinnedBy: BOB, pinnedAt: 1, messageAuthor: BOB };
    expect(canUnpin("dm", ALICE, null, active)).toBe(true);
  });
});
