/**
 * 4D attachment surface: rendering, and the content de-duplication it requires.
 *
 * The strip test is the one that matters. `buildMessageEvent` appends a markdown
 * reference per attachment so non-imeta clients still show something; SWF
 * renders content as plain text, so without the strip a user sees the literal
 * `![image](http://…)` sitting directly above the image it refers to. Reverting
 * `contentWithoutAttachmentRefs` to `(c) => c` fails the first three cases here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import MessageAttachments from "@/components/MessageAttachments.vue";
import { contentWithoutAttachmentRefs, attachmentMarkdown, type Attachment } from "@/protocol/imeta";
import { mediaService } from "@/services/MediaService";

/**
 * `/media/{sha256}` requires Blossom GET auth + relay membership
 * (`api/media.rs:527-550`), so the component fetches bytes and renders a
 * `blob:` URL. These tests stub that fetch; the real round trip is proven in
 * `tests/integration/dmAttachments.e2e.spec.ts` against a live relay.
 */
vi.spyOn(mediaService, "fetchAuthorizedBlobUrl").mockImplementation(async (url: string) =>
  url.replace(/^https?:/, "blob:"),
);

beforeEach(() => {
  vi.mocked(mediaService.fetchAuthorizedBlobUrl).mockClear();
});

/** Mounts and waits for the authorized-media fetch to settle. */
async function mountResolved(attachments: Attachment[]) {
  const wrapper = mount(MessageAttachments, { props: { attachments } });
  await flushPromises();
  return wrapper;
}

const image: Attachment = {
  url: "http://localhost:3000/media/abc.jpg",
  mimeType: "image/jpeg",
  sha256: "abc",
  size: 2048,
  dim: "800x600",
  filename: "screenshot.jpg",
};

const pdf: Attachment = {
  url: "http://localhost:3000/media/def.pdf",
  mimeType: "application/pdf",
  sha256: "def",
  size: 1048576,
  filename: "my quarterly report.pdf",
};

describe("contentWithoutAttachmentRefs", () => {
  it("removes the appended markdown reference for a rendered attachment", () => {
    const content = `Look at this\n\n${attachmentMarkdown(image)}`;
    expect(contentWithoutAttachmentRefs(content, [image])).toBe("Look at this");
  });

  it("leaves nothing behind for an attachment-only message", () => {
    expect(contentWithoutAttachmentRefs(attachmentMarkdown(image), [image])).toBe("");
  });

  it("removes one reference per attachment", () => {
    const content = `Two files\n\n${attachmentMarkdown(image)}\n${attachmentMarkdown(pdf)}`;
    expect(contentWithoutAttachmentRefs(content, [image, pdf])).toBe("Two files");
  });

  it("leaves a URL the user typed themselves alone", () => {
    const typed = `See ${image.url} for details`;
    expect(contentWithoutAttachmentRefs(typed, [image])).toBe(typed);
  });

  it("is a no-op when there are no attachments", () => {
    expect(contentWithoutAttachmentRefs("plain text", [])).toBe("plain text");
  });
});

describe("MessageAttachments", () => {
  it("renders an image as a linked img with its aspect ratio reserved", async () => {
    const wrapper = await mountResolved([image]);
    const img = wrapper.find("img");
    // Reserving the box stops the list reflowing as images decode.
    expect(img.attributes("style")).toContain("800 / 600");
    expect(wrapper.find("a").attributes("rel")).toContain("noopener");
  });

  it("renders a non-image as a download link carrying its name and size", async () => {
    const wrapper = await mountResolved([pdf]);
    const link = wrapper.find("a.file");
    expect(link.attributes("download")).toBeDefined();
    expect(link.text()).toContain("my quarterly report.pdf");
    expect(link.text()).toContain("1.0 MB");
  });

  it("gives every attachment an accessible name", async () => {
    const wrapper = await mountResolved([image, pdf]);
    const labels = wrapper.findAll("a").map((a) => a.attributes("aria-label"));
    expect(labels.every((label) => Boolean(label))).toBe(true);
  });

  it("renders nothing at all when there are no attachments", () => {
    const wrapper = mount(MessageAttachments, { props: { attachments: [] } });
    expect(wrapper.find("[data-testid='message-attachments']").exists()).toBe(false);
  });
});

/**
 * REGRESSION GUARD. These two tests previously asserted `src === attachment.url`
 * — they were pinning a real bug in place. `/media/{sha256}` is not public, and
 * a browser cannot put an Authorization header on `<img src>`, so pointing the
 * element at the relay URL yields 401 and a broken image for EVERY attachment
 * in every channel and DM. Found by the real-relay E2E; no unit test caught it
 * because none of them ever fetched the URL.
 */
describe("MessageAttachments — authorized media", () => {
  it("never points an element at the raw relay URL", async () => {
    const wrapper = await mountResolved([image, pdf]);
    const html = wrapper.html();
    expect(html).not.toContain(image.url);
    expect(html).not.toContain(pdf.url);
  });

  it("renders the blob: URL it fetched with auth", async () => {
    const wrapper = await mountResolved([image]);
    expect(wrapper.find("img").attributes("src")).toMatch(/^blob:/);
    expect(mediaService.fetchAuthorizedBlobUrl).toHaveBeenCalledWith(image.url, image.sha256);
  });

  it("shows a placeholder instead of blanking the message when a fetch fails", async () => {
    vi.mocked(mediaService.fetchAuthorizedBlobUrl).mockRejectedValueOnce(new Error("401"));
    const wrapper = await mountResolved([image]);
    expect(wrapper.find("[data-testid='attachment-unavailable']").exists()).toBe(true);
    expect(wrapper.text()).toContain("screenshot.jpg");
  });

  it("does not render a broken img while the fetch is still in flight", () => {
    const wrapper = mount(MessageAttachments, { props: { attachments: [image] } });
    // Not awaited: this is the pre-resolution frame.
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("[data-testid='attachment-loading']").exists()).toBe(true);
  });
});
