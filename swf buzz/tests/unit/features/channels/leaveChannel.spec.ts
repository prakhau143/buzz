/**
 * Leave channel: the event is OLD BUZZ's kind:9022 `["h", uuid]`; a relay
 * refusal surfaces the relay's actual reason (archived / sole owner / not a
 * member) instead of a generic "not accepted"; an archived channel offers no
 * Leave button (OLD BUZZ `canLeave`); and `left` is emitted only after the
 * relay accepted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { AppError } from "@/services/errors";
import type { UnsignedEvent } from "@/features/signing/types";
import type { Channel } from "@/types/domain";

// A plain stub rather than vi.fn: a vi.fn returning a rejected promise gets that
// rejection reported by vitest's result tracking even though the caller handles it.
const published: UnsignedEvent[] = [];
let publishResult: () => Promise<unknown> = async () => ({});
vi.mock("@/services/publish", () => ({
  signAndPublish: (event: UnsignedEvent) => {
    published.push(event);
    return publishResult();
  },
}));

const { channelService, leaveRefusal } = await import("@/features/channels/ChannelService");
const ChannelDetailsPanel = (await import("@/features/channels/ui/ChannelDetailsPanel.vue")).default;

/** What `RelayConnectionService.publish` throws for a relay `OK false`. */
function relayRefusal(reason: string): AppError {
  return new AppError("relay_rejected", "That action wasn't accepted by the server.", new Error(reason));
}

const CHANNEL = {
  id: "2212ef42-81fa-41e4-9dba-d6ff825ce64c",
  name: "SWF Project",
  channelType: "stream",
  visibility: "private",
  archived: false,
} as unknown as Channel;

beforeEach(() => {
  published.length = 0;
  publishResult = async () => ({});
});

describe("leaveChannel", () => {
  it("publishes exactly OLD BUZZ's leave: kind 9022, empty content, one h tag", async () => {
    await channelService.leaveChannel(CHANNEL.id);
    expect(published).toEqual([{ kind: 9022, content: "", tags: [["h", CHANNEL.id]] }]);
  });

  it.each([
    ["invalid: channel is archived", "This channel is archived, so it can't be left or changed."],
    [
      "invalid: cannot remove the last owner",
      "You can't leave this channel because you are its only owner. Transfer ownership or add another owner first.",
    ],
    ["invalid: actor is not an active member", "You're not a member of this channel anymore."],
    ["restricted: not a channel member", "You're not a member of this channel anymore."],
    ["invalid: something new", "The server refused: invalid: something new"],
  ])("relay reason %j → %j", async (reason, message) => {
    publishResult = () => Promise.reject(relayRefusal(reason));
    const thrown = await channelService.leaveChannel(CHANNEL.id).then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).message).toBe(message);
  });

  it("leaves non-relay errors (e.g. signing) untouched", () => {
    const signing = new AppError("signing_failed", "Couldn't sign that action.");
    expect(leaveRefusal(signing)).toBe(signing);
  });
});

describe("ChannelDetailsPanel — leave", () => {
  const mountPanel = (channel: Channel) =>
    mount(ChannelDetailsPanel, { props: { channel, memberCount: 7 }, global: { stubs: { CloseButton: true } } });

  it("an archived channel offers no Leave button and says why", () => {
    const wrapper = mountPanel({ ...CHANNEL, archived: true } as Channel);
    expect(wrapper.find("[data-testid=leave-channel]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=channel-archived-note]").exists()).toBe(true);
  });

  it("emits `left` only after the relay accepted", async () => {
    const wrapper = mountPanel(CHANNEL);
    await wrapper.find("[data-testid=leave-channel]").trigger("click");
    await wrapper.find(".confirm-actions button.btn--danger, .confirm-actions button:last-child").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("left")).toHaveLength(1);
  });

  it("a refusal keeps the channel, shows the relay's reason, and emits nothing", async () => {
    publishResult = () => Promise.reject(relayRefusal("invalid: cannot remove the last owner"));
    const wrapper = mountPanel(CHANNEL);
    await wrapper.find("[data-testid=leave-channel]").trigger("click");
    await wrapper.find(".confirm-actions button:last-child").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("left")).toBeUndefined();
    expect(wrapper.find(".error-text").text()).toContain("you are its only owner");
  });
});
