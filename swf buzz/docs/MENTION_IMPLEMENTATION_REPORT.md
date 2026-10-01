# Mention Implementation Report

Date: 2026-09-29 · Audit: `docs/OLD_BUZZ_MENTION_AUDIT.md` · Protocol source of truth: OLD BUZZ.

**One mention system for every community identity.** The same model, directory, picker, chip
and hover card serve people and agents. "Agent" is identity metadata only: a small bot glyph
and an "Agent" label. The wire format is unchanged from OLD BUZZ: literal `@Label` in the
content plus a plain `["p", <hex>]` tag.

---

## 1. Files

**New: `src/features/mentions/`**

| File | Role |
|---|---|
| `mentionModel.ts` | Pure rules, each citing its OLD BUZZ source: trigger detection, ranking, collision-qualified labels, code/URL masking, occurrence matching, send-side extraction (with ambiguity refusal), `p` normalisation, render-side binding, segmentation, profile aliases |
| `useMentionDirectory.ts` | The single identity source for the picker. Built on the canonical profile registry + presence store; channel / DM scopes; lazy |
| `MentionPicker.vue` | Compact ARIA listbox: avatar, presence, name, "Member / Agent / Not in channel" |
| `MentionChip.vue` | THE rendered mention, for everyone. Click / Enter / Space opens the profile drawer; hover opens the card |
| `MentionHoverCard.vue` | Preview of the existing profile system: avatar, name, presence or "Agent", **Message** and **Profile** actions |
| `MessageContent.ts` | Splits message text into text runs and `MentionChip`s |

**Changed**

| File | Change |
|---|---|
| `components/MessageComposer.vue` | Caret-aware trigger. ↑/↓ wrap; Enter and Tab select; Esc closes the picker (and only the picker). Mouse selection. ARIA combobox. Picked mentions tinted behind the textarea as tokens. Label→pubkey bindings. Ambiguity error. New `mentionScope` prop |
| `components/MessageItem.vue` | Content rendered through `MessageContent` |
| `components/ThreadPanel.vue` | Reply composer gets a mention scope (the parent view's, or the channel's) |
| `features/inbox/ui/InboxDetailPane.vue` | Reply composer gets a mention scope (DM → participants only) |
| `views/ChannelsView.vue` | Channel scope for feed + thread. **Retry now keeps mentions and attachments** |
| `views/DmView.vue` | DM scope (participants) for conversation + thread |
| `protocol/messages.ts` | `p` tags: lowercase, deduplicated (a mentioned parent author is one tag), capped at 50 — OLD BUZZ `events.rs` `mention_tags` |
| `components/AppIcon.vue` | `bot` glyph (ASCII path data, like every icon there) |
| `app/theme/tokens.css` | `--color-mention-text`, `--color-mention-bg`, `--color-mention-bg-hover` |
| `docs/ARCHITECTURE.md`, `docs/KNOWN_LIMITATIONS.md` | Updated references |

**Removed:** `features/agents/useMentionCandidates.ts`, the agent-flavoured candidate builder,
now replaced by the community directory.

## 2. Identity architecture

```
kind:0 (any community / live / cache) ─► profileStore (canonical, pubkey-keyed, newest wins)
kind:30177 agent registry ───────────────► profileStore.markAgents  (isAgent = metadata)
presence events ─────────────────────────► presence store (usePresenceOf)
                                            │
          ┌──────────────────────┬──────────┴───────────┬────────────────────┐
   useMentionDirectory     MessageContent        MentionHoverCard       (existing) sidebar,
   (picker candidates)     (alias binding)       (useProfile, presence)  author, drawer, lists
```

- **No new identity store.** The registry was already the single source for the sidebar,
  message author, profile drawer and member lists. Mentions now read from it too, so a name,
  avatar, agent flag or presence dot matches everywhere.
- **Identity key:** always the pubkey. Display names are only labels. Rendering binds a label
  to a pubkey **only if that pubkey is p-tagged on the event**, and a label shared by two
  tagged pubkeys is left as plain text.

## 3. Data flow

```
type "@dev"   → detectMentionQuery (caret, boundaries, multi-word)
              → useMentionDirectory activates once (cached member + community rosters,
                one batched profile fetch for unknowns)
              → rankMentionCandidates (members → people → agents; exact → prefix → word)
↑/↓ Enter/Tab → mentionLabelFor (Name, or "Name (<hex>)" on a collision) → "@Label " inserted,
                bindings[Label] = pubkey, token tint drawn behind the textarea
send          → extractMentionPubkeys (picked labels still present + typed exact member
                names; code/URL/email-safe; ambiguous typed name → refused with message)
              → normalizeMentionPubkeys → emit → buildMessageEvent: kind 9, ["h"], ["p"…]
receive/load  → parseMessageEvent: mentions = p tags
render        → MessageContent: resolveMentionBindings(p tags × profile aliases)
              → segmentMentions → MentionChip (same component for all)
hover / click → MentionHoverCard (Message → find-or-create DM, Profile → ui.openProfile)
              / ui.openProfile(pubkey) → UserProfilePanel
inbox / notif → unchanged: relay #p=[me] feed, notificationEngine (already p-tag based)
```

## 4. Protocol compatibility

- **Written:** kind 9 (and kind 9 DMs through `Kind41010Transport`) with `["p", lowercase-hex]`
  tags, deduplicated and at most 50. Content carries `@Label`. This is exactly what OLD BUZZ writes.
- **Not written:** no `nostr:` URIs, no new tags or kinds, no `@all` / `@here`. None of these exist in OLD BUZZ.
- **Qualified labels** `Name (<64-hex>)` are OLD BUZZ's own collision format, so OLD BUZZ
  renders SWF collisions correctly and vice versa.
- **Rendering OLD BUZZ messages:** the binding rule and alias set are OLD BUZZ's, so OLD BUZZ
  history renders with the same chips. The `mention` reference tag and the `buzz:mention-snapshot`
  edit marker are **not** read (see Remaining limitations).

## 5. Behaviour

- **People and agents.** Same picker row, same chip, same card, same drawer. An agent shows
  "Agent" in the picker and card and a small bot glyph in the chip. In the composer, agents are
  ranked after people who are not in the channel, as in OLD BUZZ.
- **Channel scope.** Channel members first, then the rest of the community, labelled
  "Not in channel". A *typed* (not picked) name binds only for channel members.
- **DM scope.** Participants only.
- **Threads.** The root and replies render through `MessageItem → MessageContent`; the reply
  composer has the same picker. A mention renders from the event's own tags, so it looks the
  same whether or not the person ever replied, after reload, and in old history.
- **Inbox / activity.** No change was needed. The Inbox already asks the relay for `#p=[me]`,
  labels "Mentioned in #x", and opens the channel, message and thread from the route query.
  Mentions now also render as chips inside the Inbox detail pane and are available in its
  reply box.
- **Channel mentions `#channel`.** Not implemented. In OLD BUZZ these are a separate,
  text-only channel-link feature with no tag, not an identity mention (audit §5).

## 6. UX, accessibility, theming

- **Picker.** 320 px max, rounded, `--shadow-md`, 24 px avatars with presence dots, highlight = mention tint + a
  2 px accent rail. It is announced as a listbox; the textarea is a `combobox` with
  `aria-activedescendant`, so screen readers follow the arrow keys.
- **Chip** (updated in §8a).
  - Look: weight 600, accent tint + 1 px accent border, 6 px radius, `display: inline`. Tint and border repeat across a line wrap.
  - Interaction: pointer cursor; hover strengthens tint and border; visible `:focus-visible` ring.
  - Accessibility: keyboard focusable (Enter/Space open the profile), with an `aria-label` ("Scout (Support Agent), agent, open profile").
  - Weight, tint and border mark it, so it does not rely on colour alone.
- **Theme.** The tokens are derived from `--color-primary` mixed toward `--color-text`, so the
  text is darker than the accent on light surfaces and lighter on dark ones, for every theme
  and accent. Nothing is hard-coded.
- **Motion.** 120 ms fades only, turned off under `prefers-reduced-motion`. No glow, no large
  cards, no heavy shadows.

## 7. Performance

- Nothing loads until the first `@`.
- After that, the rosters use the existing cached query keys (`members`, `relayMembers`), and
  there is one batched profile request for any pubkeys not yet in the registry.
- Each keystroke filters in memory; there is no request per character.
- The renderer only looks up pubkeys when the text contains `@`, and fetches only the tagged
  pubkeys that are missing from the registry, in one batch.

## 8. Tests executed

New tests:
- `tests/unit/features/mentions/mentionModel.spec.ts`: detection (email, caret, multi-word,
  newline), ranking, labels, masking (email / URL / inline and fenced code), extraction
  (picked, typed, non-member, ambiguity, collision, email), normalisation, render binding
  (untagged, alias, collision, qualified, email/URL, punctuation / line breaks), aliases.
- `tests/unit/components/messageComposerMentions.spec.ts`:
  - picker opens on `@`; people and agents appear together; filtering; no picker inside an email
  - ↑/↓ wrap, Enter / Tab select, Esc closes, mouse selection, ARIA combobox
  - presence dot comes from the presence store
  - sent pubkeys: a mention edited away is dropped, a name collision is qualified, an ambiguous typed name is refused, an email address sends no mention
  - picked mentions are drawn as tokens
- `tests/unit/components/messageContentMentions.spec.ts`:
  - people and agents render through the same chip
  - an untagged name stays plain text
  - rendering is event-only (re-render gives the same result)
  - a collision never binds the wrong person
  - emails and URLs never become chips
  - click and Enter open the profile drawer
  - hover card shows presence and the Profile action; agent card says "Agent"
  - wiring guard: every surface uses the one renderer and every composer passes a mention scope
- `tests/unit/protocol/messages.spec.ts`: `p` dedupe / lowercase / parent-author merge, and the 50 cap.

Results (2026-09-30):
- `vue-tsc --noEmit`: clean.
- `eslint . --max-warnings 0`: clean.
- `vitest run`: **134 files, 1417 tests, all passing.** The baseline before this work was 131 files, 1362 tests.
  - The full run reported 4 failures in `tests/unit/features/layout/threadExpanded.spec.ts`: its `ThreadPanel` mount had no Vue Query client, and the thread composer now reads the mention directory.
  - That spec was changed during the run (a VueQueryPlugin was added to its mount); this work did not make that change.
  - Re-run on its own after the change, it passes 20/20.

Coverage of the requested checklist:
- **Covered by these tests:** 1–5, 11–20. 6–9 are covered as event-only rendering: live, reloaded, historical and thread messages all go through the same pure function.
- **By construction:** 10 (DM uses the same composer / renderer; the DM scope is not separately component-tested).
- **Not automated here:** 21–22 (dark / light theme, token-derived), 23 (Inbox is unchanged and covered by the existing inbox and notification specs), 24–25 (logout / restart: the profile store is cleared per identity and rendering depends only on the event).

**Not verified in a running app.** No live relay or Tauri build was exercised in this session.

## 8a. Visual pass (2026-09-30)

Architecture, protocol, parser, directory, picker behaviour and notifications are **unchanged**.
Only the rendering layer changed.

### Why the screenshot showed no highlight

- The installed desktop app (`%LOCALAPPDATA%\SWF Buzz\swf-buzz.exe`, 2026-09-29 18:13)
  bundles `dist/`. `tauri.conf.json` sets `frontendDist: ../dist` and
  `beforeBuildCommand: npm run build`.
- `dist/` was last built at **17:39**. Every mention source file was written after that
  (18:08–18:28).
- So that app shipped **without `MentionChip` at all**, and any `@Name` in it is plain message
  text. No stale CSS or specificity problem was involved.
- The local relay (`ws://localhost:3000`, 3,595 events) contains no "Poseidon" or agent
  profile/message. The screenshot came from a different community.

**To see mentions in the desktop app, it must be rebuilt** (`npm run tauri build`, or
`npm run tauri dev`) from the current source.

### What changed visually

| | Before | Now |
|---|---|---|
| Chip | weight 500, 11% tint, no border, 4 px radius, `padding 0 3px` | weight **600**, **12%** tint (light) / **17%** (dark), **1 px accent border** 24% / 32%, **6 px** radius, `padding 1px 5px`, still `display: inline` |
| Hover | 20% tint | 19% / 26% tint, border 38% / 48%, 120 ms colour transition, no size change |
| Agent | glyph 11 px, chip text = full display name | glyph 12 px, 75% opacity. Chip text drops a trailing role parenthetical (`Scout (Support Agent)` → `@Scout` + glyph). Full name kept in `title` / `aria-label`. Display only; wire unchanged |
| aria-label | "Agent Scout, open profile" | "Scout (Support Agent), agent, open profile" / "Devankit, member, open profile" |
| Hover card | "Agent · Online" | bot glyph + "Agent · Online" |
| Composer token | stronger tint only | same `--color-mention-bg` + 1 px inset border as the sent chip. No padding, so textarea text stays aligned |
| Avatar initials | "Scout (Support Agent)" → "S(" | parenthetical ignored → "S" (every avatar) |

**Tokens.**
- `--color-mention-{text,bg,bg-hover,border,border-hover}` in `tokens.css`, with
  dark-scheme overrides in `appearance.css` under `html[data-color-scheme="dark"]`.
- All are `color-mix()` of `--color-primary`, which `[data-accent]` / `[data-color-scheme]`
  set on `<html>`. So an Appearance change restyles every mention immediately, with no
  reload and no separate mention setting.

### Browser verification: what was actually done

**Setup.**
- The dev server (`npm run dev`) was driven in **headless Chrome over the DevTools
  Protocol**. The Claude-in-Chrome extension was not connected.
- The app's browser mode no longer allows sign-in ("identity is held by the desktop app").
  So the *real* `MessageItem`, `MessageContent`, `MentionChip`, `MentionHoverCard` and
  `MessageComposer`, with the real `tokens.css` + `appearance.css`, were mounted on a
  temporary harness page with seeded profiles.
- The harness was deleted afterwards.

**Measured with `getComputedStyle`:**
- **Tokens reach the DOM.** The chip is a `SPAN.mention-chip`, weight 600, 6 px radius,
  `padding 1px 5px`, cursor pointer, and resolves the accent-derived colours.
- **Contrast.** Mention text on its tint was measured for **all 49 theme × accent combinations**
  (swf-light, paper, sky, swf-dark, midnight, graphite, ocean × terracotta, indigo,
  emerald, violet, rose, amber, cyan). **Minimum 4.66:1** (swf-light/amber), so every
  combination passes WCAG AA for normal text.
- **People and agents.** They share the identical computed background and colour in every combination.
- **No layout shift.** A one-line message with a mention is exactly one `line-height` tall (21 px).
- **No overflow.** No horizontal page overflow at 1400 px or 430 px.

**Seen in screenshots:**
- light / terracotta
- light / emerald (green)
- swf-dark / indigo (blue)
- graphite / violet (purple)
- swf-dark / amber (orange)
- hover state with the card
- keyboard focus ring (2 px accent outline, `:focus-visible`)
- picker open with arrow highlight
- composer tokens
- a long name wrapping over two lines, with tint and border repeated on each fragment
- the negative cases: email, URL, inline code and an untagged `@Sandeep` stayed plain text
- all wording cases: `Hello @X please…`, `@X,`, `…ask @X to…`, `@X please`, trailing `@X`, `@X @Y`

**Known visual nit.** When a *single very long* name is broken mid-word, the first fragment's
cloned right padding can extend ~3 px past the paragraph box. Chrome's line breaker does not
count the cloned padding. It stays inside the row's 16 px padding and causes no page overflow.
Switching to `inline-block` would avoid it but would grow line boxes, so `inline` was kept.

### Not verified (and why)

The following were **not** done in a live community or the Tauri app:
- sending real messages, reload/history, thread, DM and Inbox
- live accent switching in Settings, and the profile drawer opening

Two things prevent it here:
- Browser mode cannot sign in.
- The installed SWF Buzz is running; with the single-instance plugin, a `tauri dev` build would hand off to it. Closing it is the user's call.

Thread, DM and Inbox use the same `MessageItem → MessageContent → MentionChip` path (wiring
test in `messageContentMentions.spec.ts`), so they get the identical chip by construction.
They were not visually checked live.

### Real desktop app verification (2026-09-30)

**Build and install.**
1. `npm run build` → fresh `dist/` (10:26), confirmed to contain `mention-chip` and
   `--color-mention-border`.
2. `npm run tauri build` (24 min) produced the MSI and the NSIS
   `SWF Buzz_0.1.0_x64-setup.exe`.
3. The old SWF Buzz process was closed (verified not running).
4. NSIS installed silently (exit 0). `%LOCALAPPDATA%\SWF Buzz\swf-buzz.exe` is now 2026-09-30 11:01.
5. The **installed** app was launched with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`.
   Its real WebView2 DOM was inspected over CDP.

**Real community.** `wss://buzz.lmdconsulting.com` → **SWF Project**, signed in as Prakhar Mittal
(the existing identity). The results below are read from the live DOM.

| Check | Result |
|---|---|
| `.mention-chip` exists | **Yes: 46 chips across 50 loaded messages**, including `@Poseidon (SWF Agent)`, `@Devankit`, `@Binod`, `@Sandeep Singh`, `@Prakhar Mittal` |
| Computed style | weight 600, `border 1px solid` accent 24%, bg accent 12% (light), 6 px radius, `padding 1px 5px`, `display: inline`, `box-decoration-break: clone` |
| Historical / reloaded | Messages 16–19 h old render as chips. After a WebView reload and re-entering the community, 46 chips again |
| False positives | `@Vimal sharma` stays plain text. That event's only `p` tag is Devankit's, so this is correct per the tag-bound rule |
| Thread | Opened the "4 replies" thread. The root `@Poseidon (SWF Agent)` and the replies' `@Devankit` / `@Poseidon` all render with the identical chip style |
| Hover | `MentionHoverCard` opens: "Poseidon (SWF Agent) · Online", Message / Profile |
| Click | The existing profile drawer opens ("Poseidon (SWF Agent)") |
| Keyboard | Focus shows a 2 px accent `:focus-visible` ring. **Enter** opens the profile drawer |
| Appearance | Changed via **Settings → Appearance** UI: Light and Dark × indigo / emerald / violet / amber / terracotta. For each, the mention's computed text, background and border took the new accent on returning to the channel, with **no page reload** (navigation timing unchanged). Dark uses the 17% / 32% values. The user's original prefs (light / swf-light / terracotta) were restored afterwards and verified in storage |
| DM | All 6 DMs were opened. **None contains a mention in its history**, so there was nothing to render. Not verified live |

### Finding: Poseidon is not recognised as an agent anywhere in SWF

This is not a mention bug.
- Every live chip is `data-mention-kind="human"`, so Poseidon's chip shows no bot glyph and
  keeps "(SWF Agent)" in its text.
- Poseidon's own messages show **no "Agent" author badge** either.

The live data:
- kind:0 `display_name = "Poseidon (SWF Agent)"`, `about = "AI agent on Buzz"`.
- Channel role `member`, not `bot`.
- SWF's `isAgent` is `false`.

How the two clients decide who is an agent:
- **SWF** only knows an agent from a kind:30177 registry entry (`protocol/agents.ts`).
- **OLD BUZZ** also accepts:
  - a valid NIP-OA `auth` tag on the kind:0 (`nostr_convert.rs:64-105`)
  - channel role `bot`
  - its relay agent directory

  It most likely recognises Poseidon through the NIP-OA tag. That could not be confirmed:
  the relay requires NIP-42 auth to read, and signing with the user's identity was not done.

Fixing it means extending agent detection, an identity/agent-registry change outside this
mention task, so it was **not** implemented. When fixed, the existing chip will automatically
show `@Poseidon` + bot glyph, and the card and badge will show "Agent".

**Screenshots** of the installed app, real community, taken over CDP:
- `docs/assets/mentions/installed-app-channel-light.png`
- `docs/assets/mentions/installed-app-channel-dark.png`
- `docs/assets/mentions/installed-app-thread.png`
- `docs/assets/mentions/installed-app-hover-card.png`

They show existing real messages. No test messages were sent.

### Cleanup (2026-09-30)

- The installed SWF Buzz was closed. `Get-Process swf-buzz` returns nothing.
- Port 9334 is closed:
  - `Get-NetTCPConnection -LocalPort 9334` returns nothing.
  - No `msedgewebview2` process has 9334 on its command line.
- The debug port only existed for that launch, through a per-process environment variable. A normal launch of SWF Buzz has no debug port.
- The headless Chrome (9333) and Vite dev server (1420) used for the harness pass are stopped. The harness files were deleted.

By decision:
- No real test messages or DMs were sent.
- NIP-OA agent detection was not changed.

### Files changed by the mention task

- **New:**
  - `src/features/mentions/`: `mentionModel.ts`, `useMentionDirectory.ts`, `MentionPicker.vue`, `MentionChip.vue`, `MentionHoverCard.vue`, `MessageContent.ts`
  - Tests: `tests/unit/features/mentions/mentionModel.spec.ts`, `tests/unit/components/messageComposerMentions.spec.ts`, `tests/unit/components/messageContentMentions.spec.ts`, `tests/unit/components/avatarCircleInitials.spec.ts`
  - Docs: `docs/OLD_BUZZ_MENTION_AUDIT.md`, this report, `docs/assets/mentions/*.png`
- **Modified:**
  - `src/components/`: `MessageComposer.vue`, `MessageItem.vue`, `ThreadPanel.vue`, `AppIcon.vue` (bot glyph), `AvatarCircle.vue` (initials)
  - `src/features/inbox/ui/InboxDetailPane.vue`
  - `src/views/`: `ChannelsView.vue`, `DmView.vue`
  - `src/protocol/messages.ts` (`p` dedupe/lowercase/cap)
  - `src/app/theme/`: `tokens.css`, `appearance.css`
  - `tests/unit/protocol/messages.spec.ts`
  - `docs/ARCHITECTURE.md`, `docs/KNOWN_LIMITATIONS.md`
- **Deleted:** `src/features/agents/useMentionCandidates.ts`.
- **Not by this task:** `tests/unit/features/layout/threadExpanded.spec.ts` gained a VueQueryPlugin during the session from another source.

**Commit caution.**
- The repo's last commit is `123be8d` (2026-09-18).
- Most of the working tree is uncommitted work that predates this task: roughly 130 modified/deleted and many untracked files.
- Several files this task touched were already modified or untracked before it. That includes `MessageComposer.vue`, `MessageItem.vue`, `tokens.css`, the untracked `appearance.css`, `AppIcon.vue` and the untracked `src/features/inbox/`.
- The mention code also depends on untracked modules: the profile store, presence, `AppIcon`, the inbox.
- So a mention-only commit cannot be separated cleanly by file; it needs hunk-level staging or a decision to commit the accumulated work together.

### Not done (needs the user's go-ahead)

**Sending new real messages** was not done: "Hi @Devankit please check this.",
"@Poseidon please check this.", and a DM mention. These are posted to colleagues in a real
community, notify Devankit, and would trigger Poseidon to act. Fresh-message rendering is
covered by the same event-based path as the 46 live historical chips, but it has not been
exercised live.

### Checks run after this pass (2026-09-30)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | built (`dist/` refreshed from current source) |
| `npm run tauri build` | release built; MSI + NSIS installers produced |
| `vitest run` | **135 files, 1424 tests, all passing** |
| `cargo check` (src-tauri) | clean |
| `cargo test` (src-tauri) | 88 passed, 0 failed |

### Tests added in this pass

- `mentionModel.spec.ts`: agent display-label rule.
- `messageContentMentions.spec.ts`:
  - shared chip base for people and agents; agent-only glyph
  - aria-labels, role and tabindex
  - Space opens the profile
  - multiple mentions each bind correctly
  - token-only styling guard: no literal colours; every mention token defined accent-derived for light *and* dark; `display: inline` + `box-decoration-break`
- `avatarCircleInitials.spec.ts`: parenthetical ignored.

## 9. Remaining limitations

1. **Edits.** The inline edit box has no picker, and edits carry no `buzz:mention-snapshot`.
   An edited message renders mentions from the *original* event's `p` tags, so a mention
   added only in an edit shows as plain text.
2. **OLD BUZZ `["mention", pk]` reference tags** (agent-address tray) are not read.
   p-tagged agents render as normal.
3. **No non-member prompt.** Mentioning someone "not in channel" sends the tag, but there is
   no OLD BUZZ-style "invite or send anyway" dialog. In a private channel that person cannot
   read the message.
4. **Renamed identities.** An old `@OldName` in history renders as plain text once the
   profile no longer answers to that name. OLD BUZZ behaves the same.
5. **Self.** You are not offered in your own picker. OLD BUZZ offers you and then strips
   you at send time; the outcome (no self p-tag) is the same.
6. **Reply notify tag.** SWF still p-tags a reply's parent author (pre-existing behaviour),
   so "reply to me" counts as a mention for notifications. OLD BUZZ does not add that tag.
   This was left unchanged on purpose because it would change Inbox and notification
   semantics.
7. **Channel retry.** Channel retry still passes the retrying author as `parentAuthorPubkey`
   for a failed reply. This is pre-existing and out of scope here.
8. **HTTP-backend views** (`CommunityChannelsView`, `CommunityDmView`) use a separate plain
   input and backend with no mention concept. They are unchanged.
