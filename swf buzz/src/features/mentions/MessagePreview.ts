import { computed, defineComponent, Fragment, h, type PropType } from "vue";
import AppIcon from "@/components/AppIcon.vue";
import { agentMentionDisplayLabel, formatMentionDisplayLabel } from "./mentionModel";
import { useMessageTokens } from "./messageTokens";
import { EVERYONE_LABEL } from "./everyone";
import { linkDisplay } from "@/features/links/urlModel";
import { isKnownAgent, profileFor } from "@/features/profile/profileStore";
import "./messagePreview.css";

/**
 * A message PREVIEW (Inbox rows, Search results, in-app notifications, the
 * mobile action-sheet context) drawn with the same semantics as the message
 * itself: the SAME tokens (`useMessageTokens` → `segmentMessage`: `p`-tag
 * mentions, the semantic `@everyone`, links, in order) and the SAME mention
 * language (`--color-mention-*`, weight 600, subtle border, small radius) — only
 * more compact, and NOT interactive.
 *
 * Previews live inside a row that is itself the click target (open the exact
 * message), so nothing here is a link, a button or focusable: a tapped chip
 * opens the message like the rest of the row, and there are no nested
 * interactive elements for keyboards or screen readers. Each chip is plain
 * text ("@Prakhar Mittal", "@everyone", "x.com/…") so it reads naturally and is
 * not distinguished by colour alone (the "@", the weight, the border, the
 * glyph).
 *
 * The text is normalised for a one-or-two-line preview (HTML comments dropped,
 * whitespace collapsed, capped) BEFORE tokenizing, so offsets stay consistent.
 * No `v-html`: every token is a text node or a span with bound text.
 */

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** Preview text: comments out, whitespace collapsed, at most `max` characters. */
export function previewText(content: string, max = 280): string {
  const text = content.replace(HTML_COMMENT, " ").replace(/\s+/g, " ").trim();
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

export default defineComponent({
  name: "MessagePreview",
  props: {
    content: { type: String, required: true },
    /** The event's `p`-tagged pubkeys. */
    mentions: { type: Array as PropType<readonly string[]>, default: () => [] },
    /** The event carries the semantic `@everyone` tag. */
    mentionsEveryone: { type: Boolean, default: false },
    /** Already-normalised text (e.g. a search snippet or a notification body): skip normalising. */
    raw: { type: Boolean, default: false },
    max: { type: Number, default: 280 },
  },
  setup(props) {
    const text = computed(() => (props.raw ? props.content : previewText(props.content, props.max)));
    const segments = useMessageTokens({
      content: () => text.value,
      mentions: () => props.mentions,
      everyone: () => props.mentionsEveryone,
    });

    function mentionLabel(pubkey: string, label: string): string {
      const full = formatMentionDisplayLabel(label);
      const agent = !!profileFor(pubkey)?.isAgent || isKnownAgent(pubkey);
      return agent ? agentMentionDisplayLabel(full) : full;
    }

    return () =>
      h(
        Fragment,
        segments.value.map((segment, index) => {
          switch (segment.kind) {
            case "text":
              return segment.text;
            case "mention":
              return h(
                "span",
                {
                  key: `${index}:${segment.pubkey}`,
                  class: "mp-chip",
                  title: formatMentionDisplayLabel(segment.label),
                  "data-mention-kind": "person",
                  "data-mention-pubkey": segment.pubkey,
                  "data-testid": "preview-mention",
                },
                `@${mentionLabel(segment.pubkey, segment.label)}`,
              );
            case "everyone":
              return h(
                "span",
                {
                  key: `${index}:everyone`,
                  class: "mp-chip mp-everyone",
                  title: "Mentions everyone who can see this channel",
                  "data-mention-kind": "everyone",
                  "data-testid": "preview-everyone",
                },
                [`@${EVERYONE_LABEL}`, h("span", { class: "mp-glyph", "aria-hidden": "true" }, [h(AppIcon, { name: "users", size: 16 })])],
              );
            case "link": {
              const display = linkDisplay(segment.href, 28);
              const label = `${display.host}${display.rest ? `/${display.rest}` : ""}`;
              return h(
                "span",
                { key: `${index}:${segment.href}`, class: "mp-link", title: segment.href, "data-testid": "preview-link" },
                [h("span", { class: "mp-glyph", "aria-hidden": "true" }, [h(AppIcon, { name: "link", size: 16 })]), label],
              );
            }
          }
        }),
      );
  },
});
