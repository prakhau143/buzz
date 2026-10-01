import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ThreadSummaryRow from "@/components/ThreadSummaryRow.vue";
import type { ThreadSummaryView } from "@/features/threads/threadSummary";

// Profiles are resolved through the shared cache; the row must never wait on it.
vi.mock("@/composables/useProfile", () => ({
  useProfile: () => ({ data: { value: null } }),
}));

const A = "aa".repeat(32);
const B = "bb".repeat(32);
const NOW = 1_700_000_000_000;

function mountRow(summary: Partial<ThreadSummaryView> = {}) {
  return mount(ThreadSummaryRow, {
    props: {
      summary: {
        rootId: "root-1",
        count: 2,
        participantPubkeys: [B, A],
        lastReplyAt: Math.floor(NOW / 1000) - 180, // 3 minutes ago
        ...summary,
      },
      now: NOW,
    },
  });
}

beforeEach(() => setActivePinia(createPinia()));

describe("ThreadSummaryRow", () => {
  it("shows the pluralized count and the last-reply time", () => {
    const wrapper = mountRow();
    expect(wrapper.find("[data-testid=thread-summary-count]").text()).toBe("2 replies");
    expect(wrapper.find("[data-testid=thread-summary-last-reply]").text()).toBe("Last reply 3m ago");
    expect(mountRow({ count: 1 }).find("[data-testid=thread-summary-count]").text()).toBe("1 reply");
  });

  it("renders one avatar per participant (capped by the selector), never a +N bubble", () => {
    expect(mountRow().findAllComponents({ name: "AvatarCircle" })).toHaveLength(2);
    expect(mountRow().text()).not.toMatch(/\+\d/);
  });

  it("falls back to a single neutral face when no participants are known yet", () => {
    const wrapper = mountRow({ participantPubkeys: [] });
    expect(wrapper.findAllComponents({ name: "AvatarCircle" })).toHaveLength(1);
  });

  it("is a real button, keyboard operable, with a spoken label covering count, time and action", () => {
    const wrapper = mountRow();
    const row = wrapper.find("[data-testid=thread-summary-row]");
    expect(row.element.tagName).toBe("BUTTON");
    expect(row.attributes("type")).toBe("button");
    expect(row.attributes("aria-label")).toBe("2 replies, Last reply 3m ago., View thread");
    // "View thread" is in the DOM (CSS swaps it in on hover/focus), so screen
    // readers and the hover state agree.
    expect(wrapper.find("[data-testid=thread-summary-view]").text()).toBe("View thread");
  });

  it("emits `open` on click — Enter/Space reach the same handler natively as a <button>", async () => {
    const wrapper = mountRow();
    await wrapper.find("[data-testid=thread-summary-row]").trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("marks itself as the open thread so the row and its parent stay visibly paired", () => {
    const wrapper = mount(ThreadSummaryRow, {
      props: {
        summary: { rootId: "root-1", count: 1, participantPubkeys: [A], lastReplyAt: 1 },
        now: NOW,
        isOpen: true,
      },
    });
    const row = wrapper.find("[data-testid=thread-summary-row]");
    expect(row.classes()).toContain("open");
    expect(row.attributes("aria-expanded")).toBe("true");
  });

  it("omits the time when only a relay count is known, without breaking the label", () => {
    const wrapper = mountRow({ lastReplyAt: null });
    expect(wrapper.find("[data-testid=thread-summary-last-reply]").text()).toBe("");
    expect(wrapper.find("[data-testid=thread-summary-row]").attributes("aria-label")).toBe(
      "2 replies, View thread",
    );
  });

  it("re-renders its relative time when the shared clock ticks", async () => {
    const wrapper = mountRow();
    expect(wrapper.find("[data-testid=thread-summary-last-reply]").text()).toBe("Last reply 3m ago");
    await wrapper.setProps({ now: NOW + 3_600_000 });
    expect(wrapper.find("[data-testid=thread-summary-last-reply]").text()).toBe("Last reply 1h ago");
  });
});
