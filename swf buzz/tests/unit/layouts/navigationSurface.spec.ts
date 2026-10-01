/**
 * Navigation surface after the cleanup:
 *
 *  - the HEADER is a navigation shell: sidebar toggle, Back, Forward, brand —
 *    no Home link, connection pill, avatar or Sign out (those live in the
 *    community switcher and the profile menu);
 *  - the SIDEBAR keeps both sections and the routes stay registered;
 *  - the raw "Pubkey (hex) to message" + "Start" control is gone, because a
 *    conversation is started from a person, not from pasted key material.
 *
 * The sidebar assertions are source-level, following the existing convention in
 * `tests/unit/security/identitySecurity.spec.ts`: AppSidebar pulls in the
 * router, several stores, vue-query and async components, and what is being
 * pinned here is "this control must not come back", which a source invariant
 * states more directly than a heavy mount.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h } from "vue";

// AppHeader starts a presence heartbeat and an agent-observer subscription on
// mount. Both schedule timers and reach for the relay connection, which made
// this test intermittently see an empty nav under parallel load — it passed
// alone and failed in a full run. Neither has anything to do with which links
// the header renders, so they are stubbed out to make the assertion
// deterministic rather than load-dependent.
vi.mock("@/features/presence/usePresenceHeartbeat", () => ({
  usePresenceHeartbeat: () => undefined,
}));

// Imported statically, NOT with `await import()` inside the test. Transforming
// this SFC and its module graph took longer than the 5s per-test timeout under
// a loaded parallel run, so the test intermittently timed out — green alone,
// red in a full suite. Module loading belongs outside the test's time budget.
// (`vi.mock` is hoisted above imports, so the stubs above still apply.)
import AppHeader from "@/layouts/AppHeader.vue";

const SRC = join(process.cwd(), "src");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

const sidebar = read("layouts", "AppSidebar.vue");
const header = read("layouts", "AppHeader.vue");
const routes = read("app", "router", "index.ts");

describe("header: a navigation shell only", () => {
  async function mountHeader() {
    setActivePinia(createPinia());
    const Stub = defineComponent({ render: () => h("div") });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", name: "home", component: Stub },
        { path: "/channels", name: "channels", component: Stub },
        { path: "/dm", name: "dm", component: Stub },
      ],
    });
    await router.push("/");
    await router.isReady();
    return mount(AppHeader, { global: { plugins: [router], stubs: { BrandLogo: { template: '<a class="brand">SWF Buzz</a>' } } } });
  }

  it("renders the sidebar toggle, Back, Forward and the brand — and nothing else", async () => {
    const wrapper = await mountHeader();
    expect(wrapper.find("[data-testid=header-sidebar-toggle]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=header-back]").attributes("aria-label")).toBe("Back");
    expect(wrapper.find("[data-testid=header-forward]").attributes("aria-label")).toBe("Forward");
    expect(wrapper.find(".brand").exists()).toBe(true);
    expect(wrapper.findAll("button")).toHaveLength(3);
  });

  it("has no Home link, Connected pill, avatar/status or Sign out", async () => {
    const wrapper = await mountHeader();
    const text = wrapper.text();
    expect(text).not.toContain("Home");
    expect(text).not.toContain("Connected");
    expect(text).not.toContain("Sign out");
    expect(wrapper.find(".avatar-wrapper, [data-presence]").exists()).toBe(false);
    expect(header).not.toContain("ConnectionBadge");
    expect(header).not.toContain("requestSignOut");
  });

  it("Back and Forward start disabled (no history yet)", async () => {
    const wrapper = await mountHeader();
    expect(wrapper.find("[data-testid=header-back]").attributes("disabled")).toBeDefined();
    expect(wrapper.find("[data-testid=header-forward]").attributes("disabled")).toBeDefined();
  });
});

describe("sidebar keeps its features", () => {
  it("still has a Channels section and a Direct messages section", () => {
    expect(sidebar).toContain("<h2>Channels</h2>");
    expect(sidebar).toContain("<h2>Direct messages</h2>");
  });

  it("still renders the channel list and the conversation list", () => {
    expect(sidebar).toContain("ChannelListItem");
    expect(sidebar).toContain("DmParticipantLabel");
  });

  it("keeps the channel and DM routes registered", () => {
    expect(routes).toContain('name: "channels"');
    expect(routes).toContain('name: "dm"');
    expect(routes).toContain('name: "community-channels"');
    expect(routes).toContain('name: "community-dm"');
  });
});

describe("raw public-key DM entry is gone", () => {
  it("has no hex-pubkey input", () => {
    expect(sidebar).not.toContain("Pubkey (hex)");
    expect(sidebar).not.toContain("newDmPubkey");
  });

  it("has no Start button and no handler behind it", () => {
    expect(sidebar).not.toContain("startNewDm");
    expect(sidebar).not.toMatch(/>\s*Start\s*</);
  });

  it("leaves no orphaned styling or error state behind", () => {
    expect(sidebar).not.toContain("new-dm");
    expect(sidebar).not.toContain("newDmError");
  });
});

describe("the one DM entry point", () => {
  it("profile Message goes through the shared openDirectConversation", () => {
    const panel = read("features", "channels", "ui", "UserProfilePanel.vue");
    expect(panel).toContain("useDirectConversation");
    expect(panel).toContain("openDirectConversation");
  });

  it("the shared entry reuses the existing DM open path rather than a new one", () => {
    const shared = read("features", "dm", "useDirectConversation.ts");
    expect(shared).toContain("useOpenDm");
    expect(shared).toContain('name: "dm"');
  });
});
