/**
 * Resolves "which community" the signed-in Application User is operating
 * against.
 *
 * DESIGN GAP, deliberately scoped small rather than solved fully this
 * phase: `swf-buzz-backend` is multi-community (every community endpoint
 * takes an explicit `:id`), but the rest of this app still assumes the old
 * single-relay-community model (no ID anywhere — see
 * `../community-members/RelayMembersService.ts`, which needs none). There
 * is no "list my communities" / "switch community" UI yet. This resolver
 * gives the app *a* community to operate against — persisted client-side,
 * not a real multi-tenant community switcher — so the membership/invite
 * flows built this phase are actually usable end-to-end. A real community
 * picker is follow-up work, not part of this phase's scope.
 *
 * Resolution order: a previously created/joined community id cached in
 * `localStorage` (per-device convenience only, never security-relevant —
 * see the artifact/browser-storage guidance this project follows) wins;
 * otherwise an optional `VITE_SWF_COMMUNITY_ID` build-time default; otherwise
 * `null`, meaning the UI should offer to create one (see
 * `ui/CreateCommunityPrompt.vue`).
 */
import { ref } from "vue";

const STORAGE_KEY = "swf_current_community_id";

function readCached(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeCached(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Best-effort convenience cache only — a write failure (private
    // browsing, quota) just means this resolves again next launch.
  }
}

const envDefault = (import.meta.env.VITE_SWF_COMMUNITY_ID as string | undefined) || null;

/** Module-level so every composable/component consumer shares one reactive value. */
export const currentCommunityId = ref<string | null>(readCached() ?? envDefault);

/** Called once a community is created or an invite is claimed into one. */
export function setCurrentCommunityId(id: string): void {
  currentCommunityId.value = id;
  writeCached(id);
}
