import { defineComponent, Fragment, h, type PropType } from "vue";
import MentionChip from "./MentionChip.vue";
import EveryoneMentionChip from "./EveryoneMentionChip.vue";
import MessageLink from "@/features/links/MessageLink.vue";
import { useMessageTokens } from "./messageTokens";

/**
 * Message text with its mentions drawn as mentions and its URLs as links —
 * used by every message surface (channel feed, DMs, thread root and replies,
 * Inbox detail), so a mention or a link looks and behaves the same wherever it
 * appears. Tokenizing is `messageTokens.useMessageTokens` → `segmentMessage`
 * (pure, tested) — the same path `MessagePreview` uses for compact previews.
 *
 * Binding follows OLD BUZZ (`resolveMentionProps`): only identities TAGGED on
 * the event (`mentions` = its `p` tags) can become a mention, matched by their
 * aliases; `@everyone` only when the event carries the semantic tag
 * (`mentionsEveryone`). So it works identically for live, reloaded and
 * historical messages — it depends on nothing but the event itself.
 *
 * A render function rather than a template: the parent paragraph is
 * `white-space: pre-wrap`, and template whitespace between segments would show.
 * No `v-html` anywhere: every token is text or a component with bound props.
 */

export default defineComponent({
  name: "MessageContent",
  props: {
    content: { type: String, required: true },
    /** The event's `p`-tagged pubkeys. */
    mentions: { type: Array as PropType<string[]>, default: () => [] },
    /** The event carries the semantic `@everyone` tag. */
    mentionsEveryone: { type: Boolean, default: false },
  },
  setup(props) {
    const segments = useMessageTokens({
      content: () => props.content,
      mentions: () => props.mentions,
      everyone: () => props.mentionsEveryone,
    });

    return () =>
      h(
        Fragment,
        segments.value.map((segment, index) => {
          switch (segment.kind) {
            case "text":
              return segment.text;
            case "mention":
              return h(MentionChip, { key: `${index}:${segment.pubkey}`, pubkey: segment.pubkey, label: segment.label });
            case "everyone":
              return h(EveryoneMentionChip, { key: `${index}:everyone` });
            case "link":
              return h(MessageLink, { key: `${index}:${segment.href}`, href: segment.href, text: segment.text });
          }
        }),
      );
  },
});
