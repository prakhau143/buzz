/**
 * "Join with invite" must tell the user what they actually pasted.
 *
 * REGRESSION: an operator hands the owner `swfbuzz://connect?relay=…` at
 * community creation, and the only obvious box to put a link in is this one.
 * Refusing it is correct — it carries no code and cannot grant membership — but
 * the old generic "that doesn't look like an invite" made a valid link look
 * broken.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { buildConnectLink, buildJoinLink } from "@/features/communities/RelayInviteService";

const claim = vi.fn(async () => null);
// Real refs, not `{value: …}` literals: the template auto-unwraps refs, so a
// plain object would read as truthy and disable the button in every case.
vi.mock("@/features/communities/useJoinInvite", () => ({
  useJoinInvite: () => ({ busy: ref(false), error: ref<string | null>(null), claim }),
}));

const JoinInvitePanel = (await import("@/features/onboarding/ui/JoinInvitePanel.vue")).default;

const RELAY = "ws://localhost:3000";
const CODE = `v2.${"a".repeat(43)}`;

beforeEach(() => {
  setActivePinia(createPinia());
  claim.mockClear();
});

async function paste(text: string) {
  const wrapper = mount(JoinInvitePanel, { props: { defaultRelay: RELAY } });
  await wrapper.find('[data-testid="invite-input"]').setValue(text);
  return wrapper;
}

describe("JoinInvitePanel", () => {
  it("names a connection link as a connection link", async () => {
    const wrapper = await paste(buildConnectLink(RELAY, { communityName: "kwikster" }));
    const notice = wrapper.find('[data-testid="invite-is-connection"]');
    expect(notice.exists()).toBe(true);
    expect(notice.text()).toContain("connection link");
    expect(notice.text()).toContain("kwikster");
    // and it must NOT fall back to the generic message
    expect(wrapper.find('[data-testid="invite-unrecognised"]').exists()).toBe(false);
  });

  it("does not offer to join with a connection link", async () => {
    const wrapper = await paste(buildConnectLink(RELAY));
    expect(wrapper.find('[data-testid="invite-target"]').exists()).toBe(false);
    expect(
      wrapper.find('[data-testid="invite-join"]').attributes("disabled"),
      "Join must stay disabled for a connection link",
    ).toBeDefined();
  });

  it("never claims a connection link even if submitted", async () => {
    const wrapper = await paste(buildConnectLink(RELAY));
    await wrapper.find("form").trigger("submit");
    expect(claim).not.toHaveBeenCalled();
  });

  it("accepts a real invite link and offers to join", async () => {
    const wrapper = await paste(buildJoinLink(RELAY, CODE));
    expect(wrapper.find('[data-testid="invite-target"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="invite-is-connection"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="invite-join"]').attributes("disabled")).toBeUndefined();
  });

  it("claims a real invite on submit", async () => {
    const wrapper = await paste(buildJoinLink(RELAY, CODE));
    await wrapper.find("form").trigger("submit");
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ code: CODE, relay: RELAY }));
  });

  it("still shows the generic message for genuine nonsense", async () => {
    const wrapper = await paste("ws://localhost:3000");
    expect(wrapper.find('[data-testid="invite-unrecognised"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="invite-is-connection"]').exists()).toBe(false);
  });
});
