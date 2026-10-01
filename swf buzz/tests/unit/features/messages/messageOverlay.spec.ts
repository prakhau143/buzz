import { describe, expect, it } from "vitest";
import {
  applyDelete,
  applyEdit,
  emptyOverlays,
  renderTimeline,
} from "@/features/messages/messageOverlay";
import type { Message } from "@/types/domain";

function message(overrides: Partial<Message> & { id: string }): Message {
  return {
    channelId: "ch",
    authorPubkey: "author",
    content: "original",
    createdAt: 100,
    thread: {},
    mentions: [],
    reactions: [],
    status: "sent",
    isSystemMessage: false,
    isAgentMessage: false,
    ...overrides,
  };
}

describe("message edit overlay", () => {
  it("applies an authorized edit without mutating the base message", () => {
    const base = [message({ id: "m1" })];
    const overlays = applyEdit(emptyOverlays(), {
      eventId: "e1",
      targetId: "m1",
      authorPubkey: "author",
      content: "edited",
      createdAt: 200,
    });

    const rendered = renderTimeline(base, overlays);

    expect(rendered[0].content).toBe("edited");
    expect(rendered[0].editedAt).toBe(200);
    // The retained event is untouched — re-rendering must be repeatable.
    expect(base[0].content).toBe("original");
  });

  it("keeps the NEWEST edit when an older one arrives afterwards", () => {
    const overlays = emptyOverlays();
    applyEdit(overlays, {
      eventId: "e2",
      targetId: "m1",
      authorPubkey: "author",
      content: "newer",
      createdAt: 300,
    });
    // Out-of-order delivery: routine on a reconnect backfill.
    applyEdit(overlays, {
      eventId: "e1",
      targetId: "m1",
      authorPubkey: "author",
      content: "older",
      createdAt: 200,
    });

    expect(renderTimeline([message({ id: "m1" })], overlays)[0].content).toBe("newer");
  });

  it("breaks same-second edit ties deterministically by event id", () => {
    const a = emptyOverlays();
    applyEdit(a, { eventId: "aaa", targetId: "m1", authorPubkey: "author", content: "A", createdAt: 300 });
    applyEdit(a, { eventId: "bbb", targetId: "m1", authorPubkey: "author", content: "B", createdAt: 300 });

    // Same two edits, opposite arrival order — must converge on the same winner,
    // otherwise two clients render different text for the same message.
    const b = emptyOverlays();
    applyEdit(b, { eventId: "bbb", targetId: "m1", authorPubkey: "author", content: "B", createdAt: 300 });
    applyEdit(b, { eventId: "aaa", targetId: "m1", authorPubkey: "author", content: "A", createdAt: 300 });

    const base = [message({ id: "m1" })];
    expect(renderTimeline(base, a)[0].content).toBe(renderTimeline(base, b)[0].content);
    expect(renderTimeline(base, a)[0].content).toBe("B");
  });

  it("ignores an edit whose author is not the message author", () => {
    const overlays = applyEdit(emptyOverlays(), {
      eventId: "e1",
      targetId: "m1",
      authorPubkey: "someone-else",
      content: "forged",
      createdAt: 200,
    });

    const rendered = renderTimeline([message({ id: "m1" })], overlays);

    expect(rendered[0].content).toBe("original");
    expect(rendered[0].editedAt).toBeUndefined();
  });

  it("retains an edit that arrives before its target message", () => {
    const overlays = applyEdit(emptyOverlays(), {
      eventId: "e1",
      targetId: "m1",
      authorPubkey: "author",
      content: "edited",
      createdAt: 200,
    });

    // Target absent — nothing to render yet, and the overlay must survive.
    expect(renderTimeline([], overlays)).toEqual([]);
    expect(renderTimeline([message({ id: "m1" })], overlays)[0].content).toBe("edited");
  });
});

describe("message delete overlay", () => {
  it("removes a self-deleted message", () => {
    const overlays = applyDelete(emptyOverlays(), {
      targetId: "m1",
      authorPubkey: "author",
      isAdminDelete: false,
    });

    expect(renderTimeline([message({ id: "m1" })], overlays)).toEqual([]);
  });

  it("ignores a kind:5 retraction from someone who is not the author", () => {
    // kind:5 is gated on authorship by the relay, so this should never arrive.
    // Honouring it anyway would be a client-side deletion forgery.
    const overlays = applyDelete(emptyOverlays(), {
      targetId: "m1",
      authorPubkey: "someone-else",
      isAdminDelete: false,
    });

    expect(renderTimeline([message({ id: "m1" })], overlays)).toHaveLength(1);
  });

  it("honours an admin delete (kind:9005) from a non-author", () => {
    const overlays = applyDelete(emptyOverlays(), {
      targetId: "m1",
      authorPubkey: "an-admin",
      isAdminDelete: true,
    });

    expect(renderTimeline([message({ id: "m1" })], overlays)).toEqual([]);
  });

  it("is idempotent when the same delete is delivered twice", () => {
    const overlays = emptyOverlays();
    const del = { targetId: "m1", authorPubkey: "author", isAdminDelete: false };
    applyDelete(overlays, del);
    applyDelete(overlays, del);

    expect(overlays.deletes.size).toBe(1);
    expect(renderTimeline([message({ id: "m1" })], overlays)).toEqual([]);
  });

  it("a delete beats a later edit of the same message", () => {
    const overlays = emptyOverlays();
    applyDelete(overlays, { targetId: "m1", authorPubkey: "author", isAdminDelete: true });
    applyEdit(overlays, {
      eventId: "e1",
      targetId: "m1",
      authorPubkey: "author",
      content: "edited after deletion",
      createdAt: 999,
    });

    expect(renderTimeline([message({ id: "m1" })], overlays)).toEqual([]);
  });

  it("leaves other messages untouched", () => {
    const overlays = applyDelete(emptyOverlays(), {
      targetId: "m1",
      authorPubkey: "author",
      isAdminDelete: false,
    });

    const rendered = renderTimeline([message({ id: "m1" }), message({ id: "m2" })], overlays);

    expect(rendered.map((m) => m.id)).toEqual(["m2"]);
  });
});
