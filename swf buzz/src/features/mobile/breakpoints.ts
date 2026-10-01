import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/**
 * Layout tiers (Phase B):
 *   >= 1100  desktop — rail | sidebar | conversation | thread
 *   768–1099 compact desktop / tablet — same model, tighter (AppShell's own media queries)
 *   < 768    MOBILE — a different navigation model (single stack + bottom nav), not a shrunk desktop
 *   < 430    small-phone refinements inside the mobile layout (CSS only)
 */
export const MOBILE_MAX_WIDTH = 767.98;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/** Module-level so every caller shares one MediaQueryList listener and one answer. */
const isMobile = ref(false);
let mql: MediaQueryList | null = null;
let users = 0;
function onChange(e: MediaQueryList | MediaQueryListEvent) {
  isMobile.value = e.matches;
}

/** True below the mobile breakpoint. jsdom (no matchMedia) is treated as desktop. */
export function useIsMobile(): Ref<boolean> {
  onMounted(() => {
    users++;
    if (mql || typeof window.matchMedia !== "function") return;
    mql = window.matchMedia(MOBILE_QUERY);
    onChange(mql);
    mql.addEventListener("change", onChange);
  });
  onBeforeUnmount(() => {
    users--;
    if (users === 0 && mql) {
      mql.removeEventListener("change", onChange);
      mql = null;
    }
  });
  return isMobile;
}

/** For tests: force the tier without a real media query. */
export function setMobileForTests(value: boolean): void {
  isMobile.value = value;
}
