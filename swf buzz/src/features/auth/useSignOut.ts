import { ref } from "vue";
import { useAuth } from "./useAuth";
import { useSessionStore } from "@/stores/session";

/**
 * "Sign out" for every button that offers it. For the local identity the SWF
 * sign-out removes the key from the device, so it goes through the warning
 * dialog first (`SignOutDialog.vue`); the legacy Okta/dev modes keep their
 * direct logout. One composable so every entry point behaves the same.
 */
export function useSignOut() {
  const { logout, isLoading } = useAuth();
  const session = useSessionStore();
  const showConfirm = ref(false);

  async function requestSignOut() {
    if (session.authMode === "local") {
      showConfirm.value = true;
      return;
    }
    await logout();
  }

  async function confirmSignOut() {
    try {
      await logout();
    } finally {
      showConfirm.value = false;
    }
  }

  function cancelSignOut() {
    showConfirm.value = false;
  }

  return { showConfirm, requestSignOut, confirmSignOut, cancelSignOut, isSigningOut: isLoading };
}
