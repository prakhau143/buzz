/**
 * Archived channels — including every ended OLD BUZZ huddle backing channel —
 * never list in the sidebar. The relay is authoritative: SWF never deletes or
 * archives anything to make a channel go away.
 */
import { describe, expect, it } from "vitest";
import { isSidebarChannel, sidebarChannels } from "@/features/channels/channelVisibility";
import { parseChannelEvent } from "@/protocol/channels";
import type { Channel } from "@/types/domain";
import type { RawNostrEvent } from "@/protocol/types";

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: over.id ?? "c1",
  name: over.name ?? "general",
  visibility: "open",
  channelType: "stream",
  archived: false,
  ...over,
});

/** A kind:39000 exactly as the relay sends it for OLD BUZZ's expired huddle. */
function huddleMetadataEvent(archived: boolean): RawNostrEvent {
  const tags = [
    ["d", "huddle-channel-uuid"],
    ["name", "LMD All Members huddle"],
    ["t", "stream"],
    ["ttl", "3600"],
  ];
  if (archived) tags.push(["archived", "true"]);
  return { id: "f".repeat(64), pubkey: "e".repeat(64), created_at: 1, kind: 39000, tags, content: "", sig: "s" };
}

function huddleChannel(archived: boolean): Channel {
  const parsed = parseChannelEvent(huddleMetadataEvent(archived));
  if (!parsed) throw new Error("fixture must parse");
  return parsed;
}

describe("sidebar channel visibility", () => {
  it("an archived normal channel is hidden", () => {
    expect(isSidebarChannel(channel({ archived: true }))).toBe(false);
  });

  it("an archived huddle backing channel is hidden (parsed from the relay's own 39000)", () => {
    const parsed = huddleChannel(true);
    expect(parsed.archived).toBe(true);
    expect(sidebarChannels([parsed])).toEqual([]);
  });

  it("a live archive update removes the channel: the same id arriving archived=true drops out", () => {
    const before = [channel({ id: "x" }), channel({ id: "y", name: "huddle" })];
    expect(sidebarChannels(before).map((c) => c.id)).toEqual(["x", "y"]);
    // useChannels replaces by id on a live 39000; the filter re-runs on the new list.
    const after = [before[0], channel({ id: "y", name: "huddle", archived: true })];
    expect(sidebarChannels(after).map((c) => c.id)).toEqual(["x"]);
  });

  it("a restart does not re-show it: discovery returns the relay's archived state, and it is filtered again", () => {
    const rediscovered = [huddleChannel(true)];
    expect(sidebarChannels(rediscovered)).toHaveLength(0);
  });

  it("a temporary (TTL) channel that is NOT archived stays visible, as in OLD BUZZ", () => {
    expect(sidebarChannels([huddleChannel(false)])).toHaveLength(1);
  });

  it("DMs are never sidebar channels (they have their own section)", () => {
    expect(isSidebarChannel(channel({ channelType: "dm" }))).toBe(false);
  });

  it("tolerates no data yet", () => {
    expect(sidebarChannels(undefined)).toEqual([]);
  });
});
