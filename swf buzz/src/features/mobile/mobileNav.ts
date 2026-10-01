import { ref } from "vue";
import { useRoute, useRouter, type Router } from "vue-router";
import { depthOf, isMobileRoute, parentOf } from "./mobileRoutes";

/**
 * Which way the last mobile navigation went, for the page transition:
 * deeper (Home → Conversation → Thread) slides in from the right, back slides
 * in from the left, and tab switches (same depth) just fade.
 */
export const navDirection = ref<"forward" | "back" | "none">("none");

let installed = false;
export function installMobileNavDirection(router: Router): void {
  if (installed) return;
  installed = true;
  router.afterEach((to, from) => {
    if (!isMobileRoute(to.name)) return;
    const delta = depthOf(to.name) - depthOf(from.name);
    navDirection.value = !isMobileRoute(from.name) || delta === 0 ? "none" : delta > 0 ? "forward" : "back";
  });
}

/**
 * "Back" in a mobile header: the real history entry when the previous screen
 * was in this app's mobile stack (so the platform back and the header back
 * agree), otherwise one level up — e.g. when a conversation was opened from a
 * notification and there is nothing behind it.
 */
export function useMobileNav() {
  const router = useRouter();
  const route = useRoute();

  function goBack() {
    const back = (window.history.state as { back?: unknown } | null)?.back;
    if (typeof back === "string" && back.startsWith("/m")) router.back();
    else void router.replace(parentOf(route));
  }

  return { goBack };
}

/**
 * Keyboard foundation. On phones the software keyboard shrinks the VISUAL
 * viewport, not always the layout viewport (iOS never resizes it). Tracking
 * `visualViewport.height` in `--app-height` makes the mobile layout exactly the
 * visible area, so a bottom-anchored composer sits right above the keyboard —
 * no fixed offsets, no negative margins, no permanent gap when it closes.
 * `data-keyboard="open"` lets layouts drop the bottom navigation meanwhile.
 */
const KEYBOARD_THRESHOLD_PX = 120;
let viewportUsers = 0;
/**
 * The keyboard is open when the VISUAL viewport is clearly shorter than the
 * layout viewport (iOS, and Android without resizes-content). Comparing the
 * two at the same moment — never against a remembered "full" height — means
 * resizing a window, rotating, or split-screen never reads as a keyboard.
 * Where the platform resizes the layout itself (Android resizes-content) the
 * layout already fits above the keyboard, so nothing needs to change.
 */
function applyViewport() {
  const vv = window.visualViewport;
  const height = vv?.height ?? window.innerHeight;
  const root = document.documentElement;
  root.style.setProperty("--app-height", `${Math.round(height)}px`);
  root.dataset.keyboard = window.innerHeight - height > KEYBOARD_THRESHOLD_PX ? "open" : "closed";
}
function onOrientation() {
  applyViewport();
}

export function startViewportTracking(): () => void {
  viewportUsers++;
  if (viewportUsers === 1) {
    applyViewport();
    window.visualViewport?.addEventListener("resize", applyViewport);
    window.addEventListener("resize", applyViewport);
    window.addEventListener("orientationchange", onOrientation);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    viewportUsers--;
    if (viewportUsers > 0) return;
    window.visualViewport?.removeEventListener("resize", applyViewport);
    window.removeEventListener("resize", applyViewport);
    window.removeEventListener("orientationchange", onOrientation);
    document.documentElement.style.removeProperty("--app-height");
    delete document.documentElement.dataset.keyboard;
  };
}
