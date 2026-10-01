/**
 * Phase H — opening links (platform/opener) and the MessageLink component.
 * One click opens the user's default browser; Ctrl/⌘+click and middle-click
 * too; a double-click launches ONCE; SWF itself never navigates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const tauri = vi.hoisted(() => ({ isTauri: vi.fn(() => false), invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/core", () => tauri);

import { DEDUP_MS, openExternalUrl, resetOpenerDedup } from "@/platform/opener";
import MessageLink from "@/features/links/MessageLink.vue";
import MessageContent from "@/features/mentions/MessageContent";
import { absorbProfileEvents, clearProfileStore } from "@/features/profile/profileStore";

const URL_A = "https://x.com/buzzdotxyz/status/2105343423570182282";
let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setActivePinia(createPinia());
  resetOpenerDedup();
  tauri.isTauri.mockReturnValue(false);
  tauri.invoke.mockClear();
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => {
  openSpy.mockRestore();
  clearProfileStore();
});

describe("openExternalUrl", () => {
  it("28. web: opens a new tab with no opener/referrer", async () => {
    expect(await openExternalUrl(URL_A, 1_000)).toBe("opened");
    expect(openSpy).toHaveBeenCalledWith(URL_A, "_blank", "noopener,noreferrer");
  });

  it("desktop: hands the URL to the OS default browser through the opener plugin", async () => {
    tauri.isTauri.mockReturnValue(true);
    expect(await openExternalUrl(URL_A, 1_000)).toBe("opened");
    expect(tauri.invoke).toHaveBeenCalledWith("plugin:opener|open_url", { url: URL_A });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("30. the same URL twice within the dedup window launches once", async () => {
    await openExternalUrl(URL_A, 1_000);
    expect(await openExternalUrl(URL_A, 1_000 + DEDUP_MS - 1)).toBe("duplicate");
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(await openExternalUrl(URL_A, 1_000 + DEDUP_MS + 1)).toBe("opened");
  });

  it("27. refuses unsafe schemes, whatever the caller passes", async () => {
    expect(await openExternalUrl("javascript:alert(1)")).toBe("rejected");
    expect(await openExternalUrl("data:text/html,x")).toBe("rejected");
    expect(await openExternalUrl("file:///c:/windows")).toBe("rejected");
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("MessageLink", () => {
  const mountLink = () => mount(MessageLink, { props: { href: URL_A, text: URL_A }, attachTo: document.body });

  it("renders a real, labelled link showing the host and a shortened path", () => {
    const a = mountLink().find("a");
    expect(a.attributes("href")).toBe(URL_A);
    expect(a.attributes("rel")).toContain("noopener");
    expect(a.attributes("title")).toBe(URL_A);
    expect(a.attributes("aria-label")).toContain("opens in your browser");
    expect(a.text()).toContain("x.com");
  });

  it("28. a click opens externally and prevents in-app navigation", async () => {
    const a = mountLink().find("a");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.element.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("29. Ctrl+click opens externally too (no router navigation)", async () => {
    const a = mountLink().find("a");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    a.element.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("30. a double-click (click, click, dblclick) opens once", async () => {
    const a = mountLink().find("a");
    await a.trigger("click");
    await a.trigger("click");
    await a.trigger("dblclick");
    await Promise.resolve();
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("31. a tap (touch-generated click) opens once and does not bubble to the row", async () => {
    const onRowClick = vi.fn();
    const host = document.createElement("div");
    host.addEventListener("click", onRowClick);
    document.body.appendChild(host);
    const w = mount(MessageLink, { props: { href: URL_A, text: URL_A }, attachTo: host });
    await w.find("a").trigger("click");
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("23–25. links alongside mentions in a message", () => {
  const DEV = "d".repeat(64);
  beforeEach(() => {
    absorbProfileEvents([
      { id: "p".repeat(64), pubkey: DEV, created_at: 1, kind: 0, tags: [], content: JSON.stringify({ display_name: "Prakhar" }), sig: "" },
    ]);
  });

  it("@person + URL render as chip and link, in order, no nesting", () => {
    const w = mount(MessageContent, { props: { content: "@Prakhar https://example.com", mentions: [DEV] } });
    const html = w.html();
    expect(w.find("[data-testid=mention-chip]").exists()).toBe(true);
    expect(w.find("[data-testid=message-link]").exists()).toBe(true);
    expect(html.indexOf("mention-chip")).toBeLessThan(html.indexOf("message-link"));
    expect(w.find("a a").exists()).toBe(false);
    expect(w.find("[data-testid=message-link] [data-testid=mention-chip]").exists()).toBe(false);
  });

  it("URL first, then a mention; multiple URLs; emoji and punctuation stay text", () => {
    const w = mount(MessageContent, {
      props: { content: "https://a.com 🎉 @Prakhar, see (https://b.com/x).", mentions: [DEV] },
    });
    expect(w.findAll("[data-testid=message-link]")).toHaveLength(2);
    expect(w.text()).toContain("🎉");
    expect(w.text().trim().endsWith(").")).toBe(true);
  });

  it("@everyone + URL", () => {
    const w = mount(MessageContent, { props: { content: "@everyone https://example.com", mentionsEveryone: true } });
    expect(w.find("[data-testid=everyone-mention-chip]").exists()).toBe(true);
    expect(w.find("[data-testid=message-link]").exists()).toBe(true);
  });

  it("a mention-looking text inside a URL is part of the link, never a chip", () => {
    const w = mount(MessageContent, { props: { content: "https://example.com/@Prakhar", mentions: [DEV] } });
    expect(w.find("[data-testid=mention-chip]").exists()).toBe(false);
    expect(w.findAll("[data-testid=message-link]")).toHaveLength(1);
  });

  it("no v-html: a URL with markup stays inert text in an attribute", () => {
    const w = mount(MessageContent, { props: { content: 'https://example.com/"><img src=x onerror=alert(1)>' } });
    expect(w.find("img").exists()).toBe(false);
  });

  it("inside backticks a URL is not linkified (code is code)", () => {
    const w = mount(MessageContent, { props: { content: "run `curl https://example.com` now" } });
    expect(w.find("[data-testid=message-link]").exists()).toBe(false);
  });
});
