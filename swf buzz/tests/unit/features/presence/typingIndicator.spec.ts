/**
 * Phase 4F — typing indicator lifecycle.
 *
 * The contract for this phase is "no listener leaks, no endless timers", and
 * the leak that existed was not merely wasteful: `resubscribe` cleared the
 * visible list on a channel switch but left the previous channel's expiry
 * timers armed. Each one fires up to TYPING_EXPIRY_MS later and filters its
 * pubkey out of whatever list is current by then — so a person genuinely
 * typing in the newly-opened channel could have their indicator cleared by a
 * timer belonging to a channel the user had already left. The `expiry` Map also
 * grew across every switch.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { ParsedTypingEvent } from "@/protocol/typing";

const close = vi.fn();
const subscribe = vi.fn();
const notify = vi.fn().mockResolvedValue(undefined);

vi.mock("@/features/presence/TypingService", () => ({
  typingService: {
    subscribe: (...args: unknown[]) => subscribe(...args),
    notify: (...args: unknown[]) => notify(...args),
  },
}));

const { useTypingIndicator } = await import("@/features/presence/useTypingIndicator");

/** Mounts the composable so onUnmounted/watch behave as they do in a real view. */
function mountWith(channelId: ReturnType<typeof ref<string | null>>) {
  let api!: ReturnType<typeof useTypingIndicator>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useTypingIndicator(channelId);
        return () => h("div");
      },
    }),
  );
  return { wrapper, api: () => api };
}

function emitTyping(pubkey: string): void {
  const handler = subscribe.mock.calls.at(-1)![1] as (e: ParsedTypingEvent) => void;
  handler({ pubkey, channelId: "c1" } as ParsedTypingEvent);
}

describe("useTypingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    vi.clearAllMocks();
    subscribe.mockReturnValue({ close });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("disarms the previous channel's expiry timers on a switch", async () => {
    const channelId = ref<string | null>("c1");
    const { api } = mountWith(channelId);

    // Three people typing in c1 => three armed expiry timers.
    emitTyping("a".repeat(64));
    emitTyping("b".repeat(64));
    emitTyping("e".repeat(64));
    expect(api().typingPubkeys.value).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(3);

    channelId.value = "c2";
    await Promise.resolve();

    // The visible list is cleared either way; what regressed is the timers
    // behind it, which stayed armed for the full expiry window while holding
    // their Map entries alive. Asserting on `typingPubkeys` here would pass
    // with or without the fix — this is the assertion that actually fails
    // without it.
    expect(api().typingPubkeys.value).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires a typist on its own channel after the expiry window", () => {
    const channelId = ref<string | null>("c1");
    const { api } = mountWith(channelId);

    const typist = "c".repeat(64);
    emitTyping(typist);
    expect(api().typingPubkeys.value).toContain(typist);

    vi.advanceTimersByTime(6000);
    expect(api().typingPubkeys.value).not.toContain(typist);
  });

  it("closes the subscription and arms no timers after unmount", () => {
    const channelId = ref<string | null>("c1");
    const { wrapper } = mountWith(channelId);

    emitTyping("d".repeat(64));
    wrapper.unmount();

    expect(close).toHaveBeenCalled();
    // Nothing left to fire: if a timer survived, this would throw on the
    // unmounted component's reactive state.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("throttles outgoing typing notifications", () => {
    const channelId = ref<string | null>("c1");
    const { api } = mountWith(channelId);

    api().notifyTyping();
    api().notifyTyping();
    api().notifyTyping();
    expect(notify).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3500);
    api().notifyTyping();
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
