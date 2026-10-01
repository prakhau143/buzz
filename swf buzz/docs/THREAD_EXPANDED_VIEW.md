# Thread — Expanded View

**Date:** 2026-09-29 · **Scope:** layout, UI state and UX only. Thread data (`useThread`,
`ThreadService`), messages, the composer, read state and the protocol are unchanged: no new
events, no relay changes, no second thread store.

## Modes

```text
DOCKED (default)                         EXPANDED
┌─────────┬────────────────┬─────────┐   ┌─────────┬──────────┬───────────────────────┐
│ sidebar │ conversation   │ thread  │   │ sidebar │ convers. │ thread (expanded)     │
│         │                │         │ → │         │ ≥ 300px  │                       │
└─────────┴────────────────┴─────────┘   └─────────┴──────────┴───────────────────────┘
```

- **State:**
  - `type ThreadViewMode = "docked" | "expanded"` is a getter in `stores/ui.ts`, backed by one boolean, `threadExpanded`.
  - Actions: `setThreadViewMode` and `toggleThreadExpanded`.
  - Only an open thread can be expanded.
  - Opening a profile or channel details, closing the pane, changing channel or DM, and signing out all reset to docked.
  - Switching to another thread while expanded stays expanded.
- **Not a modal.** It's the same AppShell grid and the same details column, just wider:
  - no `position: fixed` on desktop;
  - no backdrop;
  - no `pointer-events: none`;
  - no focus trap.

## Header

```text
[⤢] Thread · #release                              [×]     docked   (⤢ = "Expand thread")
[⤡] Thread · #release                              [×]     expanded (⤡ = "Restore thread")
```

- **The expand/restore button is LEFT of the thread title**, as requested. Close is an icon button on the right.
- **It's one `<button>` element** whose icon and `aria-label` change (Expand ↔ Restore). Because the element doesn't change, focus stays on it after Restore.
- **Tooltip:** "Expand thread (Shift+Ctrl+E)" / "Restore thread (…)".
- **States:** a 30px target, with hover (surface and border), active (scale 0.94) and a visible `:focus-visible` ring. It's accent-coloured while expanded.

## Sizing

The rules are in `features/layout/panelSizing.ts` (`fitExpandedThread`).

| Rule | Value |
|---|---|
| Conversation floor while expanded | `EXPANDED_MAIN_MIN_WIDTH = 300px` (docked floor stays `MAIN_MIN_WIDTH = 360px`) |
| Default split | the conversation gets 28% of the space right of the sidebar, never below 300px; the thread gets the rest |
| Thread min / max | 280px / everything except the conversation floor |
| Tight windows | the sidebar gives way first, never the conversation floor |

| Window (sidebar 260) | Conversation | Thread |
|---|---|---|
| 1710 | 406 | 1044 |
| 1440 | 330 | 850 |
| 1280 | 300 | 720 |

## Resize

- **The same divider** (`PanelResizeHandle`, vertical, `col-resize`, `clientX` only, pointer capture, keyboard) resizes the expanded thread.
  - Dragging left widens it; dragging right narrows it.
  - Arrow keys ±10px (Shift ±50px); Home/End go to the min/max.
- **The docked width is never overwritten.** The expanded width is kept for the session only and is not persisted.
- **Restore** returns to the saved docked width. For example: docked 420 → expand to 850 → drag to 700 → Restore → 420.
- **Double-click** on the divider while expanded resets to the default expanded split. While docked, it resets to the docked default, as before.

## The conversation stays usable

- **It stays visible and scrollable.** Opacity is 0.92, and back to 1 on hover or focus. There's no blur and nothing is disabled.
- **Clicking an empty area** of the conversation restores the docked layout.
- **Meaningful clicks don't collapse the thread:** messages (`[data-message-id]`), links, buttons, inputs, the composer, `[tabindex]`, `[role=button|link|menuitem|textbox]`, labels, and any click that ends a text selection. They just perform their normal action.

## Keyboard

| Key | Action |
|---|---|
| Enter / Space on the button | Expand ↔ Restore (native `<button>`) |
| **Shift+Ctrl+E** (⇧⌘E) | Expand ↔ Restore. Registered in the shortcut registry, so it's listed in Settings → Shortcuts and has no conflicts (tested) |
| Esc | Expanded → docked; docked → close the thread (one step at a time) |
| Divider: ←/→, Shift, Home/End | Resize |

## Animation

- **Only the docked ⇄ expanded switch animates.** The conversation and thread columns and the divider move together from right to left (`grid-template-columns` / `right`, 280ms `cubic-bezier(0.22, 1, 0.36, 1)`).
- **Drags are never animated**, so resizing tracks the pointer 1:1. The transition class is applied for 320ms around a mode switch only.
- **Messages don't animate.** The thread body, its scroll position and the composer are the same component instance in both modes.
- **`prefers-reduced-motion: reduce`:** the switch is instant.

## Responsive

| Width | Behavior |
|---|---|
| > 1024 | In-flow columns, as above, with the resizable divider |
| 769–1024 | The thread is an overlay here (existing behavior). Expanded widens it to `100% − sidebar − 300px` (min 380), or `100% − 300px` with the sidebar hidden, so the conversation stays visible. Not resizable |
| ≤ 768 | The thread is already full-screen. The Expand button is hidden, and an expanded state behaves as full-screen: no overflow |

## Persistence

- **Expanded is never persisted.** Every start is docked.
- **The docked width** (`swf-buzz:layout.details-width.v1`) persists as before.

## Files

- `src/stores/ui.ts`: `ThreadViewMode`, `threadExpanded`, and the actions and resets.
- `src/features/layout/panelSizing.ts`: `EXPANDED_MAIN_MIN_WIDTH`, `EXPANDED_MAIN_SHARE`, `fitExpandedThread`.
- `src/layouts/AppShell.vue`:
  - expanded widths through the one divider;
  - click-to-restore;
  - the switch animation;
  - the muted conversation;
  - the overlay-tier and phone rules.
- `src/components/ThreadPanel.vue`: the header (expand button left of the title, icon Close), Escape and the shortcut.
- `src/components/AppIcon.vue`: `maximize` and `minimize` icons.
- `src/features/shortcuts/shortcutRegistry.ts`: `toggle-thread-expanded`.
- `tests/unit/features/layout/threadExpanded.spec.ts`: 21 tests.

## Tests (`threadExpanded.spec.ts`)

- **Mode:** default docked, never persisted, toggle, only-a-thread, resets on profile/close/sign-out, stays expanded across threads.
- **Sizing:** the 1440 split; the conversation floor at 1710/1440/1280/1100; chosen widths clamped; the sidebar gives way first.
- **AppShell:**
  - it expands with the conversation still rendered and showing its content;
  - message and button clicks run normally without collapsing, and an empty-area click restores;
  - the divider drag uses `clientX` (a large `clientY` change is ignored): left widens, right narrows;
  - the expanded width isn't persisted, and Restore returns to the saved 420px;
  - a drag can't push below the conversation floor.
- **ThreadPanel:**
  - the button order is expand · title · close;
  - it's a real `<button type=button>` with a changing label, and focus is kept after Restore;
  - Esc restores, then closes;
  - the thread body and composer are the same instance in both modes;
  - Shift+Ctrl+E matches and has no conflicts.
- **Guards:** no modal idioms (100vw, pointer-events none, backdrop blur); the 0.92 opacity; reduced motion; the button hidden on phones.
- **The existing resize tests** (`panelResize.spec.ts`, including its axis guard) still pass.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run build`: PASS.
- Full unit suite: 1346 / 1346 PASS (130 files).
- `cargo test`: 88 / 88 PASS (no Rust changes).
- **Visual QA** in headless Edge, rendering the real AppShell and ThreadPanel with a seeded thread (temporary harness, deleted):

| Width | Result |
|---|---|
| 1440 docked | Button left of the title; standard layout |
| 1440 / 1710 / 1280 expanded | Conversation ≈ 330 / 406 / 300px, readable (names, text, composer); the thread's composer is wide |
| 1024 expanded | Overlay widened; sidebar and ~300px of the conversation visible |
| 390 / 320 expanded (fixed-width iframe) | Full-screen thread, no expand button, no overflow |

A first 1024 pass covered almost the whole conversation, and the phone width showed a sliver of the page. Both were fixed before these final results.

**Not verified yet: the running Tauri app.**
- The dev instance has these frontend changes through hot reload.
- A manual click-through in the window hasn't been done, so drag feel and the animation are unconfirmed.
- Steps:
  1. Open a thread and press the ⤢ button.
  2. Drag the divider.
  3. Click an empty area of the conversation.
  4. Press Shift+Ctrl+E and Esc.

## Known limitations

- **769–1024px:** the expanded thread is an overlay, as the docked one already was there, so it isn't resizable.
- **Click-to-restore** only fires on empty conversation space. In a dense channel, most of that space is messages, so Restore, Esc or the shortcut are the main ways back.
