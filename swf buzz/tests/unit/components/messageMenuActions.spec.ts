/**
 * Phase 4B — the message menu offers edit/delete only where the relay would
 * actually accept them, and HIDES the rest rather than showing them disabled
 * (design spec: "unauthorized actions should be hidden rather than disabled").
 *
 * Phase H: the menu is teleported to <body> (PositionedContextMenu), so items
 * are found in the document, not inside the wrapper.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import MessageMenu from "@/components/MessageMenu.vue";

const mounted: VueWrapper[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
  document.body.innerHTML = "";
});

function mountMenu(props: Partial<InstanceType<typeof MessageMenu>["$props"]> = {}) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const wrapper = mount(MessageMenu, {
    attachTo: document.body,
    props: {
      anchor,
      messageContent: "hello",
      messageEventId: "e".repeat(64),
      authorPubkey: "a".repeat(64),
      isOwnMessage: false,
      ...props,
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

const find = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const menuText = () => document.querySelector('[data-testid="context-menu"]')?.textContent ?? "";

describe("MessageMenu edit/delete gating", () => {
  it("offers neither when the viewer may do neither", () => {
    mountMenu({ canEdit: false, deleteMode: null });

    expect(find("message-edit")).toBeNull();
    expect(find("message-delete")).toBeNull();
  });

  it("offers edit only to someone allowed to edit", () => {
    mountMenu({ canEdit: true, deleteMode: null });

    expect(find("message-edit")).not.toBeNull();
  });

  it("labels a self delete plainly", () => {
    mountMenu({ isOwnMessage: true, canEdit: true, deleteMode: "self" });

    expect(find("message-delete")?.textContent?.trim()).toBe("Delete message");
  });

  it("labels deleting someone else's message as a moderator action", () => {
    // Deleting another person's message is a moderation act — the label must
    // say so, so it cannot be mistaken for removing one's own post.
    mountMenu({ isOwnMessage: false, canEdit: false, deleteMode: "admin" });

    expect(find("message-delete")?.textContent?.trim()).toBe("Delete (moderator)");
  });

  it("emits edit and delete rather than acting directly", () => {
    // The menu never publishes: the view owns the mutation, so the optimistic
    // overlay and rollback live in one place.
    const menu = mountMenu({ canEdit: true, deleteMode: "self" });

    find("message-edit")?.click();
    find("message-delete")?.click();

    expect(menu.emitted("edit")).toHaveLength(1);
    expect(menu.emitted("delete")).toHaveLength(1);
  });

  it("never offers Report on my own message", () => {
    mountMenu({ isOwnMessage: true });

    expect(menuText()).not.toContain("Report message");
  });

  it("does not offer 'Remind me later' — no reminder infrastructure exists", () => {
    mountMenu();
    expect(menuText()).not.toContain("Remind me later");
  });
});
