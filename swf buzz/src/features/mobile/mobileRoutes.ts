import type { RouteLocationNormalizedLoaded, RouteLocationRaw } from "vue-router";

/**
 * The mobile navigation stack is made of real routes, so every level is a
 * history entry and the platform back (Android back button, browser back,
 * swipe) walks it naturally:
 *
 *   /m                      Home        (community + channels)       depth 0
 *   /m/c/:channelId         Conversation                              depth 1
 *   /m/c/:channelId/t/:root Thread                                    depth 2
 *   /m/d/:conversationId    DM conversation                           depth 1
 *   /m/d/:conversationId/t/:root  DM thread                           depth 2
 *   /m/inbox, /m/search, /m/profile      bottom-nav destinations      depth 0
 *
 * Desktop routes stay exactly as they are. Crossing the breakpoint maps the
 * current place to its counterpart, so rotating a tablet or resizing a window
 * keeps you where you were.
 */
export const MOBILE_ROUTE_NAMES = [
  "mobile-home",
  "mobile-channel",
  "mobile-thread",
  "mobile-dm",
  "mobile-dm-thread",
  "mobile-inbox",
  "mobile-search",
  "mobile-profile",
] as const;
export type MobileRouteName = (typeof MOBILE_ROUTE_NAMES)[number];

export function isMobileRoute(name: unknown): name is MobileRouteName {
  return MOBILE_ROUTE_NAMES.includes(name as MobileRouteName);
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Where a desktop in-community route lives on mobile, or null when the route is
 * not an in-community view (sign-in, picker, settings…) and must be left alone.
 */
export function mobileCounterpart(route: Pick<RouteLocationNormalizedLoaded, "name" | "query">): RouteLocationRaw | null {
  switch (route.name) {
    case "home":
      return { name: "mobile-home" };
    case "channels": {
      const channelId = str(route.query.channelId);
      if (!channelId) return { name: "mobile-home" };
      const { root, reveal } = revealOf(route.query);
      return root
        ? { name: "mobile-thread", params: { channelId, rootId: root }, ...reveal }
        : { name: "mobile-channel", params: { channelId }, ...reveal };
    }
    case "dm": {
      const conversationId = str(route.query.conversationId);
      if (!conversationId) return { name: "mobile-home" };
      const { root, reveal } = revealOf(route.query);
      return root
        ? { name: "mobile-dm-thread", params: { conversationId, rootId: root }, ...reveal }
        : { name: "mobile-dm", params: { conversationId }, ...reveal };
    }
    case "inbox":
      return { name: "mobile-inbox" };
    default:
      return null;
  }
}

/**
 * The desktop reveal query (`?messageId=&threadRootId=`) as mobile sees it: a
 * thread root to open (a reply's root, or a bare "open this thread"), and the
 * message to reveal as `?m=`. A root that IS the message is revealed in the feed.
 */
function revealOf(query: RouteLocationNormalizedLoaded["query"]): { root: string | null; reveal: { query?: { m: string } } } {
  const message = str(query.messageId);
  const root = str(query.threadRootId);
  return {
    root: root && root !== message ? root : null,
    reveal: message ? { query: { m: message } } : {},
  };
}

/** Where a mobile route lives on desktop (the pending `?m=` reveal travels as `messageId`). */
export function desktopCounterpart(
  route: Pick<RouteLocationNormalizedLoaded, "name" | "params"> & { query?: RouteLocationNormalizedLoaded["query"] },
): RouteLocationRaw | null {
  const channelId = str(route.params.channelId);
  const m = str(route.query?.m);
  const reveal = m ? { messageId: m } : {};
  switch (route.name) {
    case "mobile-home":
    case "mobile-search":
    case "mobile-profile":
      return { name: "channels" };
    case "mobile-channel":
      return channelId ? { name: "channels", query: { channelId, ...reveal } } : { name: "channels" };
    case "mobile-thread": {
      const root = str(route.params.rootId);
      return channelId && root
        ? { name: "channels", query: { channelId, threadRootId: root, ...reveal } }
        : { name: "channels" };
    }
    case "mobile-inbox":
      return { name: "inbox" };
    case "mobile-dm": {
      const conversationId = str(route.params.conversationId);
      return conversationId ? { name: "dm", query: { conversationId, ...reveal } } : { name: "channels" };
    }
    case "mobile-dm-thread": {
      const conversationId = str(route.params.conversationId);
      const root = str(route.params.rootId);
      return conversationId && root
        ? { name: "dm", query: { conversationId, threadRootId: root, ...reveal } }
        : { name: "channels" };
    }
    default:
      return null;
  }
}

/** The screen one level up — used when there is no in-app history to go back to. */
export function parentOf(route: Pick<RouteLocationNormalizedLoaded, "name" | "params">): RouteLocationRaw {
  if (route.name === "mobile-thread") {
    const channelId = str(route.params.channelId);
    if (channelId) return { name: "mobile-channel", params: { channelId } };
  }
  if (route.name === "mobile-dm-thread") {
    const conversationId = str(route.params.conversationId);
    if (conversationId) return { name: "mobile-dm", params: { conversationId } };
  }
  return { name: "mobile-home" };
}

/** Stack depth, for the direction of the page transition. */
export function depthOf(name: unknown): number {
  if (name === "mobile-thread" || name === "mobile-dm-thread") return 2;
  if (name === "mobile-channel" || name === "mobile-dm") return 1;
  return 0;
}
