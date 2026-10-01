import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useUiStore } from "@/stores/ui";
import { activeRelayUrl } from "@/features/communities/relayCommunities";
import { useCommunitySwitch } from "@/features/communities/useCommunitySwitch";
import { useIsMobile } from "@/features/mobile/breakpoints";
import { desktopRoute, mobileRoute, type MessageTarget } from "./messageTarget";

/**
 * Where a deep navigation is: resolving (switching to) the target's community,
 * or navigating to it. Module-level so the mobile frame can show "Resolving
 * community…" wherever the user is, and so the breakpoint mapper in App.vue
 * never rewrites the route in the middle of it.
 */
const phase = ref<"idle" | "community" | "navigating">("idle");
export const deepNavPhase = computed(() => phase.value);
export const isDeepNavigating = () => phase.value !== "idle";

/**
 * THE deep-link opener (Inbox rows, notification clicks, …):
 *   1. community — if the target lives in another community, switch through the
 *      shared, membership-VERIFIED switch (verify → switch → restore on failure;
 *      its error is the shared one). A failed switch leaves you exactly where
 *      you were: nothing is navigated.
 *   2. navigate — to the route for the current tier: the desktop
 *      `?messageId=&threadRootId=` reveal, or the mobile conversation / thread
 *      page with `?m=`. The screen then loads history and reveals the message.
 */
export function useOpenMessageTarget() {
  const router = useRouter();
  const ui = useUiStore();
  const isMobile = useIsMobile();
  const { switchTo } = useCommunitySwitch();

  async function openMessageTarget(target: MessageTarget): Promise<boolean> {
    if (phase.value !== "idle") return false; // one deep navigation at a time
    try {
      if (target.community && target.community !== activeRelayUrl.value) {
        phase.value = "community";
        const switched = await switchTo(target.community);
        if (!switched || activeRelayUrl.value !== target.community) return false;
        // The switch lands on a channel of its own choosing; the target wins.
        ui.clearChannelRestore();
      }
      phase.value = "navigating";
      await router.push(isMobile.value ? mobileRoute(target) : desktopRoute(target));
      return true;
    } finally {
      phase.value = "idle";
    }
  }

  return { openMessageTarget };
}
