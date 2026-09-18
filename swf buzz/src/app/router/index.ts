import { createRouter, createWebHistory } from "vue-router";
import { useSessionStore } from "@/stores/session";
import { isPlatformAdminConfigured } from "@/features/platform-admin/usePlatformAdmin";
import { attemptSilentResume } from "@/features/auth/useAuth";
import { getPendingInviteToken } from "@/features/communities/pendingInvite";

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
      // Public invite landing page (DECISIONS.md D10) — reachable without a
      // session; see InviteLandingView.vue's own doc comment.
      path: "/invite/:token",
      name: "invite",
      component: () => import("@/views/InviteLandingView.vue"),
      meta: { public: true },
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
    return { name: "login" };
  }
  if (to.name === "login" && session.isReady) {
    return { name: "home" };
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

export default router;
