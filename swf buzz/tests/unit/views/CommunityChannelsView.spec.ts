import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { ref } from "vue";

/**
 * Regression coverage for the P0 crash reported after creating a channel:
 * every mutation handler in `CommunityChannelsView.vue` used to `await` a
 * Vue Query `mutateAsync` with no try/catch, so any failure (most
 * commonly: no community existed yet, so `POST /api/communities/null/
 * channels` was attempted and rejected by the backend) threw an unhandled
 * rejection out of a template event handler — which Vue routes into the
 * nearest `onErrorCaptured` boundary, crashing the *entire app*, not just
 * this view. These tests mount the real component against realistic
 * backend-response fixtures (shaped exactly like `backend/src/routes/
 * channels.rs`'s actual snake_case JSON) and assert it never throws.
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
  const { default: CommunityChannelsView } = await import("@/views/CommunityChannelsView.vue");
  return mount(CommunityChannelsView, {
    global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] },
  });
}

function calledWithPathContaining(fragment: string): boolean {
  return apiRequestMock.mock.calls.some(
    ([path]: [unknown]) => typeof path === "string" && path.includes(fragment),
  );
}

describe("CommunityChannelsView", () => {
  let pinia: Pinia;

  beforeEach(() => {
    apiRequestMock.mockReset();
    vi.clearAllMocks();
    vi.resetModules();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the create-community prompt instead of a broken channel form when no community is resolved", async () => {
    vi.doMock("@/features/communities/currentCommunity", () => ({
      currentCommunityId: ref(null),
      setCurrentCommunityId: vi.fn(),
    }));

    const wrapper = await mountView(pinia);
    await flushPromises();

    // The old bug: this view unconditionally rendered a create-channel
    // form even with no community, so submitting it POSTed to
    // `/api/communities/null/channels`. Assert that request is never made.
    expect(wrapper.text()).toContain("Set up your community");
    expect(calledWithPathContaining("/channels")).toBe(false);
  });

  it("creating a channel against a realistic backend response does not throw, and the new channel appears selected", async () => {
    vi.doMock("@/features/communities/currentCommunity", () => ({
      currentCommunityId: ref("11111111-1111-1111-1111-111111111111"),
      setCurrentCommunityId: vi.fn(),
    }));

    // Real backend response shapes (snake_case), see backend/src/models.rs.
    apiRequestMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path.endsWith("/channels") && options?.method === "POST") {
        return {
          id: "22222222-2222-2222-2222-222222222222",
          community_id: "11111111-1111-1111-1111-111111111111",
          name: "general",
          visibility: "open",
          description: null,
        };
      }
      if (path.endsWith("/channels")) return [];
      if (path.includes("/members")) return [];
      if (path.includes("/thread-summaries")) return [];
      if (path.includes("/messages")) return [];
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

    // Open the create-channel dialog and submit — this is the exact path
    // that used to crash the whole app on failure.
    await wrapper.find('[aria-label="Create channel"]').trigger("click");
    await flushPromises();

    const nameInput = wrapper.find("#http-channel-name");
    expect(nameInput.exists()).toBe(true);
    await nameInput.setValue("general");

    const submit = wrapper.findAll("button").find((b) => b.text() === "Create channel");
    expect(submit).toBeTruthy();
    await submit!.trigger("click");
    await flushPromises();

    // No error boundary text, no thrown/unhandled rejection reached this
    // point (vitest fails the test on an unhandled rejection regardless).
    expect(wrapper.text()).not.toContain("hit a problem");
    // `ChannelServiceHttp.createChannel` normalizes an omitted description
    // to `null` before sending (`description ?? null`) — see ChannelServiceHttp.ts.
    expect(apiRequestMock).toHaveBeenCalledWith(
      "/api/communities/11111111-1111-1111-1111-111111111111/channels",
      { method: "POST", body: { name: "general", visibility: "open", description: null } },
    );
  });

  it("a rejected create-channel call surfaces an inline dialog error instead of throwing", async () => {
    vi.doMock("@/features/communities/currentCommunity", () => ({
      currentCommunityId: ref("11111111-1111-1111-1111-111111111111"),
      setCurrentCommunityId: vi.fn(),
    }));

    const { AppError } = await import("@/services/errors");
    apiRequestMock.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path.endsWith("/channels") && options?.method === "POST") {
        throw new AppError("permission_denied", "You don't have permission to do that.");
      }
      if (path.endsWith("/channels")) return [];
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

    await wrapper.find('[aria-label="Create channel"]').trigger("click");
    await flushPromises();
    await wrapper.find("#http-channel-name").setValue("general");
    const submit = wrapper.findAll("button").find((b) => b.text() === "Create channel");
    await submit!.trigger("click");
    await flushPromises();

    // The dialog itself stays open with an inline error — not a full-app crash.
    expect(wrapper.text()).toContain("You don't have permission to do that.");
    expect(wrapper.text()).not.toContain("hit a problem");
  });
});
