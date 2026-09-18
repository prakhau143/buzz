import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

/**
 * Regression coverage for the same P0 crash class as
 * `CommunityChannelsView.spec.ts`, but for `handleOpen`/`handleSend` in
 * `CommunityDmView.vue` — both used to `await` a `mutateAsync` with no
 * try/catch, so a rejected DM-open/send threw an unhandled rejection out
 * of a template event handler and crashed the whole app via the global
 * error boundary.
 */

const apiRequestMock = vi.fn();
vi.mock("@/services/ApiClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

const realtimeServiceMock = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
  reconnect: vi.fn().mockResolvedValue(undefined),
  onEvent: vi.fn(() => () => {}),
};
vi.mock("@/services/RealtimeService", () => ({
  realtimeService: realtimeServiceMock,
}));

async function mountView(pinia: Pinia) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { default: CommunityDmView } = await import("@/views/CommunityDmView.vue");
  return mount(CommunityDmView, {
    global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] },
  });
}

describe("CommunityDmView", () => {
  let pinia: Pinia;

  beforeEach(() => {
    apiRequestMock.mockReset();
    vi.clearAllMocks();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a rejected DM-open call surfaces an inline error instead of throwing", async () => {
    apiRequestMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === "/api/dm") return [];
      if (path === "/api/dm/open" && options?.method === "POST") {
        const { AppError } = await import("@/services/errors");
        throw new AppError("not_found", "That item couldn't be found.");
      }
      throw new Error(`unexpected apiRequest call in test: ${path}`);
    });

    const { useSessionStore } = await import("@/stores/session");
    useSessionStore().setApplicationUser({
      id: "33333333-3333-3333-3333-333333333333",
      oktaSub: "sub",
      email: "me@example.com",
      displayName: "Me",
    });

    const wrapper = await mountView(pinia);
    await flushPromises();

    const input = wrapper.find('input[placeholder="Other user\'s id"]');
    expect(input.exists()).toBe(true);
    await input.setValue("44444444-4444-4444-4444-444444444444");
    await wrapper.find("form.open-dm").trigger("submit");
    await flushPromises();

    // No error-boundary fallback text reached — the failure stayed inside this view.
    expect(wrapper.text()).not.toContain("hit a problem");
    expect(wrapper.text()).toContain("Couldn't start that conversation");
  });
});
