import { createRouter, createWebHistory } from "vue-router";
import { useSessionStore } from "@/stores/session";
import { useAccessStore } from "@/stores/access";
import { isPlatformAdminConfigured } from "@/features/platform-admin/usePlatformAdmin";
import { attemptSilentResume } from "@/features/auth/useAuth";
import { getPendingInviteToken } from "@/features/communities/pendingInvite";
import { useUiStore } from "@/stores/ui";
import { installContextPanelInvariant } from "@/features/navigation/contextPanelPolicy";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
      meta: { public: true },
    },
    {
      // Browser-only Okta redirect target — see docs/WEB_LOCAL_DEVELOPMENT.md.
      // Never reached in the native Tauri build (a custom URL scheme deep
      // link is used there instead, with no in-app route equivalent).
      path: "/callback",
      name: "okta-callback",
      component: () => import("@/views/OktaCallbackView.vue"),
      meta: { public: true },
    },
    {
      // Default landing page after login — see HomeView.vue.
      path: "/",
      name: "home",
      component: () => import("@/views/HomeView.vue"),
    },
    {
      // The original Nostr-based channels UI — kept at its own path
      // (moved off `/`, which is now Home) rather than removed: reactions,
      // presence, agent activity, and moderation still depend on it
      // entirely (OLD_BUZZ_PARITY_NO_NOSTR_PLAN.md §2). Route *name*
      // ("channels") is unchanged so existing `router.push({name:
      // "channels", ...})` call sites elsewhere keep working untouched.
      path: "/channels",
      name: "channels",
      component: () => import("@/views/ChannelsView.vue"),
      props: (route) => ({ channelId: route.query.channelId ?? null }),
    },
    {
      // The Inbox workspace (list | detail | profile) — a route, not a modal.
      path: "/inbox",
      name: "inbox",
      component: () => import("@/views/InboxView.vue"),
    },
    {
      path: "/dm",
      name: "dm",
      component: () => import("@/views/DmView.vue"),
      props: (route) => ({ conversationId: route.query.conversationId ?? null }),
    },
    {
      // New-backend (DECISIONS.md D10) channels/messages/threads UI — see
      // CommunityChannelsView.vue's own doc comment for why this is a
      // separate route from `/` rather than a retrofit of ChannelsView.vue.
      path: "/community",
      name: "community-channels",
      component: () => import("@/views/CommunityChannelsView.vue"),
    },
    {
      // New-backend (DECISIONS.md D10) direct-messages UI — see
      // CommunityDmView.vue's own doc comment for why this is a separate
      // route from `/dm` rather than a retrofit of DmView.vue.
      path: "/community-dm",
      name: "community-dm",
      component: () => import("@/views/CommunityDmView.vue"),
    },
    {
      // Where swfbuzz:// deep links land, and the manual "join with invite" screen.
      // Public so the guard does not try to resume a session first: joining only
      // needs the local identity to sign one HTTP request, and works before any
      // membership exists.
      path: "/join",
      name: "join",
      component: () => import("@/views/JoinCommunityView.vue"),
      meta: { public: true },
    },
    {
      // Signed-in identity that belongs to no community yet: join with an invite.
      // Public so the guard doesn't demand a relay session — the views themselves
      // need the local identity and redirect to /login without one.
      path: "/welcome",
      name: "welcome",
      component: () => import("@/views/WelcomeView.vue"),
      meta: { public: true },
    },
    {
      // A relay operator's home: the communities they own (and belong to), and
      // "Create Community". Operator status is the relay's answer, not a flag.
      path: "/operator",
      name: "operator",
      component: () => import("@/views/OperatorDashboardView.vue"),
      meta: { public: true },
    },
    {
      // Member of several communities: pick one. The list is the identity's actual
      // memberships as answered by each relay — not a URL selector.
      path: "/communities",
      name: "communities",
      component: () => import("@/views/CommunityPickerView.vue"),
      meta: { public: true },
    },
    {
      // First-run kind:0 profile (asked once, after the user is in a community).
      path: "/profile-setup",
      name: "profile-setup",
      component: () => import("@/views/ProfileSetupView.vue"),
    },
    {
      // Public invite landing page (DECISIONS.md D10) — reachable without a
      // session; see InviteLandingView.vue's own doc comment.
      path: "/invite/:token",
      name: "invite",
      component: () => import("@/views/InviteLandingView.vue"),
      meta: { public: true },
    },
    {
      // Full-screen Settings (docs/OLD_BUZZ_SETTINGS_FEEDBACK_AUDIT.md §2): replaces
      // the app chrome entirely. `?section=` picks the page; `?from=` is where
      // "Back to app" returns.
      path: "/settings",
      name: "settings",
      component: () => import("@/features/settings/ui/SettingsView.vue"),
      meta: { fullscreen: true },
    },
    // ---- Mobile (< 768px): a single navigation stack + bottom nav, its own
    // routes so every level is a history entry (features/mobile/mobileRoutes.ts).
    // `meta.mobile` makes App.vue drop the desktop header and rail. The same
    // session guard applies as for the desktop in-community routes.
    {
      path: "/m",
      name: "mobile-home",
      component: () => import("@/features/mobile/views/MobileHomeView.vue"),
      meta: { mobile: true },
    },
    {
      path: "/m/c/:channelId",
      name: "mobile-channel",
      component: () => import("@/features/mobile/views/MobileChannelView.vue"),
      props: true,
      meta: { mobile: true },
    },
    {
      path: "/m/c/:channelId/t/:rootId",
      name: "mobile-thread",
      component: () => import("@/features/mobile/views/MobileThreadView.vue"),
      props: true,
      meta: { mobile: true },
    },
    {
      path: "/m/d/:conversationId",
      name: "mobile-dm",
      component: () => import("@/features/mobile/views/MobileDmView.vue"),
      props: true,
      meta: { mobile: true },
    },
    {
      path: "/m/d/:conversationId/t/:rootId",
      name: "mobile-dm-thread",
      component: () => import("@/features/mobile/views/MobileThreadView.vue"),
      props: (route) => ({ channelId: route.params.conversationId, rootId: route.params.rootId, dm: true }),
      meta: { mobile: true },
    },
    {
      path: "/m/inbox",
      name: "mobile-inbox",
      component: () => import("@/features/mobile/views/MobileInboxView.vue"),
      meta: { mobile: true },
    },
    {
      path: "/m/search",
      name: "mobile-search",
      component: () => import("@/features/mobile/views/MobileSearchView.vue"),
      meta: { mobile: true },
    },
    {
      path: "/m/profile",
      name: "mobile-profile",
      component: () => import("@/features/mobile/views/MobileProfileView.vue"),
      meta: { mobile: true },
    },
    {
      path: "/platform-admin",
      name: "platform-admin",
      component: () => import("@/features/platform-admin/ui/PlatformAdminView.vue"),
      meta: { requiresAdminConsole: true },
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: "/",
    },
  ],
});

/**
 * The one authoritative route guard — see docs/AUTHENTICATION_AUTHORIZATION_AUDIT.md
 * §7/§14 and docs/AUTHORIZATION_RUNTIME_FLOW.md. Requires `isReady`, not just
 * `isAuthenticated`: a session mid-identity/role-resolution (or one that
 * failed to resolve — `authError`) must not reach a protected view, closing
 * the "dashboard renders before role is known" gap the audit found.
 *
 * `/platform-admin`'s actual role check (Operator/Moderator, a platform-wide
 * role plane resolved via an async `GET /probe` call — see
 * docs/PROTOCOL_IMPLEMENTATION_REFERENCE.md §11) is deliberately NOT
 * duplicated here: that role can only be known by making a network call,
 * which a synchronous route guard can't cleanly do without either
 * prefetching on every navigation or trusting a possibly-stale cache. The
 * content-level `useAdminProbe()` gate inside `PlatformAdminView.vue`
 * remains the authoritative check for that specific role; this guard only
 * short-circuits the cheap, synchronous case — the admin console isn't even
 * configured for this build — before the page has a chance to render at all.
 */
/**
 * `attemptSilentResume` (DECISIONS.md D10) needs to run once, before the
 * very first navigation decision, so a valid stored `swf-buzz-backend`
 * session resolves the user straight to `channels` instead of flashing
 * `/login` first — the guard is async specifically so Vue Router waits for
 * it. It cannot run as a plain module-level `await` here because Pinia
 * isn't active yet at router-module-import time (`main.ts` creates it
 * afterward); running it lazily on the first guard invocation is what
 * guarantees `app.use(createPinia())` has already happened.
 */
let resumeAttempted = false;

router.beforeEach(async (to) => {
  if (!resumeAttempted) {
    resumeAttempted = true;
    // Only meaningful for a route that isn't already public — resuming
    // into /login or /callback would be wasted work on every fresh-process
    // navigation to those routes (e.g. a full page reload while already on
    // /callback during the browser OIDC flow).
    if (!to.meta.public) {
      await attemptSilentResume();
    }
  }

  const session = useSessionStore();
  if (!to.meta.public && !session.isReady) {
    // A local identity that is signed in but has not entered a community yet
    // (Operator, several communities, or none) goes to the screen the central
    // routing decision chose — never back to a login that asks for nothing new.
    const destination = useAccessStore().destination;
    if (session.authMode === "local" && session.pubkey && destination) {
      return { name: destination };
    }
    return { name: "login" };
  }
  if (to.name === "login" && session.isReady) {
    return { name: "home" };
  }
  // The local identity (OLD-BUZZ-style, no Okta) has no `swf-buzz-backend`
  // session, and Home is HTTP-backend based — so it lands on the Nostr channels
  // view, its primary UI. Legacy (Okta/dev) sessions keep landing on Home.
  // TODO(identity-migration): the invite flow below is HTTP/Okta-based and is
  // migrated in a later phase; it is skipped for local-identity sessions.
  if (to.name === "home" && session.authMode === "local") {
    return { name: "channels" };
  }
  // `loginWithOkta()` (`useAuth.ts`) unconditionally lands on `home`
  // once login succeeds — it has no notion of "return to where I was."
  // `InviteLandingView.vue` stashes the token before triggering login
  // specifically so this can redirect back rather than stranding the user
  // on the dashboard mid-invite-claim. See `pendingInvite.ts`. Only
  // consumed once: a `home` landing with no pending token is a no-op.
  if (to.name === "home") {
    const pendingInviteToken = getPendingInviteToken();
    if (pendingInviteToken) {
      return { name: "invite", params: { token: pendingInviteToken } };
    }
  }
  if (to.meta.requiresAdminConsole && !isPlatformAdminConfigured()) {
    return { name: "channels" };
  }
  return true;
});

// A view's context panel (thread / profile / details) never outlives the view:
// moving to another view closes it, so Inbox / Settings / Search… always start
// full width (features/navigation/contextPanelPolicy.ts). `useUiStore()` is
// resolved per navigation, when Pinia is long active.
installContextPanelInvariant(router, () => useUiStore().closeContextPanel());

export default router;
