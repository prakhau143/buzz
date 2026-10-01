# Phase H — Message action menu + rich URL links

Status: implemented, automated-verified. Not committed.

---

## Part 1 — The message `⋮` menu

### Original bug

On desktop, the `⋮` menu of a message near the bottom of the conversation opened downward. It was cut off at the bottom of the window, behind or under the composer area. "Mark unread", "Copy" and the destructive actions became unreachable.

### Root cause (audited, not guessed)

- `MessageItem.openMenu()` set the card's position to `top = trigger.bottom + 4` and `left = max(8, trigger.right - 200)`.
- `MessageMenu.vue` then drew a `position: absolute` card inside a `position: fixed; inset: 0` overlay.

The fixed overlay already escaped the `.message-list` `overflow-y: auto` scroller, and no ancestor creates a containing block (no transform, filter or contain). So the menu was **not** being clipped by an overflow container, and a `z-index` change would not have fixed anything. The real defect was that **there was no collision handling at all**:

- the card never flipped above the trigger;
- it was never clamped to the viewport's bottom or right edge;
- its height was never measured.

### Fix: a reusable primitive

**`src/components/menuPlacement.ts`** contains `placeMenu(anchorRect, menuSize, viewport)`. It is pure geometry and unit-tested.

1. **Below** the trigger when the whole menu fits there.
2. Otherwise **above** it when it fits there.
3. Otherwise on the roomier side, with `maxHeight` capped to that space. The menu then scrolls internally (`overscroll-behavior: contain`).
4. **Horizontal:** right edges aligned. It flips to left-aligned when that would leave the viewport.
5. **Clamp:** the result is always clamped inside the viewport with an 8px margin.

The viewport is the **visual viewport** where available, so a soft keyboard or pinch-zoom is respected.

**`src/components/PositionedContextMenu.vue`**:

- **Rendered:** `<Teleport to="body">`, `position: fixed`, so no ancestor can clip it.
- **Measured and placed:** after mount, from `trigger.getBoundingClientRect()`.
- **Re-placed:** at most once per animation frame, on window `resize`, any `scroll` (capture phase, so the conversation scrolling underneath counts), and visual-viewport `resize` / `scroll`. Every listener is added on open and removed on close. There are no permanent global listeners.
- **Menu semantics:**
  - `role="menu"` with `role="menuitem"` buttons and separators;
  - ArrowUp/ArrowDown (wrapping), Home/End;
  - Enter/Space activate (native buttons);
  - Escape and Tab close;
  - focus moves to the first item on open and **returns to the trigger** on close, unless an item deliberately moved it (e.g. the inline editor).
- **Outside press:** a `pointerdown` listener in the capture phase closes the menu, without swallowing the press. The conversation stays scrollable and clickable while the menu is open. This replaces the old full-screen overlay.
- **Style:**
  - existing tokens only: `--color-surface`, `--color-border`, `--radius-md`, `--shadow-lg`;
  - 6px padding, 36px rows, `AppIcon` icons;
  - hover, focus-visible and pressed states;
  - destructive actions grouped after a separator in `--color-danger`;
  - a 120ms entrance that respects `prefers-reduced-motion`.

**`MessageMenu.vue`** is rebuilt on it. Items: *Reply in thread* (main feed only) · *Pin / Unpin message* (Phase G, only when allowed) · *Copy message* · *Copy link* · *Mark unread* · | *Edit message* · | *Delete* / *Delete (moderator)* · *Report message*. The trigger stays visible and highlighted while its menu is open.

New ASCII-only icons were added to `AppIcon`: `pin`, `pin-off` and `mail`.

### Desktop and mobile

```
Message action intent ─┬─ desktop: MessageMenu → PositionedContextMenu
                       └─ mobile:  MobileMessageActions (existing bottom sheet, unchanged design)
```

Both read the same abilities: `channelPermissions.ts` for edit/delete, and `pinModel.ts` for pin/unpin through `useConversationPin`. `MessageActionAbilities` gained `pin` / `unpin`.

---

## Part 2 — URLs in messages

### Parser

`src/features/links/urlModel.ts` (pure):

- **Detects** `http://…`, `https://…` and bare `www.…`, only at a word boundary. So `foo@www.x.com`, `xhttps://` and email addresses never match.
- **Trailing punctuation** (`. , ; : ! ? ' " * _ ~`) is left as text. An unbalanced closing `)`, `]` or `}` is trimmed, but balanced ones stay: `…/Rust_(programming_language)` keeps its parenthesis.
- **Paths, query strings, fragments and ports** are kept.
- **`normalizeExternalUrl`** checks everything again before opening:
  - only `http:` and `https:` are allowed;
  - `javascript:`, `data:`, `file:`, `vbscript:` and anything else are rejected;
  - credentials in the URL (`user:pw@host`), control characters and whitespace are rejected;
  - a URL with no real host, or longer than 2048 characters, is rejected.
- **`linkDisplay`** gives the compact form: host without `www.`, plus the path truncated at 36 characters.

### One tokenizer

`src/features/mentions/messageSegments.ts` → `segmentMessage()` produces text, person mentions, `@everyone` and links, in order.

- Mentions bind first, with the existing rules: tagged identities only, mention boundaries, URLs and code masked.
- Links are found only in the remaining plain runs, outside code spans.

So a URL never contains a chip, a chip never contains a link, and there are **no nested anchors**. `MessageContent` renders the tokens as text nodes and components with bound props. There is **no `v-html`** anywhere, and the regex runs once per content change in a `computed`. Every message surface (channel, DM, thread, Inbox detail) uses this one path.

### `MessageLink.vue`

- **The element:** a real `<a href target="_blank" rel="noopener noreferrer nofollow">` with the full URL as `title` and the accessible name "<host/path>, opens in your browser". It shows a link glyph, the host and a muted path.
- **Styling:** accent colour with an underline, which together with the glyph means it is not distinguished by colour alone. It wraps with `overflow-wrap: anywhere` so long URLs never overflow, and has a focus ring.
- **Click behavior.** Every click opens the URL externally, prevents default and stops propagation, so SWF never navigates and the row's handlers (long-press, thread open) don't fire:
  - **plain click** opens immediately; it is not delayed to wait for a possible double-click;
  - **Ctrl/⌘ + click** and **middle-click** (`auxclick`) also open externally;
  - a **double-click** is two clicks plus a `dblclick`. The `dblclick` is swallowed and the second click is deduplicated, so the browser launches **once**.

### External opener: `src/platform/opener/index.ts`

`openExternalUrl(url)` is the one place that opens links:

- It re-validates the URL.
- It deduplicates the same URL within 600ms.
- **Desktop (Tauri):** it calls `invoke("plugin:opener|open_url", { url })`. That is the command of the already-registered `tauri-plugin-opener`, and the window already has the `opener:default` grant (it allows `http(s)://`), so no new dependency or capability was needed. The OS opens the user's **default browser**; Chrome is not hard-coded.
- **Web:** `window.open(url, "_blank", "noopener,noreferrer")`.
- URLs are never logged, because they can carry tokens.

### Previews

There is no trusted preview service in SWF, so **no metadata is scraped**. There is no client-side OG fetch, no CORS proxy, no iframe and no remote script. Every URL gets the compact inline treatment: 🔗 host/path….

---

## Tests

| File | Covers |
|---|---|
| `tests/unit/components/menuPlacement.spec.ts` | Menu tests 1-13: teleported into `<body>`, inside the viewport (sweep over every trigger position), bottom → opens upward, top → downward, left/right edges, scrolls when too tall, soft-keyboard viewport, Escape, outside press, focus return, keyboard nav incl. Home/End, scroll/resize listeners added and removed, real placement above the trigger |
| `tests/unit/components/messageMenuActions.spec.ts` | Updated for the teleported menu: edit/delete gating, moderator label, report |
| `tests/unit/features/links/urlModel.spec.ts` | Link tests 15-22, 25-27, 32: https / http / www, query, fragment, port, punctuation, parentheses, several URLs, multiline, safe schemes and rejected schemes, credentials, length, display truncation |
| `tests/unit/features/links/messageLink.spec.ts` | Link tests 23-24, 28-31 and security: one-click open (web + Tauri opener), Ctrl+click, double-click once, tap without bubbling to the row, dedup window, unsafe schemes refused, mention + URL / URL + mention / @everyone + URL / emoji / punctuation, no nested anchors, no HTML injection, code spans |
| `tests/unit/features/mentions/everyoneMention.spec.ts` | The segment ordering for @everyone + link |
| `tests/unit/features/pins/conversationPin.spec.ts` | Menu / sheet pin gating (desktop vs mobile parity, test 14: mobile uses the sheet) |

Link tests 33-36 (URLs in threads, DMs, search and edited messages) need no separate code path. Threads, DMs and edited messages render through the same `MessageItem` → `MessageContent` → `segmentMessage`. Search results stay plain text, because a result is a button and must not nest links.

## Verification

The command sequence, run one after another:

```
npx vue-tsc --noEmit
npx eslint . --max-warnings 0
npx vitest run
npm run build
```

The full results are reported in the session that produced this change. The baseline before the work was 155 files and 1661 tests, all green.

| Level | Status |
|---|---|
| AUTOMATED VERIFIED | Yes: the tests above, full suite, typecheck, lint, production build |
| EMULATED VIEWPORT VERIFIED | **No.** Placement is covered by geometry tests over a 1280×800 sweep and a 390×420 keyboard viewport, not in a rendered browser |
| LIVE RELAY VERIFIED | **No.** The relay was not running |
| REAL DEVICE VERIFIED | **No** |

## Known limitations

1. **No rich previews** (title, image, favicon), because there is no trusted preview service. URLs get the compact inline form.
2. **`mailto:` and `tel:` are not linkified.** The product has no such links today. They would be one entry each in `SAFE_PROTOCOLS`, plus opener scope (already granted by `opener:default`).
3. **Search result rows stay plain text**, to avoid links nested inside result buttons.
4. **`AnchoredPopover`** (used by the community rail) was left as is. `PositionedContextMenu` is the new primitive for message actions, and migrating the rail to it is optional follow-up work.
