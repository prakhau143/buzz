import { computed, watch, type ComputedRef } from "vue";
import { profileAliases, resolveMentionBindings, type MentionBindings } from "./mentionModel";
import { segmentMessage, type MessageSegment } from "./messageSegments";
import { profileEventFor, profileFor } from "@/features/profile/profileStore";
import { profileService } from "@/services/ProfileService";
import { logError } from "@/services/errors";
import { allTagValues, type RawNostrEvent } from "@/protocol/types";
import { hasEveryoneMentionTag } from "@/protocol/messages";

/**
 * The ONE way a surface turns a message into render tokens: the event's
 * content + its `p` tags + its semantic `@everyone` tag → `MessageSegment[]`
 * (`messageSegments.segmentMessage`). Used by `MessageContent` (full messages:
 * channel, DM, thread, Inbox detail) and `MessagePreview` (compact previews:
 * Inbox rows, Search results, in-app notifications, the action-sheet context),
 * so every surface draws the same message semantics.
 *
 * Mentions bind from the TAGS, never from text alone: only a tagged identity's
 * aliases (from the profile registry) can become a mention chip, and
 * `@everyone` only when the event carries `["mention", "everyone"]`.
 */

const NO_BINDINGS: MentionBindings = new Map();

/** Pure: tokens for `content`, from the registry as it is right now. */
export function tokenizeMessage(content: string, mentions: readonly string[], everyone = false): MessageSegment[] {
  const tagged = content.includes("@") ? mentions : [];
  const bindings =
    tagged.length === 0
      ? NO_BINDINGS
      : resolveMentionBindings(
          tagged,
          (pubkey) => profileAliases(profileEventFor(pubkey)?.content, profileFor(pubkey)?.displayName),
          content,
        );
  return segmentMessage(content, bindings, { everyone });
}

/**
 * Mentioned people not in the registry yet. Requests from every message and
 * preview on screen are coalesced into ONE `fetchProfiles` per tick (an Inbox
 * of fifty rows mentioning unknown people asks once, not fifty times), and a
 * pubkey already being fetched is never asked for again. Results land in the
 * reactive registry, which re-renders the chips.
 */
const inFlight = new Set<string>();
const queued = new Set<string>();
let flushScheduled = false;

function flush() {
  flushScheduled = false;
  const wanted = [...queued];
  queued.clear();
  if (wanted.length === 0) return;
  profileService
    .fetchProfiles(wanted)
    .catch((err: unknown) => logError("messageTokens.fetchMentionedProfiles", err))
    .finally(() => {
      for (const pubkey of wanted) inFlight.delete(pubkey);
    });
}

export function requestMentionProfiles(pubkeys: readonly string[]): void {
  for (const pubkey of pubkeys) {
    if (inFlight.has(pubkey) || profileFor(pubkey)) continue;
    inFlight.add(pubkey);
    queued.add(pubkey);
  }
  if (queued.size && !flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
}

export interface MentionTags {
  /** `p`-tagged pubkeys — the only identities that can render as mentions. */
  mentions: readonly string[];
  /** The semantic `["mention", "everyone"]` tag. */
  everyone: boolean;
}
const tagCache = new WeakMap<object, MentionTags>();
/**
 * The mention semantics of a raw event, read from its TAGS (never from the
 * text). Memoised per event object, so a list re-rendering doesn't re-scan tags.
 */
export function mentionTagsOf(event: Pick<RawNostrEvent, "tags">): MentionTags {
  let tags = tagCache.get(event);
  if (!tags) {
    tags = { mentions: allTagValues(event, "p"), everyone: hasEveryoneMentionTag(event) };
    tagCache.set(event, tags);
  }
  return tags;
}

/** For tests: forget pending / in-flight lookups. */
export function resetMentionProfileRequestsForTests(): void {
  inFlight.clear();
  queued.clear();
  flushScheduled = false;
}

/**
 * Reactive tokens for a component: re-tokenizes only when the content, tags or
 * a mentioned person's registry entry change (one `computed` per message), and
 * asks for mentioned profiles the registry doesn't have yet.
 */
export function useMessageTokens(source: {
  content: () => string;
  mentions: () => readonly string[];
  everyone: () => boolean;
}): ComputedRef<MessageSegment[]> {
  const missing = computed(() => {
    const content = source.content();
    return content.includes("@") ? source.mentions().filter((pubkey) => !profileFor(pubkey)) : [];
  });
  watch(missing, (pubkeys) => pubkeys.length && requestMentionProfiles(pubkeys), { immediate: true });
  return computed(() => tokenizeMessage(source.content(), source.mentions(), source.everyone()));
}
