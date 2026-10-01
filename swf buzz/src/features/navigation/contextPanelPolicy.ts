/**
 * Context-panel ownership — which right-side panel a VIEW may show.
 * docs/PHASE_G_PINNED_MESSAGES_EVERYONE.md §11.
 *
 * `stores/ui.ts` holds ONE `contextPanel` (thread / profile / channel details /
 * none) and AppShell derives the details column from it. Before this policy,
 * nothing tied that state to the view: open a thread in #channel, click Inbox,
 * and Inbox rendered with `contextPanel = thread` — Inbox's own details slot
 * draws nothing for a thread, but the shell still reserved the column, leaving
 * a blank right third of the window.
 *
 * Two enforcement points, both central:
 *  1. NAVIGATION — `installContextPanelInvariant(router)`: leaving a view (any
 *     change of route NAME) closes its panel. A panel belongs to the view that
 *     opened it; it never travels to Inbox, Settings, Search… and is not
 *     resurrected on the way back. Same-view navigations (another channel,
 *     a reveal query) are untouched — those views manage their own panel.
 *  2. LAYOUT — `panelShownOn(route, panel)`: AppShell only gives the column to
 *     a panel kind the current view owns, so even a panel opened later from a
 *     shared surface (the sidebar's profile card, a mention chip) can never
 *     produce an empty reserved column on a view that cannot render it.
 *
 * Invariant: if the active view does not own the panel's kind, the panel is
 * closed — and it takes no layout space.
 */
import type { Router } from "vue-router";
import type { ContextPanel } from "@/stores/ui";

export type ContextPanelKind = Exclude<ContextPanel["kind"], "none">;

/** Each view's own panels — exactly what its `#details` slot (or sheet) renders. */
const OWNED: Readonly<Record<string, readonly ContextPanelKind[]>> = {
  // Desktop conversations (views/ChannelsView.vue, views/DmView.vue).
  channels: ["thread", "profile", "channelDetails"],
  dm: ["thread", "profile"],
  // Inbox renders a person's profile beside the feed (views/InboxView.vue).
  inbox: ["profile"],
  // HTTP-backend preview screens (CommunityChannelsView renders a thread).
  "community-channels": ["thread"],
  // Touch layouts: every mobile page shows a profile as a sheet (MobileLayout.vue).
  "mobile-home": ["profile"],
  "mobile-channel": ["profile"],
  "mobile-thread": ["profile"],
  "mobile-dm": ["profile"],
  "mobile-dm-thread": ["profile"],
  "mobile-inbox": ["profile"],
  "mobile-search": ["profile"],
  "mobile-profile": ["profile"],
};

export function ownedPanelKinds(routeName: unknown): readonly ContextPanelKind[] {
  return typeof routeName === "string" ? (OWNED[routeName] ?? []) : [];
}

/** Whether the view may show any context panel at all. */
export function viewSupportsContextPanel(routeName: unknown): boolean {
  return ownedPanelKinds(routeName).length > 0;
}

/** Whether `panel` is shown (and given layout space) on this view. */
export function panelShownOn(routeName: unknown, panel: ContextPanel): boolean {
  return panel.kind !== "none" && ownedPanelKinds(routeName).includes(panel.kind);
}

/**
 * Close the context panel whenever the user moves to a DIFFERENT view.
 * `afterEach` runs once the navigation is confirmed and before the new view
 * renders, so the new view never sees (or lays out) the old view's panel; a
 * view that opens its own panel on arrival (a reveal into a thread, Back to a
 * thread) does so from its own setup/watchers, afterwards.
 */
export function installContextPanelInvariant(router: Router, closeContextPanel: () => void): () => void {
  return router.afterEach((to, from, failure) => {
    if (failure) return;
    if (from.name !== undefined && to.name !== from.name) closeContextPanel();
  });
}
