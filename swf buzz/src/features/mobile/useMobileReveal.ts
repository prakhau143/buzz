import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

/**
 * A mobile conversation / thread screen's pending deep reveal: `?m=<messageId>`
 * (set by the deep-link opener). The screen hands it to MessageList /
 * ThreadPanel as `highlightId`; when they report `highlight-done`, the `m` is
 * dropped with `replace` — no extra history entry, and going back or
 * reloading never re-reveals — and a miss shows "Message unavailable".
 */
export function useMobileReveal() {
  const route = useRoute();
  const router = useRouter();
  const target = computed(() => {
    const m = route.query?.m;
    return typeof m === "string" && m ? m : null;
  });
  const status = ref<"idle" | "finding" | "unavailable">(target.value ? "finding" : "idle");

  watch(target, (id, previous) => {
    if (id && id !== previous) status.value = "finding";
  });

  function done(found: boolean) {
    status.value = found ? "idle" : "unavailable";
    if (!target.value) return;
    const query = { ...route.query };
    delete query.m;
    void router.replace({ query });
  }

  function dismiss() {
    status.value = "idle";
  }

  return { target, status, done, dismiss };
}
