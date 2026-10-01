/**
 * SWF sign-out warns before removing the identity from the device
 * (docs/IDENTITY_SWITCHING_AND_SESSION_LIFECYCLE.md §3, §11) — exact copy,
 * cancel keeps everything, confirm proceeds (never blocked), and every
 * "Sign out" button goes through the same `useSignOut` gate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h } from "vue";
import SignOutDialog from "@/features/auth/ui/SignOutDialog.vue";
import { useSessionStore } from "@/stores/session";

const logoutMock = vi.fn(async () => undefined);
vi.mock("@/features/auth/useAuth", () => ({
  useAuth: () => ({ logout: logoutMock, isLoading: { value: false } }),
}));

const WARNING =
  "Signing out will remove this identity's private key from this device. Make sure you have your nsec, hex private key, or ncryptsec backup if you want to use this identity again.";

beforeEach(() => {
  setActivePinia(createPinia());
  logoutMock.mockClear();
});

describe("SignOutDialog", () => {
  it("shows the exact backup warning and the two actions", () => {
    const wrapper = mount(SignOutDialog);
    expect(wrapper.find("[data-testid=sign-out-warning]").text()).toBe(WARNING);
    expect(wrapper.find("[data-testid=sign-out-cancel]").text()).toBe("Cancel");
    expect(wrapper.find("[data-testid=sign-out-confirm]").text()).toBe("Sign out & remove identity");
    expect(wrapper.find("[role=alertdialog]").attributes("aria-modal")).toBe("true");
  });

  it("cancel closes, confirm proceeds; neither is blocked", async () => {
    const wrapper = mount(SignOutDialog);
    await wrapper.find("[data-testid=sign-out-cancel]").trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
    await wrapper.find("[data-testid=sign-out-confirm]").trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("Escape closes it", async () => {
    const wrapper = mount(SignOutDialog, { attachTo: document.body });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(wrapper.emitted("close")).toHaveLength(1);
    wrapper.unmount();
  });
});

describe("useSignOut — the gate every Sign out button uses", () => {
  async function mountGate() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { render: () => h("div") } }] });
    const { useSignOut } = await import("@/features/auth/useSignOut");
    let gate!: ReturnType<typeof useSignOut>;
    mount(
      defineComponent({
        setup() {
          gate = useSignOut();
          return () => h("div");
        },
      }),
      { global: { plugins: [router] } },
    );
    return gate;
  }

  it("LOCAL identity: asks first (dialog), logs out only on confirm, cancel changes nothing", async () => {
    useSessionStore().setIdentity({ authMode: "local", employeeEmail: null, applicationUserId: null, pubkey: "ab".repeat(32) });
    const gate = await mountGate();

    await gate.requestSignOut();
    expect(gate.showConfirm.value).toBe(true);
    expect(logoutMock).not.toHaveBeenCalled();

    gate.cancelSignOut();
    expect(gate.showConfirm.value).toBe(false);
    expect(logoutMock).not.toHaveBeenCalled();
    expect(useSessionStore().pubkey).toBe("ab".repeat(32)); // untouched

    await gate.requestSignOut();
    await gate.confirmSignOut();
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(gate.showConfirm.value).toBe(false);
  });

  it("legacy (non-local) modes keep the direct logout — no identity is removed there", async () => {
    // Must be a NON-local mode, which is the whole point of this test. It used
    // to be "development"; with that mode removed, "production" (legacy Okta)
    // is the remaining non-local one.
    useSessionStore().setIdentity({ authMode: "production", employeeEmail: null, applicationUserId: null, pubkey: "ab".repeat(32) });
    const gate = await mountGate();
    await gate.requestSignOut();
    expect(gate.showConfirm.value).toBe(false);
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });
});
