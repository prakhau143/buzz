# Product boundary, community session and premium UI — closure

Date: 2026-09-28. Scope: the "product boundary + community session + premium UI"
brief. Status legend: PASS / PARTIAL / BLOCKED.

## What changed

| Area | Change | Evidence |
|---|---|---|
| Community URL at login | `resolveAccess` never opens a community on its own. Fresh sign-in, sign-out → sign-in and app start all land on **Choose a community**. Silent resume restores the identity, not the community. | `useAuth.ts`; tests A/B/C/E in `useAuth.spec.ts` |
| Selected community | Moved from localStorage to **sessionStorage**: kept across a reload, never across a restart. The recent-community list stays in localStorage (non-secret addresses, never auto-used). | `relayCommunities.ts`; `relayCommunities.spec.ts` |
| Choose a community | Redesigned picker (see below). Welcome shows the URL field up front. | `CommunityPickerView.vue`, `ConnectCommunityPanel.vue` |
| Connection flow | One pipeline for every entry point: URL → relay → NIP-42 → relay membership → role. It has a 3-step progress indicator driven by the real session lifecycle, and classified errors (invalid / unavailable / not a member / blocked / rejected). | `useCommunityConnect.ts`, `ConnectionStepper.vue`; `communityConnect.spec.ts` |
| Community switcher | Top-left: current community with its connection status, other recent communities (one click), Add community. Switching keeps the identity and re-authenticates on the new relay. | `CommunitySwitcher.vue` |
| Isolation | Every community-scoped cache key carries the community. A → B → A never shows A's data under B. | `communityIsolation.spec.ts` |
| Archived / huddle channels | The sidebar lists only non-archived, non-DM channels. It reacts to live 39000 updates, and the relay is authoritative. | `channelVisibility.ts`; `channelVisibility.spec.ts` |
| Huddle UI | Removed the disabled Huddle button and its hint. There are no kinds 48100–48106, no huddle commands, no audio/WebRTC. | `productBoundary.spec.ts` |
| Agent surfaces | Removed the managed-agent observer feed, the "X is working" bar, and the inbox **Agents** and **Projects** filters. SWF never shipped a built-in agent (audited). External participants' messages stay ordinary messages. | `productBoundary.spec.ts`, `externalParticipant.spec.ts` |
| Inbox scoping | An `activity` row is admitted only if it is in my DM, p-tags me, or replies in a thread I authored or replied in. Authorship (human or agent) plays no part. | `inboxModel.ts`; `inboxModel.spec.ts` |
| Read / unread | **DMs share the NIP-RS kind:30078 frontier with channels**, so the session-only `dmReadState` is retired. See the notes below. | `readState.ts`, `unreadCatchUp.ts`, `unreadPolicy.ts`; `readStateRestartCatchUp.spec.ts` |
| Search | A **"Search anything"** palette (Ctrl/Cmd+K, sidebar field), grouped as Channels / Direct messages / People / Messages. The only action is Create channel, and only when permitted. There is **no** "Create a new agent". | `paletteModel.ts`, `CommandPalette.vue`; `paletteModel.spec.ts` |
| Sidebar polish | Lock and hash icons instead of an emoji; unread shown as semibold with a badge; DM unread count badges; `aria-current`; visible focus. | `ChannelListItem.vue`, `AppSidebar.vue` |
| Responsive defect | At 769–1024 px the sidebar rendered as a full-width row above the content. The two-column layout is restored, with the details pane as an overlay at that width. Observed and re-verified in the real Tauri window. | `AppShell.vue` |

**Choose a community (picker) contents:**
- "Identity verified ✓"
- recent communities, whose membership the relay re-verifies
- a community URL field
- the connection stepper
- actionable errors: Retry / Use another community

**Read / unread details:**
- Nothing renders as unread before hydration (the gate opens even if the relay is unreachable).
- A startup catch-up counts what arrived while the app was closed.
- One rule covers live arrivals and catch-up: my own messages never count, and a thread reply counts only when it mentions me.
- Counting is de-duplicated by event id.

## Decisions and limits (stated, not hidden)

- **An app restart is a new session.** It lands on Choose a community, with the recent community one click away. A webview reload keeps the session.
- **Live huddles.**
  - Every ENDED huddle channel is hidden, because the relay archives it on end, on leave, or when its TTL reaper fires.
  - A huddle that is still RUNNING is indistinguishable from any other temporary channel without the huddle event protocol, which is out of scope. OLD BUZZ itself hides those only from a locally remembered id list.
  - It disappears the moment the relay archives it.
- **Thread-reply unread.** A reply counts only when it mentions me. OLD BUZZ also counts replies in threads I participated in; SWF under-counts those rather than guessing.
- **Agent badges kept.** The "Agent" label on external participants comes from the relay's kind:30177 records. It is passive and SWF-neutral, and it can be removed if you want no agent concept at all.
- **Sidebar shows all visible channels, not only joined ones.** SWF has no "Browse channels", so filtering to membership would remove access.
- **Palette.**
  - "Recent activity" is shown as Channels / DMs quick access: newest-message times aren't available without extra queries.
  - People comes from the community roster.
- **Palette colors.** The existing token palette is kept (warm neutrals and terracotta), so switching to blue/indigo is a values-only change in `tokens.css`.

## Verification

- typecheck, lint, build: exit 0
- cargo check: exit 0
- cargo test: 78/78
- unit suite 3× consecutive: **1162/1162** each, exit 0, identical code fingerprint `2c3d9b0d…`

**Real Tauri window, read-only against the live community:**
- the archived "LMD All Members huddle" is gone from the sidebar;
- the switcher and search field render;
- after a restart, no DM shows as unread;
- 1024 px layout: fixed and re-verified;
- 375 px: sidebar drawer.

**Not verified here:**
- the keyboard/accessibility walkthrough;
- the full width matrix on every screen, which needs navigation through your session;
- a DM-read-then-restart check against the live relay;
- local E2E for the new routing.

The previous local E2E pass predates these changes. Its routing assertion (`liveRelay:853`) accepts the new route.
