# OLD BUZZ — Inbox UI Reconstruction Spec (source-derived)

## How to read this spec

**Path prefix.** `D/` = `C:\Users\lenovo\New folder (2)\buzz\buzz\desktop\src\`.

**Pixel values.** Pixel values are derived from Tailwind classes at the default type scale, where 1rem = 16px (`D/shared/styles/globals/typography.css:16-27`).

The OLD BUZZ app scales rem in two ways, so treat the px values as the defaults:

- **Cmd +/- zoom** scales the real root font size.
- **The Font size preference** sets `data-font-size` on the root. The type scale becomes:
  - smaller: 13/14
  - larger: 15/14

  (`typography.css:45-52`)

**Tailwind configuration.** The config is `desktop/tailwind.config.js`. It sets no custom `screens`, so the Tailwind defaults apply: sm = 640px, lg = 1024px. This was checked by grepping the config for "screens" (no match).

**Radius mapping** (`tailwind.config.js:62-66`; `theme.css:4`):

| Class | Value |
|---|---|
| `rounded-lg` | `var(--radius)` = 0.625rem = **10px** |
| `rounded-md` | 8px |
| `rounded-sm` | 6px |
| `rounded-2xl` | Tailwind default, 16px |
| `rounded-full` | pill |

---

## 1. Layout

```
┌──────────── App window ─────────────────────────────────────────────────────────────────────┐
│ Global top chrome 40px (TOP_CHROME_HEIGHT_DEFAULT)   shared/layout/chromeLayout.ts:5         │
├───────────────┬──────────────────────┬────────────────────────────────┬────────────────────┤
│ App sidebar   │ LIST PANE            │ DETAIL PANE                    │ AUX PANE (optional)│
│ default 300px │ default 365px        │ minmax(0,1fr)                  │ default 380px      │
│ min 220       │ min 300 / max 520    │ min effectively 300            │ min 300 / max 720  │
│ max 420       │ resizable (handle)   │                                │ resizable (left    │
│ icon mode 48  │ sessionStorage       │                                │ edge handle)       │
│ localStorage  │ buzz.desktop.home-   │                                │ sessionStorage     │
│ buzz-sidebar- │ inbox-list-width     │                                │ buzz.desktop.      │
│ width         │                      │                                │ thread-panel-width │
└───────────────┴──────────────────────┴────────────────────────────────┴────────────────────┘
```

| Item | Value | Source |
|---|---|---|
| Sidebar width | 300 default, max 420, min 220, icon 48, mobile 288 | `D/shared/ui/sidebar.tsx:30-37`; `D/shared/layout/sidebarLayout.ts:2` |
| Inbox grid | CSS grid with the vars `--home-inbox-list-width` and `--home-channel-management-width` (templates in audit §2) | `D/features/home/ui/HomeView.tsx:662-683` |
| List width | default 365, clamp 300..520 | `D/features/home/useResizableInboxListWidth.ts:3-14` |
| List max at runtime | `max(300, homeWidth − 300 − (aux ? auxWidth : 0))`. This effectively reserves at least 300px for the detail pane. | `D/features/home/lib/homePaneLayout.ts:47-68` |
| Single-column breakpoint | Inbox **element** width < 600px (measured with `useElementWidth`; not a viewport media query) | `useResizableInboxListWidth.ts:5`; `HomeView.tsx:108-111` |
| Aux pane width | default 380, min 300, max 720 (viewport-scaled upper bound); single-column below 600 | `D/shared/layout/auxiliaryPanelLayout.ts:1-5`; `D/shared/hooks/useThreadPanelWidth.ts:9,67-85` |
| Resize handle (list/detail) | `absolute bottom-0 top-0 z-40 w-3 (12px) -translate-x-1/2 cursor-col-resize`, placed at `left: listWidth`. Its inner 1px line becomes `bg-border/80` on hover or focus-visible. Title: "Drag to resize." / "Drag to resize. Double-click to reset width." | `HomeView.tsx:759-780` |
| Pane divider | list `::after` 1px `bg-border/35`, full height, `z-40` | `D/features/home/ui/InboxListPane.tsx:79-80` |
| Pane backgrounds | list and detail `bg-background/60` (translucent over the app surface) | `InboxListPane.tsx:606`; `D/features/home/ui/InboxDetailPane.tsx:540` |
| Loading skeleton grid | `lg:grid-cols-[320px_minmax(0,1fr)]`, single column below 1024px | `D/features/home/ui/HomeLoadingState.tsx:6` |

## 2. Header

| Item | Value | Source |
|---|---|---|
| Shared header backdrop | `absolute inset-x-0 top-0 z-30 h-13` (**52px**) `bg-background/80 backdrop-blur-md` (`supports-backdrop-filter: bg-background/70`). Dark: `bg-background/70 backdrop-blur-xl` (`/55` with support). | `HomeView.tsx:684-690` |
| Header row (list and detail) | `TopChromeInsetHeader flush transparent` (`relative z-40 shrink-0`), then `px-5 py-2` (20px / 8px), then `flex min-h-9` (36px) `items-center justify-between gap-3` (12px). Total ≈ **52px**. | `InboxListPane.tsx:610-613`; `InboxDetailPane.tsx:545-547`; `D/shared/layout/TopChromeInsetHeader.tsx:17-36` |
| Content under header | Scroll areas use `-mt-13 pt-13`, so content scrolls beneath the translucent header | `InboxListPane.tsx:705`; `InboxDetailPane.tsx:696` |
| Filter trigger | `inline-flex h-8` (32px) `-ml-2 px-2 gap-1 rounded-lg text-sm font-medium text-foreground`; hover `bg-muted/70`; open-state `bg-muted/70`; focus ring 1px `ring`; icons 16px; chevron `text-muted-foreground` | `D/features/home/ui/InboxFilterMenu.tsx:28-29` |
| Options button | `h-8 w-8 rounded-lg text-muted-foreground -mr-4`; hover `bg-muted/70 text-foreground`; icon Ellipsis 16px | `InboxListPane.tsx:77-78, 616-623` |
| Filter menu | `w-52` (208px), align start; separator before Reminders `my-2 bg-border/60`; count badge `h-4 min-w-4 rounded-full bg-primary px-1 text-2xs font-semibold text-primary-foreground` | `InboxFilterMenu.tsx:69-100` |
| Options popover | `w-60` (240px) `p-2`, align end; rows `min-h-9 rounded-lg px-2 py-1.5/py-2 text-sm`; hover `bg-muted/50`; separator `my-1 bg-muted` | `InboxListPane.tsx:625-660` |
| Detail header buttons | `Button size="icon" variant="ghost"`, `rounded-full text-muted-foreground`. Title: `text-sm font-semibold leading-5 tracking-tight`, truncate, `hover:underline` when clickable. | `InboxDetailPane.tsx:555-596, 647-663` |

## 3. List row (inbox item)

Anatomy of `InboxListPane.tsx:344-557`:

```
┌─ div.group/inbox-item relative ─────────────────────────────────────────────┐
│ [button absolute inset-0 z-0] (highlight layer span)                         │
│ ┌ div relative z-10 px-3 py-4 cursor-pointer ───────────────────────────────┐│
│ │ [Avatar 36px] gap-2.5 ┌ name (text-sm semibold leading-4)   ● 3 unread 2:14 PM ┐│
│ │                       │ Mentioned in [#channel-chip]   (text-2xs)          ││
│ │                       │ ⏰ Reminder due (optional, text-2xs amber)         ││
│ │                       │ Preview markdown, 2-line clamp (text-message)      ││
│ │                       └────────────────────────────────────────────────────┘│
│ └────────────────────────────────────────────────────────────────────────────┘│
│                               [ ✉ | ↗ | ⏲ ] hover pill (absolute right-3 top-2)│
└──────────────────────────────────────────────────────────────────────────────┘
```

| Part | Classes → px | Source |
|---|---|---|
| Padding | `px-3 py-4` → 12px / 16px | `:374` |
| Avatar | `UserAvatar size="md" className="h-9 w-9"` → 36px. Circle for humans; squircle (`rounded-[30%]`) for agents | `:388-401` |
| Avatar–text gap | `gap-2.5` → 10px | `:377` |
| Name | `text-sm` (14px) `font-semibold leading-4` (16px) `text-foreground`, truncate | `:418` |
| Meta (right) | `text-xs` (12px) `leading-4 text-muted-foreground/70 gap-1.5`; `font-medium` when unread, `font-normal` when read; hidden (`opacity-0`) on hover or focus-within | `:423-441` |
| Unread dot | `h-1.5 w-1.5` (6px) `rounded-full bg-primary` | `:430-433` |
| Type label | `text-2xs` (11px) `leading-3` (12px) `gap-1.5`, `min-h-[var(--inline-chip-min-height)]`. Unread + needs-action: `font-medium text-amber-600/80`, dark `text-amber-300/80`. Unread: `font-medium text-muted-foreground/80`. Read: `font-normal text-muted-foreground/70`. On hover it gets `pr-[6.75rem]` (108px) to clear the pill. | `:82-118` |
| Channel chip | `MENTION_CHIP_BASE_CLASSES inbox-channel-chip`, truncate. CSS: background `hsl(var(--muted))`, color `hsl(var(--muted-foreground)/0.82)` | `:106-114`; `D/shared/styles/globals/markdown.css:111-114` |
| Preview | `mt-1.5` (6px) `text-message` (14px / 20px). Unread: `font-semibold text-foreground`. Read: `font-normal text-muted-foreground`. `.inbox-preview-markdown`: first block only, `-webkit-line-clamp: 2`, `<br>` hidden, `padding-bottom: 0.25rem` | `:499-514`; `markdown.css:131-168` |
| Row height estimate | 96px (virtualizer); actual height depends on content | `:711` |
| Row separators | **None** for inbox rows. Reminder rows (`PersonalItemRow`) use `border-b border-border/45` | `:181` |
| Hover pill | `absolute right-3 top-2` (12px / 8px) `z-10 flex gap-0.5 rounded-full p-1 bg-[var(--inbox-row-highlight-bg)]`, `opacity-0 → 100`, `transition-opacity duration-150 ease-out` | `:519` |
| Pill buttons | `h-8 w-8` (32px) `rounded-full text-muted-foreground`; hover `bg-muted text-foreground`; `disabled:opacity-40`; active (reminder set) `bg-blue-500/10 text-blue-500`; icons 16px; each has a Tooltip | `:772-811` |

**Row states:**

| State | Style | Source |
|---|---|---|
| Default | transparent over `bg-background/60` | — |
| Hover / focus-within | highlight layer `bg-[var(--inbox-row-highlight-bg)]`, where the variable is `color-mix(in srgb, hsl(var(--background)) 75%, hsl(var(--muted)) 25%)` | `:331-333, 363-368` |
| Active (pressed) | `bg-muted/40` | `:367` |
| Selected | `aria-current="true"`; permanent highlight using `color-mix(... background 70%, muted 30%)` | `:331-333, 346, 365-366` |
| Unread | dot + semibold preview + medium label | above |
| Read | no dot, muted preview and label | above |
| Focus | the native row button is focusable; avatar and name triggers use `focus-visible:ring-2 ring-ring` | `:390, 418` |

**Reminder row** (`PersonalItemRow`, `:162-211`):

- `flex gap-3 px-4 py-3` (16px / 12px), `border-b border-border/45`.
- Hover and selected: `bg-muted/40`.
- Icon circle: 36px `bg-muted`, with a Bell icon (16px).
- Title: "Reminder", `text-sm font-semibold`.
- Status: `text-xs font-medium text-muted-foreground`.

**Empty list:** `flex h-full min-h-64` (256px), centered, `px-6`. Title `text-sm font-medium`; subtitle `mt-1 text-sm text-muted-foreground` (`:748-765`).

## 4. Detail pane

| Part | Value | Source |
|---|---|---|
| Scroll area | `overflow-y-auto overscroll-contain pb-32` (128px) `pt-13`, `[overflow-anchor:none]` | `InboxDetailPane.tsx:694-705` |
| Message row wrapper | `relative px-2` (8px) | `D/features/home/ui/InboxMessageRow.tsx:131` |
| Message article | `mx-1 flex gap-2.5 rounded-2xl px-2 py-conversation-row`. The last value is 4px by default: `--conversation-row-padding-block` is 0.25rem, and 0.5rem when density is spacious. Hover and focus-within: `bg-muted/50`. | `InboxMessageRow.tsx:144-148`; `typography.css:38, 54-66` |
| Avatar | 36px; agents get a squircle with the `accent` style | `InboxMessageRow.tsx:195-218` |
| Author | `text-message font-semibold leading-message-author` (16px) | `:233-238` |
| Timestamp | `text-message-timestamp` (12px / 16px) `tabular-nums text-muted-foreground/55`. Label from `formatItemTimestamp(withTime)`, for example "Yesterday at 2:14 PM"; `title` holds the full timestamp | `:117-128`; `D/shared/lib/datetime.ts:132-159` |
| Continuation row | 36px-wide gutter that shows the time on hover only (`opacity-0 → 100`) | `:184-193` |
| Body | `mt-conversation-body` (2px default), `text-message text-foreground`; emoji-only messages use `text-4xl` | `:262-291` |
| Selected highlight | `absolute inset-x-3 inset-y-1 rounded-2xl bg-primary/[0.07]`, fading `opacity 100 → 0` over `duration-1000`; fade starts 1200ms after the conversation changes | `:133-143`; `InboxDetailPane.tsx:345-355` |
| Unread divider | `UnreadDivider` shared component, before the boundary message | `InboxMessageRow.tsx:132` |
| Action bar | `absolute right-2 top-1 z-10`. For rows other than the first, on sm+ it becomes `sm:top-0 sm:-translate-y-1/2` | `:156-182` |
| Loading notice | `mx-4 mb-2 flex gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground` + spinner | `InboxDetailPane.tsx:707-715` |
| Error notice | same box, but `bg-destructive/10 text-destructive` + AlertCircle | `:716-724` |
| Composer overlay | `absolute inset-x-0 bottom-0 z-40`, with a gradient fade `before:h-12` (48px, transparent → background) and `after:h-4` (16px) solid background. Corner masks are 16px radial. The composer container is `px-4 pb-4`. | `:791-883` |
| Empty (no selection) | centered, `pt-20` (80px); icon circle `h-14 w-14` (56px) `bg-muted` with a Mail icon (24px); title `mt-4 text-base font-semibold`; body `mt-1 text-sm text-muted-foreground`; `max-w-sm` | `:435-452` |

## 5. Typography tokens

Source: `tailwind.config.js:11-24, 47`; `typography.css:18-42`.

| Token | px at default | Used for |
|---|---|---|
| `text-2xs` | 11px (`0.6875 × type-rem`) | Type label, badges, reminder due |
| `text-xs` | 12px | Row meta, reminder status |
| `text-sm` | 14px | Sender name, filter trigger, popover items, empty states, detail title |
| `text-base` | 16px | Detail empty title, error title |
| `text-message` | 14px / line-height 20px | Preview, message body |
| `text-message-timestamp` | 12px / 16px | Detail timestamps |
| `leading-4` / `leading-3` / `leading-5` | 16 / 12 / 20px | name / label / detail title |

Weights used: `font-normal`, `font-medium`, `font-semibold`.

## 6. Color tokens

Source: `D/shared/styles/globals/theme.css:2-99`.

The source comment names the default palette "Catppuccin Latte (mauve accent)". Values are HSL components, consumed as `hsl(var(--x))` (`tailwind.config.js:84-139`). The runtime theme system (`D/shared/theme/ThemeProvider.tsx`, `adaptive-theme.ts`) can override these values. The exact rendered colors were not verified in OLD BUZZ (runtime).

| Token | Light (`:root`) | Dark (`.dark`) |
|---|---|---|
| `--background` | 220 23.08% 94.9% | 232 23.4% 18.43% |
| `--foreground` | 234 16.02% 35.49% | 227 68.25% 87.65% |
| `--primary` | 266 85.05% 58.04% | 267 82.69% 79.61% |
| `--primary-foreground` | 220 23.08% 94.9% | 232 23.4% 18.43% |
| `--muted` | 223 15.91% 82.75% | 230 18.8% 26.08% |
| `--muted-foreground` | 233 12.8% 41.37% | 228 39.22% 80% |
| `--border` | 225 13.56% 76.86% | 231 15.61% 33.92% |
| `--destructive` | 347 86.67% 44.12% | 351 73.91% 72.94% |
| `--ring` | 234 16.02% 35.49% | 227 68.25% 87.65% |
| `--radius` | 0.625rem | 0.625rem |

Extra colors used in the Inbox that are not tokens: `amber-600/80` and `dark:amber-300/80` (needs action), and `blue-500` (reminder set).

## 7. Component tree

```
routes/index.tsx  Route "/" → HomeRouteComponent
└─ HomeScreen                         features/home/ui/HomeScreen.tsx
   └─ HomeView                        features/home/ui/HomeView.tsx
      ├─ HomeLoadingState             (loading)  ui/HomeLoadingState.tsx
      ├─ error card "Home feed unavailable" (inline)
      └─ ProfilePanelProvider         shared/context/ProfilePanelContext.tsx
         ├─ DeleteMessageConfirmDialog  features/messages/ui/
         ├─ div.grid [data-testid=home-inbox]
         │  ├─ shared header backdrop
         │  ├─ InboxListPane          ui/InboxListPane.tsx
         │  │  ├─ TopChromeInsetHeader
         │  │  │  ├─ InboxFilterMenu  ui/InboxFilterMenu.tsx (DropdownMenu radio)
         │  │  │  └─ Popover "Inbox options" (Switch, Mark all as read)
         │  │  ├─ RemindersPanel(presentation="inbox-list") | DraftsPanel | VirtualizedList
         │  │  │    └─ ContextMenu > row (UserProfilePopover > UserAvatar, InboxLabel,
         │  │  │         VideoReviewCommentMarkdown, InboxRowActionButton×3 w/ Tooltip)
         │  │  │    └─ PersonalItemRow (reminders in All)
         │  ├─ resize handle button
         │  ├─ InboxDetailPane        ui/InboxDetailPane.tsx
         │  │  ├─ ProjectInboxDetail  (Buzz Git items)  ui/ProjectInboxDetail.tsx
         │  │  └─ InboxMessageDetailPane
         │  │     ├─ TopChromeInsetHeader (Back, title, UpdateIndicator, reopen pill,
         │  │     │    Open ↗, ChannelMembersBar, HeaderMoreMenu)
         │  │     ├─ InboxMessageRow × n  ui/InboxMessageRow.tsx (MessageActionBar,
         │  │     │    MessageReactions, UnreadDivider, UserProfilePopover)
         │  │     ├─ MessageComposer
         │  │     └─ MembersSidebar (lazy)
         │  ├─ HomePersonalInboxDetail (DraftDetailPane | ReminderDetailPane)
         │  └─ RightAuxiliaryPane     features/channels/ui/RightAuxiliaryPane.tsx
         │     └─ UserProfilePanel | ChannelManagementSheet
         └─ HomeMembersSidebarOverlay ui/HomeMembersSidebarOverlay.tsx
Sidebar: AppSidebarPrimaryMenu → "Inbox" SidebarMenuButton + SidebarMenuBadge
         features/sidebar/ui/AppSidebarPinnedHeader.tsx:92-129
```

## 8. Interactions and motion

| Interaction | Behavior | Source |
|---|---|---|
| Row hover | Highlight colors via `transition-colors`; pill fades in over 150ms; meta fades out | `InboxListPane.tsx:363-368, 425, 519` |
| Profile popover | Opens after 500ms hover; closes 200ms after leave | `UserProfilePopover.tsx:64, 152-167`; `popover.tsx:19` |
| Detail selection highlight | Fades over 1000ms, starting after 1200ms | above |
| Channel deep-link highlight | `route-target-highlight-fade` 2s, `bg-primary/10`; `motion-reduce:before:animate-none` | `D/features/messages/ui/TimelineMessageRow.tsx:141` |
| Resize | Pointer drag; `body.cursor = col-resize` and `userSelect: none` while dragging | `useResizableInboxListWidth.ts:58-85` |
| Actual animation feel | Not verified in OLD BUZZ (runtime) | — |

## 9. Responsive behavior

Breakpoints come from the **element width** of `[data-testid=home-inbox]` (`HomeView.tsx:108-111, 285-290`; `homePaneLayout.ts:18-72`).

| Width | Layout |
|---|---|
| ≥ 600px | list + detail, plus aux if open. List width is capped so the detail pane keeps at least 300px. |
| < 600px | one pane at a time: list → (select) → detail with a Back button. The aux pane goes full-width and hides the other panes. |
| Viewport-level | The skeleton uses `lg:` (1024px). Detail message action bar uses `sm:` offsets (640px). |

## 10. Dark mode

- The `.dark` class swaps the tokens (`theme.css:68-99`).
- Inbox-specific dark overrides:
  - header backdrop `dark:bg-background/70 dark:backdrop-blur-xl` (`HomeView.tsx:687`)
  - needs-action label `dark:text-amber-300/80` (`InboxListPane.tsx:97`)
- Everything else follows the tokens, including the `color-mix` row highlight, which is computed from `--background` and `--muted`.
