# Panel resize — vertical dividers, horizontal drag

**The divider is vertical; the resize axis is horizontal.** Dragging a divider left or right changes a panel's **width** only. Nothing in this feature reads `clientY`, `movementY`, or heights, or uses `row-resize`. A test (`axis guard`) enforces this.

## 1. Partitions

| Divider | Where | Panel sized | Edge | Min | Default | Max |
|---|---|---|---|---|---|---|
| Sidebar ↔ conversation | `AppShell.vue` | sidebar (community, channels, DMs; one column) | end | 200 | **260** | 420 |
| Conversation ↔ side panel | `AppShell.vue` | details pane (thread / profile / channel details) | start | 280 | **300** | 640 |
| Inbox list ↔ inbox detail | `InboxView.vue` | inbox list | end | 300 | **365** | 520 |

- **Defaults** are the widths the UI already rendered before this change: AppShell's fixed `260px … 300px` grid and the Inbox's 365px list. The suggested 240/280/420/360 defaults were not used, because they would have moved everyone's layout on upgrade.
- **Separate "app sidebar" and "channel list" columns don't exist.** SWF's `AppSidebar` is one column, so it has one divider. There is also no separate context column: thread, profile and channel details share the single details pane, so one divider covers them.
- **Conversation minimum:** `MAIN_MIN_WIDTH = 360px`. The Inbox detail column's minimum is `INBOX_DETAIL_MIN_WIDTH = 320px`.
- **Every divider is independent.** Each has its own width, its own storage key and its own reset.

## 2. Files

- `src/features/layout/panelSizing.ts` is pure and has no DOM. It contains:
  - the specs;
  - `clampPanel`, `availableMax`, `fitShellPanels`, `dragWidth` and `keyWidth`;
  - device-local persistence;
  - `usePanelWidth(id)`: one shared ref per panel, so Channels, DMs and Inbox all show the same sidebar width.
- `src/features/layout/ui/PanelResizeHandle.vue` is the reusable handle.
- `src/layouts/AppShell.vue` has two handles and grid columns driven by `--shell-sidebar-width` / `--shell-details-width`.
- `src/views/InboxView.vue` had its own inline resizer. That was replaced by the shared handle, so there is one system, not two.
- `tests/unit/features/layout/panelResize.spec.ts` holds the tests.

## 3. Handle behaviour

- **Pointer Events** with `setPointerCapture`:
  - the drag starts on the primary button or first touch only;
  - it follows only its own `pointerId`;
  - it ends on `pointerup`, `pointercancel` or `lostpointercapture`;
  - the width is computed from `startWidth ± (clientX − startX)`.
- **Clamping** happens during the drag to `[min, effective max]`.
- **Live updates:** the `resize` event fires on every move. It updates the ref only; nothing is written to storage.
- **Persistence:** the `commit` event fires once, at the end of the drag. That is the only time the width is saved.
- **Double-click** resets the panel to its default and persists it.
- **Keyboard:** the handle is focusable (`tabindex=0`).
  - ←/→ move the **divider** 10px; Shift moves it 50px.
    - On the right-hand details pane, ← therefore makes the panel wider.
  - Home sets the minimum width; End sets the maximum.
  - ↑/↓ are ignored.
  - Every handled key persists.
- **ARIA:** `role="separator"`, `aria-orientation="vertical"`, `aria-label`, and `aria-valuenow` / `min` / `max`. `aria-valuemax` is the *effective* maximum, the one the window can actually give.
- **Visuals:**
  - the hit area is 8px wide and straddles the column's existing 1px border, which remains the visible line;
  - on hover, focus or drag, a 2px accent line appears;
  - the cursor is `col-resize`, with `touch-action: none` and `user-select: none`.
- **`body.is-resizing`** is set during a drag. It forces `col-resize` everywhere and disables text selection and iframe pointer events. It is removed at the end of the drag, and also if the view unmounts mid-drag.
- **Positioning:** handles are absolutely positioned over the borders (`left/right: calc(var(--…-width) - 4px)`). They take no grid cell, so the column layout is the same as before.

## 4. Space rules

- `fitShellPanels(total, sidebar, details)` produces the **rendered** widths. The conversation column keeps `MAIN_MIN_WIDTH`.
  - The details pane gives way first, then the sidebar, and neither goes below its own minimum.
  - **Saved preferences are never changed by this.** Widen the window and the saved width comes back.
- While dragging, each divider's maximum is `availableMax(...)`: the panel's own maximum, or whatever leaves the other panel plus 360px for the conversation. The dragged panel is the one that gets clamped.
- **Inbox:** `listMax = availableMax("inboxList", workspaceWidth, 320)`.

## 5. Responsive behaviour

The table shows what was measured in the real Tauri window, with both panels dragged to their maximum (420 / 640).

| Viewport | Grid | Conversation | Sidebar handle | Details handle |
|---|---|---|---|---|
| 1710 | 420 / 650 / 640 | 650 | ✓ | ✓ |
| 1440 | 420 / 380 / 640 | 380 | ✓ | ✓ |
| 1280 | 420 / 360 / 500 | 360 (floor) | ✓ | ✓ |
| 1100 | 420 / 360 / 320 | 360 (floor) | ✓ | ✓ |
| 1024 | 420 / 604 | 604 | ✓ | — (overlay) |
| 800 | 420 / 380 | 380 | ✓ | — |
| 768 / 430 / 390 / 375 / 320 | 1 column | full | — (drawer) | — |

- No viewport has horizontal page scroll.
- **Resizing is off wherever a panel is a drawer or overlay:**
  - the details pane is an overlay at ≤1024px;
  - the sidebar is a drawer at ≤768px.
  - This is enforced in two places: `matchMedia` in `AppShell` and `display:none` in CSS.
- Inbox hides its divider below its existing 600px narrow mode, where it shows the list or the detail, never both.

## 6. Persistence and scope

- **Storage keys:** `swf-buzz:layout.sidebar-width.v1`, `swf-buzz:layout.details-width.v1` and `swf-buzz:layout.inboxList-width.v1` in `localStorage`.
- **Scope:**
  - **Device-local, same as Appearance.** A layout preference belongs to the screen, not to an identity or a community.
  - Widths are never written to a Nostr event or profile.
- **Migration:** the old `swf-buzz:inbox-list-width` value is read once as a fallback, so saved Inbox widths carry over.
- **Stored values:**
  - out-of-range values are clamped on read;
  - corrupt values fall back to the default;
  - if storage fails (private mode or quota), the width still applies for the session.

## 7. Not affected

- **Settings** is a full-screen route with its own layout. It doesn't use `AppShell` and has no dividers.
- **Drawers, scrim and the mobile layout** are unchanged.

## 8. Axis audit

A search of `src/` for `row-resize`, `clientY`, `movementY` and `movementX` found **none** before or after this change. The only resize code was the Inbox handle, which already used `clientX` with `col-resize` and has now been replaced. The spec test asserts that `src/features/layout/**`, `AppShell.vue` and `InboxView.vue` stay free of vertical resize APIs.

## 9. QA

QA was done in the real app over CDP, with real `Input.dispatchMouseEvent` drags in the WebView2 window.

- **Sidebar drags:**
  - 260 → 340;
  - dragged far right, clamped to 420;
  - dragged far left, clamped to 200.
- **Details drags:** 339 → 500; dragged far left, clamped to 640.
- **During each drag:** `body.is-resizing` was on mid-drag and off afterwards, and no text was selected.
- **Storage** was written only on release.
- **Double-click** reset each panel to 260 / 300.
- **Keyboard** gave 270, 320 (Shift), 420 (End), 200 (Home); ↑ was ignored; ← on details went 300 → 310.
- **Inbox:** dragged 454 → 340 and to the 520 clamp, then restored.
- **The user's own widths were restored** after QA.

## 10. Known, unrelated

A thread left open in Channels keeps `ui.contextPanel.kind === "thread"` when you navigate to Inbox. Inbox only renders a *profile* in the details slot, so an empty 300px pane shows. This predates this change: the grid was already `260px 1fr 300px`. It was left alone because fixing it means changing navigation state.
