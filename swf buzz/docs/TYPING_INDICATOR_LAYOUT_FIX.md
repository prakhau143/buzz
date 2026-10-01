# Typing Indicator — Zero-Gap Layout Fix

**Date:** 2026-09-29 · **Scope:** layout only. The Phase 4F typing transport, store, 5 s expiry
and the premium UI (names, avatars, "+N others", dots) are unchanged.

## Root cause (measured, not guessed)

The typing indicator's own wrapper reserved space:

```css
/* src/components/TypingIndicator.vue — before */
.typing-strip { min-height: 36px; display: flex; padding: 0 var(--space-3); … }
```

That rule was added deliberately in the earlier typing UX pass ("the composer never moves"). It
left a 36px blank band between the last message and the composer whenever nobody was typing.

Nothing else contributes to the gap:
- The message list's `padding: var(--space-3) 0` is ordinary list spacing, 12px.
- The composer has only `border-top` and its own inner padding.
- There are no margins between the siblings.

## Layout (unchanged structure, one fix)

```text
.channel-main / DM main   flex column, height 100%, min-height 0
├── header                flex-shrink 0
├── MessageList           flex 1, min-height 0, overflow-y auto   ← the only flexible region
├── TypingIndicator       flex 0 0 auto   ← 0px idle, ~40px while typing
└── MessageComposer       flex-shrink 0   ← pinned to the bottom
```

**Collapsed = exactly 0.**
- The strip is a one-row grid at `grid-template-rows: 0fr`. Its only child (`.typing-clip`) has `min-height: 0; overflow: hidden`.
- The strip itself has no `min-height`, `height`, `padding` or `margin`.
- The live region is `position: absolute`.
- The pill's vertical room (4px each side) is a margin *inside* the clip, so it collapses with it.

**Open.**
- `.open` switches the row to `1fr`, the pill's natural height, which is 40px measured.
- Visibility comes from one derived value: `active = pubkeys.length > 0`, taken from the unchanged typing store.

**Motion.**
- The row animates 0fr ⇄ 1fr over 180ms, and the pill fades and slides 4px (existing).
- Only the dots loop.
- With `prefers-reduced-motion: reduce`, the switch is instant.

**No hacks:** no negative margins, no transforms for layout, no absolute positioning, no `visibility: hidden`. A test guards against these.

## Bottom anchoring

`MessageList`'s ResizeObserver used to watch only the *content*. When the viewport shrinks (typing starts, or the composer grows a line), a reader at the bottom would have lost the last line under the strip. It now also observes the scroll viewport:
- **A reader at the bottom** stays at the bottom.
- **A reader in history** is never moved. The existing `isNearBottom` rule is unchanged.

## Measured (real Chromium, `getBoundingClientRect`, 1280×800, 30 messages)

| State | Strip height | Last message bottom | List bottom | Composer top | Distance from bottom |
|---|---|---|---|---|---|
| Nobody typing | **0** | 632 | 644 | 644 | 0 |
| 2 typing | **40** | 592 | 604 | 644 | 0 (anchored) |
| Stopped | **0** | 632 | 644 | 644 | 0 |

- **Composer top = list bottom** when idle, so there's no gap. The 12px between the last message and the list bottom is the list's normal padding.
- **No horizontal overflow** in any state.
- **The table was measured with transitions disabled.** In headless dump-DOM mode no frames are rendered, so the transition sat at `currentTime 0` and never advanced. Screenshots, which do render frames, confirm the animated path: 0 idle, and the open strip directly above the composer.

## Where

- **Channels** (public and private) and **DMs** use the same `TypingIndicator` component, so both get the fix.
- **Threads** have no typing indicator (typing isn't wired into the thread panel), so there is nothing to collapse and no gap there.
- **Horizontal panels** (sidebar, thread, expanded thread) are unaffected. This change is vertical only and inside the conversation column.

## Tests

`tests/unit/components/typingIndicator.spec.ts`:
- **Existing tests** still pass: 1/2/3/4/5/6/10 wording, the "+N" chip, the 5-avatar cap, stable order, expiry, announcements.
- **New tests:**
  - idle is collapsed (no `open`, `data-visible=false`, no indicator, silent);
  - the first typist opens it and the last one leaving collapses it;
  - a CSS guard: the strip has a 0fr row and no min-height/height/padding/margin, and the clip has `min-height: 0; overflow: hidden`;
  - no negative-margin hacks;
  - reduced motion is instant;
  - the live region is absolutely positioned;
  - MessageList observes its viewport, which keeps a bottom reader anchored.

**Gates:**
- `npm run typecheck`, `npm run lint`, `npm run build`: PASS.
- Full unit suite: **1351 / 1351**.
- `cargo check` and `cargo test`: 88 / 88.

## Manual QA

- **Done:** the real `MessageList` + `TypingIndicator` + `MessageComposer` were rendered in the channel view's flex column in headless Edge (temporary harness, deleted): the idle and typing screenshots, plus the measurements above.
- **Not yet done:** a live two-person typing session in the Tauri window. The running dev app has the change through hot reload.
