# Phase 3 — Chat UI Design (Audit B)

Design only — no code changed. Companion to `PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md` (Audit A), whose §0/§13 finding governs this whole document: **`src/views/ChannelsView.vue` already implements most of Phase 3's structure and behavior.** This document audits what's there, and designs (without implementing) the remainder — primarily verification of existing visual/UX quality against the enterprise/cream direction, plus the genuinely-missing pieces (thread placement decision, agent-activity spec, responsive rules, state matrix).

## 1. Design principles

1. Reuse the existing token system and `AppShell`/`AppSidebar` — do not introduce a second layout primitive.
2. Cream/white, low-chroma, enterprise-desktop register — the existing palette (`--color-bg:#f7f3ea`, terracotta accent `--color-primary:#b1592f`, dark-green brand `--color-brand-dark`) already matches this; new chat components must draw from it, never hardcode colors.
3. OLD BUZZ is a protocol/behavior reference only — its desktop UI is not a source for SWF visuals.
4. Prefer verifying/polishing what `ChannelsView.vue` already renders over building parallel components.
5. Desktop-first, but the shell must degrade to tablet/mobile without a second codepath (§8).

## 2. Current UI audit

| Area | File | State |
|---|---|---|
| App shell | `src/layouts/AppShell.vue` | **Already 3-column-capable**: CSS grid `260px 1fr` (2-col) → `260px 1fr 300px` (3-col) via `.body:has(.details-pane)`, sidebar collapsible via `uiStore.sidebarCollapsed`. This *is* the structure Audit B §2 below asks for — reuse, don't rebuild. |
| Design tokens | `src/app/theme/tokens.css` | **Already complete** for this spec: surfaces, text, borders, accent (terracotta), brand (dark green), semantic (danger/success/warning), a dedicated `--color-agent`/`--color-agent-muted` pair (already anticipates agent UI), elevation, radius, spacing scale (4/8/12/16/24/32/48), typography (Inter + JetBrains Mono), motion. Dark mode: token seam present, not implemented (documented as intentional, "not in scope for v1"). |
| Channel view | `src/views/ChannelsView.vue` | Composes header, message list, composer, thread panel, members modal, channel details panel, typing indicator, agent activity bar — see Audit A §13 for the full composition list. |
| Channel sidebar | Not a standalone component — channel list rendering was not located as a separate `ChannelSidebar.vue`; likely inline in `AppSidebar.vue` or a slot fill from `ChannelsView.vue`. **Not independently confirmed in this pass** — before Phase 3.9 polish, read `AppSidebar.vue` in full to see whether channel-list markup already exists there or needs extracting into its own component. |
| Buttons/modals | `BaseButton.vue` (confirmed used by `AppShell.vue`), `MembersModal.vue`, `CreateChannelDialog.vue`, `ReportMessageDialog.vue` | Existing modal/dialog components already in the codebase — reuse their pattern for any new dialog rather than inventing a new one. |
| Empty/loading/error states | `StateView.vue` (imported by `ChannelsView.vue:5`) | A generic state component already exists and is used for at least one state in the channel view — reuse for §10's matrix rather than one-off per-component states. |

**What to reuse vs. redesign**: reuse the shell, tokens, `StateView`, `BaseButton`, modal pattern, and the entire data/composable layer (Audit A §12). Redesign candidates are narrow: confirm `MessageList.vue`/message bubble visual treatment matches the cream/enterprise direction (not inspected pixel-level in this pass), and design the pieces that don't exist yet — thread placement decision (§6), agent activity bar content rules (§7), pagination/loading affordances (§4), and the state matrix (§10).

## 3. Phase 3 information architecture

Matches the existing `AppShell` slot structure almost exactly — this is confirmation, not a new design:

```
Community (AppShell)
 ├── sidebar slot
 │    ├── Community identity (existing, outside ChannelsView per AppHeader.vue)
 │    ├── Channel list             ← confirm/extract per §2
 │    ├── Direct Messages          ← features/dm already implemented (Audit A)
 │    └── Community actions (create channel, invite)
 │
 └── main slot
      ├── ChannelHeader.vue                  (exists)
      ├── MessageList.vue                    (exists)
      ├── ThreadPanel.vue                    (exists — as details-pane, see §6)
      ├── MessageComposer.vue                (exists)
      └── AgentActivityBar.vue               (exists, content source needs Audit A §14.6 follow-up)
```

## 4. Channel sidebar design

Design intent (verify against the actual, not-yet-read `AppSidebar.vue` channel-list markup before implementing anything net-new):

- **Channel list**: grouped by visibility if useful (public/private), otherwise flat, alphabetical or server-insertion order (protocol has no ordering guarantee — Audit A §1).
- **Active channel**: `--color-surface-hover` background + `--color-primary` left-accent bar or bold label; driven by `ui.selectedChannelId` (already exists, `ChannelsView.vue:43`).
- **Unread count**: badge, `--color-primary` on `--color-text-on-accent`; **blocked on §9 not existing yet in protocol or client** — do not build the visual before the underlying local-read-state design lands.
- **Mention count**: distinguish from plain-unread with `--color-danger`/`--color-warning` treatment (mentions matter more); same blocker as above.
- **Channel icons**: `#` for open, a lock glyph for private (matches `public`/`private` tags, Audit A §1).
- **Create channel button**: reuse `CreateChannelDialog.vue` (exists).
- **Loading state**: skeleton rows using `--color-surface-muted`, via `StateView.vue`.
- **Empty state**: "No channels yet" + the create-channel CTA, via `StateView.vue`.
- **Permission-aware actions**: create-channel button always visible (Audit A §2 — any member can create); per-channel context menu (leave/delete) gated by `channelPermissions.ts` (exists).

## 5. Channel view

```
ChannelHeader.vue        (exists)
  ↓ name, channel_type icon, topic/purpose if set (Audit A §1 tags)
Message history
  ↓ MessageList.vue (exists) — virtualization not confirmed, verify before assuming it scales
Pagination / loading
  ↓ NOT YET DESIGNED IN CODE — older-message fetch doesn't exist (Audit A §14.1); UI affordance: a
    "Load older messages" affordance at scroll-top, or auto-fetch-on-scroll-near-top, both standard;
    pick auto-fetch to match the enterprise-chat convention (Slack/Teams), gated behind an
    intersection-observer sentinel row
MessageComposer.vue      (exists)
```

State designs (per §1's principle of reusing `StateView.vue`):
- **Empty channel**: "No messages yet — say hello" centered state.
- **Loading history**: skeleton message rows, not a spinner (avoids layout jump on load).
- **Failed history**: `StateView` error variant + retry action, wired to the existing `refetchMessages` (`ChannelsView.vue:66`).
- **Sending**: optimistic message shown immediately (already built — `optimisticMessage.ts` exists) with a subdued/pending visual treatment until confirmed.
- **Send failure**: inline retry affordance on the failed bubble — `retryMessage()` already exists in `ChannelsView.vue:86-97`, needs only a UI affordance if not already present (not confirmed in the 120 lines read).
- **Reconnecting**: a slim top-of-pane banner (`--color-warning-muted` background), tied to whatever connection-state signal `RelayConnectionService` exposes — **existence of that signal not confirmed**, check before implementing (Audit A §14.2).
- **New message indicator**: when scrolled up and a new message arrives, a "↓ New messages" pill above the composer rather than silently jumping the scroll position.

## 6. Message UI

- **Avatar/identity**: pubkey-derived (profile kind:0 `display_name`/`avatar`, Audit A §1's profile sync note) — identicon fallback when no avatar set.
- **Display name**: from kind:0 `display_name`/`name`; agent messages get a distinct badge (uses `--color-agent`/`--color-agent-muted`, already reserved in tokens for exactly this).
- **Timestamp**: relative for recent ("2m ago"), absolute on hover (standard enterprise-chat pattern).
- **Content**: markdown-light (bold/italic/code/links); code blocks use `--font-mono`.
- **Reactions**: pill row below content, existing `ReactionService`/`useAddReaction` (Audit A §12) — add via a "+" affordance on hover, matching §8's hover-actions row.
- **Reply/thread action**: hover action opens `ThreadPanel.vue` (already exists) — see §6-thread-placement below for *where* it opens.
- **Edit/delete**: hover actions, self-authored only by default (Audit A §3); owner/admin get delete on others' messages.
- **Hover actions row**: react / reply / edit (if permitted) / delete (if permitted) / report (`ReportMessageDialog.vue` already exists and is wired).
- **System messages**: distinct style (centered, muted, no avatar) for membership-change/system events if SWF chooses to render `44100`/`44101` in-timeline — **decision not made here**, flagging as a scope question for whoever picks up 3.1 verification, since the protocol delivers these events regardless of whether the UI renders them.

## 7. Thread UI — placement decision

**Decision: side panel, not inline expansion or modal.**

Reasoning:
- `ThreadPanel.vue` already exists and `AppShell.vue` already has a `details-pane` slot (260px sidebar / 1fr main / 300px details grid, confirmed in §2) — a side panel is a zero-new-layout-primitive fit, while inline expansion would require restructuring `MessageList.vue`'s virtualization (if any, unconfirmed) to handle variable-height expanding rows, and a modal would block the main timeline, which is wrong for a "keep chatting while reading a thread" enterprise pattern (Slack/Teams both use side panel for exactly this reason).
- Desktop-first target (§ principles) favors persistent peripheral panels over modals, which are a mobile/interruptive pattern.
- At narrow widths (§8, ≤768px) the side panel becomes the *only* visible pane (sidebar and details both collapse), which is a natural extension of the existing `sidebarCollapsed`/`detailsPaneOpen` toggles already in `uiStore` — no new responsive mechanism needed, just tighter breakpoint rules than whatever currently governs those toggles (not inspected — check `stores/ui.ts` before implementing §8).

Do not copy OLD BUZZ's desktop thread UI (out of scope per protocol-only reuse rule) — this decision is derived from SWF's own existing shell, not from OLD BUZZ.

## 8. Agent activity UI

Two distinct surfaces, per the user's explicit requirement:

1. **Agent chat messages** (the agent posting an actual kind:9 message, e.g. a diff or a result): render exactly like a normal message (§6), with the agent-badge treatment (`--color-agent`) as the only visual distinction from a human message.
2. **Agent verbose activity** ("Poseidon is analyzing the request…"): renders **only** in `AgentActivityBar.vue` (exists, mounted in `ChannelsView.vue:30`), a slim bar pinned above the composer — never injected into the message timeline. Content is driven by `useAgentActivity(agentPubkeysInScope, typingPubkeys)` (`ChannelsView.vue:77-80`).

**Open question flagged, not answered**: Audit A §11/§14.6 could not confirm whether the *text* ("is analyzing…") actually flows through the typing-indicator's free-form status string (`NOSTR.md:64`, 128-char cap) or something else. This matters for the UI design because a 128-char cap constrains how verbose "analyzing…" copy can be, and because typing indicators are ephemeral/not stored — if the activity bar's content model is typing-status-based, a page refresh mid-activity will show nothing until the next status update. Resolve this in code before finalizing the bar's copy/animation design; the visual container (slim bar, `--color-agent-muted` background, small avatar + single-line truncated text + a subtle pulsing/ellipsis animation while "active") can be designed now regardless of the answer.

## 9. Responsive design

| Breakpoint | Sidebar | Details/Thread pane | Main |
|---|---|---|---|
| 1440+ | Fixed 260px, always visible | Fixed 300px when open (3-col grid, already exists) | Fluid |
| 1280 | Fixed 260px | 300px, same as above | Fluid, tighter message-list max-width |
| 1024 | Collapsible via existing `sidebarCollapsed` toggle | Collapsible via existing `detailsPaneOpen` toggle | Fluid |
| 768 | Collapsed by default, overlay-on-open (drawer) rather than push | Same — overlay, not a third column | Full width |
| 390 / 375 | Drawer, closed by default | Drawer/full-screen when a thread is opened (replaces main view, not a column) | Full width, channel list and thread view become separate "screens" rather than panes |

This is a *tightening* of breakpoints against the app's **existing** collapse mechanism (`sidebarCollapsed`, `detailsPaneOpen` in `uiStore`, confirmed present and driving the CSS grid in `AppShell.vue`), not a new implementation — do not create a second mobile-specific component tree (per principle 5). Exact current breakpoint values in `stores/ui.ts`/`AppShell.vue`'s CSS were **not inspected** in this pass; confirm before assuming none exist yet.

## 10. Design system (tokens)

**Already implemented in full** (`src/app/theme/tokens.css`) — do not create a second token file. Inventory against the spec's requested categories:

| Category | Token(s) | Status |
|---|---|---|
| Colors/backgrounds | `--color-bg`, `--color-surface`, `--color-surface-muted`, `--color-surface-hover`, `--color-overlay` | Present |
| Border | `--color-border`, `--color-border-strong` | Present |
| Text | `--color-text`, `--color-text-muted`, `--color-text-subtle`, `--color-text-on-accent` | Present |
| Accent | `--color-primary`, `--color-primary-hover`, `--color-primary-muted` | Present |
| Danger/success/warning | `--color-danger(-muted)`, `--color-success(-muted)`, `--color-warning(-muted)` | Present |
| Agent (new for chat) | `--color-agent`, `--color-agent-muted` | **Already present and unused elsewhere** — confirms tokens were pre-anticipating chat/agent UI |
| Spacing | `--space-1..7` (4/8/12/16/24/32/48) | Present |
| Radius | `--radius-sm/md/lg/full` | Present |
| Shadow | `--shadow-sm/md/lg` | Present |
| Typography | `--font-sans` (Inter), `--font-mono` (JetBrains Mono), `--font-size-xs..xl`, line-heights | Present |
| z-index | **Not found** in the tokens file read (lines 1-100) | Gap — needed for the thread side-panel/modal/details-pane stacking order once more overlapping surfaces exist; add a small `--z-*` scale (e.g. `--z-dropdown`, `--z-modal`, `--z-toast`) as the one genuinely missing token category |

## 11. UI state matrix

| State | Channel list | Message list | Composer |
|---|---|---|---|
| Loading | Skeleton rows | Skeleton bubbles | Disabled |
| Empty | "No channels" + create CTA | "No messages yet" | Enabled |
| Error | `StateView` error + retry | `StateView` error + retry (`refetchMessages` exists) | Enabled, send may fail |
| Offline | Dim list, no new-message affordance | Reconnect banner (§5) | Disabled or queued-send |
| Reconnecting | Same as offline, subtler | Reconnect banner | Disabled |
| Permission denied | N/A (list is read-visible) | Read-only banner, composer hidden/disabled | Hidden |
| Sending | — | Optimistic bubble, pending style | Locked to prevent double-send |
| Sent | — | Normal bubble | Cleared, refocused |
| Failed | — | Failed bubble + retry (`retryMessage` exists) | Content preserved for edit-and-retry |
| Unread | Badge (blocked on §9-in-Audit-A) | — | — |
| Mention | Distinct badge color | Highlighted bubble background | — |
| Thread open | Active-thread channel highlighted | Root message highlighted | Composer context switches to "replying in thread" |
| No channels | Full-pane empty state | N/A | Hidden |

## 12. Loading/error/empty states — implementation note

Route everything above through `StateView.vue` (confirmed already in use, `ChannelsView.vue:5`) rather than ad-hoc per-component markup, to keep the states visually consistent app-wide — this is a reuse instruction, not a new design.

## 13. Accessibility

Not audited in depth in this pass (would require reading component templates for ARIA roles/keyboard handling, out of budget here). Minimum bar for Phase 3.9: message list is a `log`/`feed`-role region with polite live-region announcements for new messages; composer is a standard labeled textarea with Enter-to-send/Shift+Enter-newline (verify existing `MessageComposer.vue` behavior before assuming); thread side-panel traps focus when open on narrow viewports (§9, where it becomes full-screen); all interactive icons (react, reply, more-actions) need accessible labels, not icon-only. Flagged as a to-do for 3.9, not designed in detail here.

## 14. Component map

Existing (reuse): `AppShell.vue`, `AppSidebar.vue`, `ChannelHeader.vue`, `ChannelMenu.vue`, `MembersModal.vue`, `UserProfilePanel.vue`, `ChannelDetailsPanel.vue`, `MessageList.vue`, `MessageComposer.vue`, `ThreadPanel.vue`, `TypingIndicator.vue`, `AgentActivityBar.vue`, `ReportMessageDialog.vue`, `CreateChannelDialog.vue`, `StateView.vue`, `BaseButton.vue`.

Net-new (per the gaps in Audit A §14 and this doc): a "Load older messages" sentinel/affordance inside `MessageList.vue` (extends existing component, not a new one); a reconnect banner component; an unread/mention badge component (blocked until §9-Audit-A's local-read-state design exists); a `--z-*` token addition.

## 15. Phase 3 implementation order

Same order as Audit A §16 (kept identical deliberately — the two audits agree): 3.1 verify → 3.2 verify → 3.3 verify → 3.4 build pagination/reconnect → 3.5 verify → 3.6 verify+fix reactions → 3.7 build unread/mentions → 3.8 confirm+extend agent activity → 3.9 responsive/a11y/polish using this document's §9/§11/§13.

---

PHASE 3 PROTOCOL AUDIT: see `PHASE_3_OLD_BUZZ_PROTOCOL_AUDIT.md` — COMPLETE
PHASE 3 UI DESIGN AUDIT: COMPLETE
IMPLEMENTATION: NOT STARTED
