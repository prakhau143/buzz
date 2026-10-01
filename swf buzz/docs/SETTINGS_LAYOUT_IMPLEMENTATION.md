# Settings Layout — Full-Width Content

**Date:** 2026-09-29 · **Scope:** layout and styling only. Settings persistence, profile sync,
notifications, shortcuts, custom emoji, community, invites, mobile pairing and updates are unchanged.

## Old problem

`src/features/settings/ui/SettingsView.vue` wrapped every section in
`.content-inner { max-width: 820px; margin: 0 auto; }`. Every page (Appearance, Profile,
Notifications, …) was therefore a narrow centered column, with a large empty band to the right
on desktop widths. It was one architectural rule, not a per-page issue.

## New architecture

```text
SettingsView (.settings-shell)   grid: 240px | minmax(0, 1fr), height 100vh
├── .settings-nav                sidebar: Back to app · title · search · groups · version
└── .settings-content            min-width 0, overflow-y auto, overflow-x hidden  ← the only scroller
    └── .content-inner           width 100%, max-width none, padding 40px clamp(24px, 4vw, 64px) 64px
        └── <SettingsPage>       header (h1 + description) + cards, all on the same left edge
```

- **The fix is at the shell.** `max-width` and centering were removed from `.content-inner`,
  so **all nine sections inherit full width**. No page-specific width overrides were added.
- **Cards** (`SettingsCard`, `SettingsRow`) are block-level and stretch across the content
  area. Controls keep their natural size, right-aligned (segmented controls, toggles, accent
  swatches, buttons, shortcut badges).
- **Grids stay responsive** (`auto-fill`): theme previews (min 150 px) and custom emoji (min
  112 px). Previews keep a consistent card size instead of stretching three cards across 1100 px.
- **Readable prose:** only the page subtitle (`70ch`) and Mobile's two explanatory paragraphs
  (520 px) keep a line-length cap. These are sentences, not layout. Cards and controls around
  them are full width.
- **Sidebar:** 268 → **240 px**, padding `18px 12px 20px`, so "Back to app" no longer sits
  against the edge.

## Responsive

| Width | Layout |
|---|---|
| ≥ 1100 px | 240 px sidebar + full-width content |
| 861–1099 px | 220 px sidebar + full-width content |
| ≤ 860 px | Sidebar replaced by the existing sticky compact bar (← back + section picker); full-width content |

The content padding scales with `clamp(24px, 4vw, 64px)`. Nothing overflows horizontally
(`overflow-x: hidden`, `min-width: 0` on the grid column), and there's one vertical scroller.

## Visual QA

The real `SettingsView` was rendered in a temporary harness (headless Edge; harness deleted):

| Page | Width | Result |
|---|---|---|
| Appearance | 1440 | Header and cards full width, aligned; controls compact and right-aligned; theme grid consistent |
| Appearance | 1024 | 220 px sidebar, full-width content |
| Notifications | 1440 | Grouped full-width cards; toggles right-aligned |
| Shortcuts | 1280 | Full-width two-column rows (label · key badges) |
| Appearance | 760 | Compact bar; full-width cards; no overflow |
| Appearance, dark | 1280 | Full width in "System → dark" (SWF Dark theme); contrast correct |

**Not captured individually:** Profile, Custom emoji, Community, Invites, Mobile, Updates. They
render inside the same `.content-inner`, so they inherit the layout. None of their own styles set a
page width: a source check found only thumbnail and paragraph limits. 430/390/375/320 px use the
same compact-bar layout verified at 760 px.

## Files changed

- `src/features/settings/ui/SettingsView.vue`: `.content-inner` full width, new padding; sidebar
  240 / 220 px and padding.
- `src/features/settings/ui/primitives/SettingsPage.vue`: subtitle `max-width: 70ch`.

## Tests

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- Settings tests (`tests/unit/features/settings/*`): 16 / 16 PASS
- `npm run build`: PASS
- Full unit suite: **1269 / 1269 PASS** (126 files)
