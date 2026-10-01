# OLD BUZZ Mention Audit (and SWF Buzz gap analysis)

Date: 2026-09-29 · Scope: `@` mentions of any identity (human or agent), `#channel`
references, and the notification / Inbox side of mentions.

Paths: **OB** = `buzz/buzz/desktop/src/`, **OBT** = `buzz/buzz/desktop/src-tauri/src/`,
**SWF** = `buzz/swf buzz/src/`. OLD BUZZ is read-only reference; nothing there was changed.

---

## 0. Summary

A mention in OLD BUZZ is a **plain `["p", <hex pubkey>]` tag** on the message event, plus
the literal text `@DisplayName` in the content. There is no `nostr:npub…` URI, no
special mention event, and no protocol difference between mentioning a human and an agent.

The **identity is bound by the tag, never by the text**. A renderer turns an `@Label`
occurrence into a mention only when `Label` is an alias of a profile whose pubkey is
p-tagged on that very event. If an alias is shared by two tagged pubkeys it stays plain text.

Humans and agents share one picker (`MentionAutocomplete`), one chip (`MarkdownMention`) and
one hover/click target (`UserProfilePopover` → profile panel). "Agent" is identity metadata:
a bot icon and a squircle avatar.

SWF Buzz already sends the right wire format (`p` tags on kind:9). Everything around it is
missing or partial:
- rendering is plain text, so mentions never show as mentions
- keyboard selection is missing
- the thread and Inbox reply composers have no mention support
- retry drops mentions

The gaps are UI-side. No protocol change is needed.

---

## 1. Composer: autocomplete (OLD BUZZ)

| Aspect | OLD BUZZ behaviour | Source |
|---|---|---|
| Hook / UI | `useMentions` hook; `MentionAutocomplete` dropdown mounted by `MessageComposerAutocompletes` | OB `features/messages/lib/useMentions.ts`, `features/messages/ui/MentionAutocomplete.tsx`, `MessageComposerAutocompletes.tsx:84-101` |
| Editor | TipTap. Mentions are *not* nodes; `mentionHighlightExtension` paints inline decorations (`mention-chip …-human / …-agent`) over the plain text | `mentionHighlightExtension.ts:764-818` |
| Trigger | `@` only, at start of text or after whitespace, `(`, `[` or `{`. Regex: `(?:^|[\s([{])@([^\s]*)$` | OB `shared/lib/detectPrefixQuery.ts:30-40` |
| Multi-word names | Looks back ≤ 80 chars without crossing a newline. Stays open only while the typed text is a prefix of a known name; closes once an exact known name is followed by a space | `detectPrefixQuery.ts:42-78` |
| Candidate sources | Channel members, relay agents, managed agents, global user search (only for a non-empty query), personas, teams. Deduplicated by pubkey | `buildMentionCandidates.ts:56-250` |
| Filtering | Archived identities dropped. Agents limited by scope (channel / "owned" in DMs / managed-only elsewhere) | `agentAutocompleteEligibility.ts:82-195` |
| Ranking | Group rank first: channel member = 0, runnable persona/team = 1, non-agent = 2, other agent = 3. Then label score over displayName/secondary: exact 0 · prefix 1 · whole word 2 · word prefix 3 · pubkey prefix 4 · pubkey contains 5. Stable original order after that | `mentionRanking.ts:23-155` |
| Limits | Debounce 120 ms, 50 results, network search paged on scroll | `useMentions.ts:70-71`, `MentionAutocomplete.tsx:137-144` |
| `@` alone | Empty query → every candidate, in group order, capped at 50. No network search | `useMentions.ts:99,116-121` |
| Keyboard | ↑/↓ wrap. Enter (no modifiers) and Tab (no Shift) select. Esc cancels. Space selects only on an exact name match. Mouse selects on `mousedown` | `useMentions.ts:827-917`, `MentionAutocomplete.tsx:301-304` |
| Row display | Avatar (circle for humans, squircle for agents), name, meta line ("agent" with bot icon / "admin" / "not in channel" / "managed by X"). A truncated npub is shown when two rows share a name | `MentionAutocomplete.tsx:164-171,384-391` |
| Presence | Used only to choose a *default agent*. No human presence in the picker | `useActiveAgentPubkeys.ts`, `mentionRanking.ts:55-105` |

## 2. Selection → text → tags (OLD BUZZ)

1. **Insert.** The picker inserts `` `@${displayName} ` `` with a trailing space (`useMentions.ts:491-582`).
2. **Collisions.** If the label is already bound to a *different* pubkey in this draft, the
   inserted label becomes `Name (<64-hex pubkey>)`, then `Name (<hex>) 2`
   (`extractMentionPubkeys.ts:19-41`, `docs/mention-editor.md:44-58`).
3. **Draft state.** `mentionMapRef: Map<label, pubkey>`, capped at 200 entries (`useMentions.ts:87-96`).
4. **Extracting recipients on send** (`extractMentionPubkeys.ts:118-154`, `mentionBoundaries.ts:35-169`):
   - Code (fenced, indented, inline backticks) is masked first.
   - Occurrences are matched longest-label-first with
     `(^|\s|\(|[*_]{1,3}|\|\|)(@Label)(?=\|\||[\s,;.!?:)\]}*_]|$)` (flags `gi`).
   - Recipients are the explicitly *selected* labels, plus a typed `@Name` that exactly matches a channel member.
   - An ambiguous typed name throws *"The mention @X is ambiguous. Choose a recipient from the mention picker."*
5. **Tags** (`messages/hooks.ts:12-30,547-605` → OBT `events.rs:67-81,285-314`):
   - The sender is removed from the recipients.
   - One `["p", lowercase-hex]` tag per recipient, **deduplicated**, max **50**.
   - Kind 9 with `["h", channel]`. NIP-10 `e` tags when it is a reply.
   - Optional `["mention", pk, "agent-address"]` for agents addressed through the agent tray.
6. **Content.** The trimmed text with literal `@Label`. **No NIP-27 `nostr:` URIs are written**
   (the only `nostr:` hit in OB is onboarding).
7. **Edits.** Kind 40003 edits carry `p` tags plus a `["buzz:mention-snapshot"]` marker (`events.rs:359-382`).
8. **Broadcast mentions** (`@all` / `@here` / `@channel` / `@everyone`): **do not exist.**

## 3. Rendering received mentions (OLD BUZZ)

- **Binding.** `resolveMentionProps(tags, profiles, content)` (OB `shared/lib/resolveMentionNames.ts:85-167`):
  - It uses only the keys that appear in `p` / `mention` tags (or only the snapshot's `mention` tags when `buzz:mention-snapshot` is present).
  - A tagged key can be matched by any of its aliases (`collectProfileAliases`, `:40-65`): kind-0 `display_name`, kind-0 `name`, and the NIP-05 local part (except `_`).
  - A qualified `@Name (hex)` binds only when that hex is tagged.
  - **An alias shared by several tagged keys is recognised but unbound**, so it renders as plain text.
  - The text is never an authority to add identities.
- **Parser.** `remarkMentions` inside react-markdown (after GFM). The pattern
  `@(?:<known names, longest first>)(?=[\s,;.!?:)\]}]|$)` (`mentionPattern.ts:24-59`) **never matches
  when no names are known**, so an arbitrary `@word` is never highlighted.
- **Code, links, emails.** `link`, `code` and `inlineCode` nodes are skipped (`createRemarkPrefixPlugin.ts:62-66`).
  Emails are protected only when GFM autolinks them. The render regex has *no* leading boundary
  (the send-side one does).
- **Component.** `MarkdownMention` (OB `shared/ui/markdown/MarkdownMention.tsx`) renders one `InlineChip` for **both**
  humans and agents:
  - Attributes: `data-mention-kind=agent|human`, `data-mention-pubkey`, `aria-label`.
  - Icon: an at-sign for humans, a bot for agents, plus `AgentManagementMarker` on agents.
  - An unbound occurrence renders as plain text.
- **Style** (`shared/styles/globals/markdown.css:84-88,301-304`):
  - Background `hsl(var(--primary) / .15)`, text `hsl(var(--primary))`.
  - Hover: background `/ .25`.
  - The accent token is shared by light and dark themes.
- **Self-mention.** No distinct highlight for "mentions me".

## 4. Hover / click (OLD BUZZ)

The chip is wrapped in `UserProfilePopover` (OB `features/profile/ui/UserProfilePopover.tsx:128-237`), the
same popover used elsewhere, with `role="bot"` for agents.
- **Hover** opens the popover after the default hover delay.
- **Click / Enter / Space** runs `openProfilePanel(pubkey)`, the same side profile panel used everywhere.
- Only a *bound* chip is interactive; an unresolved one gets no pointer cursor.

## 5. Channel references `#channel` (OLD BUZZ)

Supported as **text only**:
- `useChannelLinks.ts` uses the `#` trigger with a 120 ms debounce, a substring filter, no DMs or archived channels, and max 8 results.
- It inserts `#name `.
- `remarkChannelLinks` renders a `ChannelReferenceChip` that navigates to the channel.
- **No tag is added** (`events.rs` builders add none).

It is a separate feature from identity mentions.

## 6. Notifications / Inbox (OLD BUZZ)

- **Detection.** p-tag only: `hasMentionForEvent` (OB `features/notifications/lib/shouldNotify.ts:7-17`).
- **Inbox.** Tauri `get_feed` queries kinds `[9, 40002, 1, 45001, 45003, git…]` with `"#p":[me]`, and the result is shown as
  category `mention` (OBT `commands/messages.rs:49-165`, OB `features/home/lib/inbox.ts:486-503`).
- **Desktop notifications.**
  - Title: "{sender} mentioned you" (`notificationFormat.ts:96-100`).
  - A mention notifies even in muted channels (`use-feed-desktop-notifications.ts:131-222`).
  - Live thread-reply alerts skip p-tagged events to avoid double notification.
- **Click-through.** The target carries `eventId` and `threadRootId`, and `activateDesktopNotificationTarget` → `openSearchHit`
  opens the channel and the thread.

## 7. Threads (OLD BUZZ)

- The thread composer is the same `MessageComposer`, with the same extraction. Replies add NIP-10 `e` tags.
- The human root author is **not** automatically p-tagged.
- Agents p-tagged on the root join a persistent "agent audience" when "Automatically mention agents" is on.
- DM threads refuse to mention agents who are not already participants.
- Rendering does not depend on whether the mentioned person replied. It depends only on the event's tags.

## 8. Agents as identities (OLD BUZZ)

An identity is an agent when **any** of these holds:
- kind-0 has exactly one valid NIP-OA `auth` tag
- its channel member role is `bot`
- it is a managed agent
- it is in the relay agent directory (`OBT nostr_convert.rs:64-105`, `commands/channels.rs:197-207`, `agentAutocompleteEligibility.ts:197-224`)

The only visible differences are icon, avatar shape and meta line. Everything else is the shared human path.

---

## 9. SWF Buzz today

| Area | SWF Buzz now | Source |
|---|---|---|
| Stack | Vue 3 + Pinia + Vue Query. CSS custom-property tokens with `html[data-color-scheme]` / `[data-theme]` / `[data-accent]` overrides. Vitest + @vue/test-utils | `app/theme/tokens.css`, `app/theme/appearance.css` |
| Composer | Plain `<textarea>`. Detects a trailing `@[A-Za-z0-9_-]*` **only at the end of the draft**. Substring filter, 6 results. **Mouse-only picking**: Enter is swallowed while the list is open, no ↑/↓/Tab/Esc. Inserts `@DisplayName `. Pubkeys kept if `content.includes('@'+name)` | SWF `components/MessageComposer.vue:88-176` |
| Candidates | Channel: channel members only (`useMentionCandidates`). DM: the single other participant. **Thread panel, Inbox reply: none.** Edit: none | `features/agents/useMentionCandidates.ts`, `views/ChannelsView.vue:242`, `views/DmView.vue:99`, `components/ThreadPanel.vue:104`, `features/inbox/ui/InboxDetailPane.vue:121` |
| Wire format | kind:9, `["h", id]`, reply `["p", parentAuthor]`, then `["p", m]` per mention. **No dedupe, sender not removed, no cap** | SWF `protocol/messages.ts:31-65` |
| Retry | Channel retry **drops mentions and attachments** (DM retry keeps them) | `views/ChannelsView.vue:252-263` |
| Parse | `mentions = all p tags`. This includes the reply-notify p-tag | `protocol/messages.ts:154` |
| Render | `{{ displayContent }}` plain text. **No mention UI anywhere**; `message.mentions` is never used in rendering | `components/MessageItem.vue:239-240` |
| Hover / click | No mention interaction. The profile drawer exists (`ui.openProfile(pubkey)` → `UserProfilePanel`) and is used by author avatar/name | `stores/ui.ts:85`, `features/channels/ui/UserProfilePanel.vue` |
| Identity | Canonical reactive profile registry keyed by pubkey (`profileFor`, `isKnownAgent`). Agents = pubkeys named by a kind:30177 `d` tag | `features/profile/profileStore.ts`, `protocol/agents.ts:24-46` |
| Presence | Central Pinia store + `usePresenceOf(pubkey)`. `AvatarCircle` shows the dot when given a pubkey | `stores/presence.ts`, `features/presence/presenceSync.ts:167` |
| Inbox / notifications | Relay `#p=[me]` feed with categories. The client merges and labels "Mentioned in #x". Notifications classify by `message.mentions.includes(me)`. Click-through via `messageId` / `threadRootId` route query. Same model as OLD BUZZ | `protocol/inbox.ts:75-88`, `features/inbox/inboxModel.ts`, `features/notifications/notificationEngine.ts:29-37` |
| Product boundary | A test forbids the literal strings "Poseidon" and "SWF Agent" in `src/`. So `@Poseidon (SWF Agent)` in the UI is the agent's own kind:0 display name, rendered as plain text | `tests/unit/features/productBoundary.spec.ts:55-56` |

## 10. Gaps (SWF vs OLD BUZZ)

1. **G1. No rendered mentions.** `@Name` is indistinguishable from text; there is no hover and no click.
2. **G2. Keyboard selection missing.** ↑/↓, Enter, Tab and Esc do not work.
3. **G3. Detection only at end of draft.** No caret awareness, no multi-word names, `@` after `(`/`[`/`{` not recognised.
4. **G4. No ranking.** Substring order instead of OLD BUZZ group + label score.
5. **G5. Candidates too narrow.** Channel members only. OLD BUZZ also offers community users (as "not in channel") and agents.
6. **G6. No mentions in thread replies or Inbox replies.**
7. **G7. Collisions and ambiguity.** No `Name (hex)` qualification. Two members sharing a display name can both be tagged, or the wrong one picked.
8. **G8. Tags.** No dedupe, sender not excluded, no 50 cap.
9. **G9. Retry drops mentions** in channels.
10. **G10. Safety.** Nothing to protect today because nothing is rendered. The new renderer must not bind `@word` in emails, URLs or code.

## 11. Implementation plan (no protocol changes)

- **Wire.** Keep `["p", hex]` + literal `@Label`. Add sender exclusion, lowercase, dedupe and the 50 cap in `buildMessageEvent`, as in OB `events.rs:67-81`.
- **Pure mention model** `features/mentions/mentionModel.ts`:
  - trigger detection (OB `detectPrefixQuery` rules)
  - ranking (OB `mentionRanking` rules)
  - collision-qualified labels
  - send-side extraction (OB `extractMentionPubkeys` / `mentionBoundaries`, including code masking and the ambiguity error)
  - render-side binding (OB `resolveMentionProps` rules: tag-bound, alias-aware, ambiguity → plain text)
  - content segmentation with a **leading boundary**, and code / URL / email masking
- **One identity directory for mentions** `features/mentions/useMentionDirectory.ts`:
  - Candidates are built from the canonical profile registry + agent registry.
  - Channel scope = channel members first, then community members marked "Not in channel".
  - DM scope = conversation participants.
  - Loaded lazily the first time the picker opens.
  - Replaces `features/agents/useMentionCandidates.ts`.
- **UI.**
  - `MentionPicker.vue`: compact listbox, `AvatarCircle` with presence from the central store, "Agent" / "Member" / "Not in channel" meta.
  - `MentionChip.vue`: one component for humans and agents, with a subtle accent tint, an agent glyph and a hover card.
  - Hover card: avatar, name, presence/Agent, Message + Profile. Message → `useDirectConversation`; Profile → `ui.openProfile`.
  - `MessageContent.vue`: segments the text.
- **Composer.**
  - Caret-aware detection; ↑/↓/Enter/Tab/Esc; `mousedown` selection.
  - Backdrop highlight so a picked mention reads as a token inside the textarea.
  - Ambiguity error surfaced inline.
- **Wiring.** Channel, DM, thread panel and Inbox reply all use the same composer and directory.
- **Not built** (not in OLD BUZZ, or out of scope):
  - `@all` / `@here` (not in OB)
  - `#channel` references (text-only in OB; a separate feature)
  - personas / teams (OB-local concepts SWF does not have)
  - the non-member invite dialog
  - edit mention snapshots
