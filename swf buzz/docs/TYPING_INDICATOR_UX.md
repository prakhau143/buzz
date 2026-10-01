# Typing Indicator — UX

**Date:** 2026-09-29 · **Scope:** presentation only.

The Phase 4F typing transport, store, 5 s expiry and stale-timer fix
(`src/features/presence/useTypingIndicator.ts`, `TypingService`) are **unchanged**.

## Final behavior

```text
[PM][RS][AK]  Prakhar, Rahul and Amit are typing  • • •
```

| Typists | Text |
|---|---|
| 1 | Prakhar is typing |
| 2 | Prakhar and Rahul are typing |
| 3 | Prakhar, Rahul and Amit are typing |
| 4 | Prakhar, Rahul, Amit and Neha are typing |
| 5 | Prakhar, Rahul, Amit, Neha and Vikram are typing |
| 6+ | Prakhar, Rahul, Amit, Neha, Vikram **+1 other / +N others** are typing |

- **Max 5 names and 5 avatars.** Beyond that, a "+N" chip whose tooltip lists the rest by name.
- **Order:** whoever started typing first comes first. The store appends a person on their first
  signal and removes them only on expiry, so repeated events never reshuffle the list. The
  component keeps that order.
- **Names and avatars:** from the canonical profile cache (`useProfileMap`), the same one
  messages, DMs and member lists use.
  - Missing name → the shortened key.
  - Missing picture → initials.
  - No private material is ever displayed.
- **Avatar hover and keyboard focus:** a tooltip with the name and presence (from the shared
  presence store). No new profile system.

## Layout and overflow

- **Superseded (see `TYPING_INDICATOR_LAYOUT_FIX.md`):** the strip used to reserve 36px permanently, which left an empty gap above the composer. It is now **0px while nobody is typing** and opens to about 40px only while someone is.
- **Narrow widths:** a CSS container query (strip ≤ 460 px) switches to the compact sentence:
  "Prakhar, Rahul +3 others are typing". The text truncates with an ellipsis, and nothing
  overflows horizontally.

## Animation

- **Dots:** three accent-coloured dots pulsing in sequence (1.1 s loop, 0.18 s stagger,
  opacity plus 2 px lift).
- **Entry:** fade and slide up 4 px, 180 ms. **Exit:** fade and slide up 3 px, 180 ms.
- **New avatar:** a one-off 180 ms settle (scale 0.94 → 1). Nothing loops on avatars.
- **`prefers-reduced-motion: reduce`:** no dot loop (static dots), no avatar settle, no
  entry/exit transition.

## Visual

- A compact pill, not a banner: 1 px low-contrast border, 10 px radius, translucent surface with
  a light blur, muted 12 px text.
- Avatars are 22 px, overlapping 6 px with a 2 px surface ring. 8 px was tried first but clipped
  the initials.

## Accessibility

- **Screen readers:** a visually hidden `role=status aria-live=polite` region announces only
  meaningful state: names for 1–2 people, "N people are typing" beyond that, and nothing when
  empty. The animated text and dots are `aria-hidden`.
- **Keyboard:** avatars and "+N" are focusable (`tabindex=0`), with `aria-label`s and a visible
  focus ring.

## Where

The single `src/components/TypingIndicator.vue` is used by channels (`ChannelsView`) and DMs
(`DmView`). Typing isn't wired into the thread panel today, so there's nothing to show there.

## Files

- `src/components/TypingIndicator.vue` (rewritten)
- `src/features/presence/typingLabel.ts` (new: wording rules)
- `tests/unit/components/typingIndicator.spec.ts` (new)

## Tests (`typingIndicator.spec.ts`, 16)

- Wording for 1, 2, 3, 4, 5, 6 and 10 typists.
- Compact form: 2 names, and "+1 other" / "+3 others".
- Announcements: names for 1–2, a count beyond, empty when none.
- Strip collapsed (0fr) when empty; opens on the first typist; collapses on the last.
- Real names instead of "2 people".
- Avatars capped at 5, with the "+N" tooltip naming the rest.
- Stable order when events repeat.
- Expiry removes a person; the last one leaving empties it.
- Unknown name → shortened key.
- Avatars focusable, with a name tooltip.

## Visual QA

The real component was rendered through a temporary harness (headless Edge, then deleted), with
1, 3 and 8 typists:
- **Wide (1440 px):** the full sentence and "+3 others".
- **Container widths 320 / 390 / 768 px:** 320 and 390 switch to the compact sentence with an
  ellipsis and no overflow. 768 shows all 5 names. The composer position is identical in every
  row.
- **Dark theme: not applicable.** SWF has no dark palette yet (`tokens.css`). Only tokens are used.
- **Not verified:** the animation itself (screenshots are static), and a live multi-person
  typing session in the Tauri app.
