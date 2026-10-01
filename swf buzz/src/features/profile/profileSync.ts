import { relayConnectionService, type RelaySubscriptionHandle } from "@/services/RelayConnectionService";
import { fetchEventsOnce } from "@/services/relayQuery";
import { logError } from "@/services/errors";
import { buildProfileFilter } from "@/protocol/profile";
import { KIND_PROFILE_METADATA } from "@/protocol/kinds";
import { useSessionStore } from "@/stores/session";
import type { RawNostrEvent } from "@/protocol/types";
import { absorbProfileEvents, isNewerProfileEvent, profileEventFor } from "./profileStore";
import { readCachedProfileEvent, replicateProfileHere } from "./identityProfile";

/**
 * Per community session (started by SessionServices on every generation):
 *
 *  1. seed the registry with my last signed profile from this device;
 *  2. ask the open community for my kind:0 and absorb it (newest wins);
 *  3. if the community holds an OLDER copy (or none) of my profile than the
 *     newest I have, republish that newest signed event here, verbatim —
 *     this is what makes an edit made elsewhere reach this community;
 *  4. keep one live kind:0 subscription so any profile change (mine from
 *     another device, anyone else's) updates every surface immediately.
 */
let liveSub: RelaySubscriptionHandle | null = null;
let syncRun = 0;

export function startProfileSync(): void {
  liveSub?.close();
  liveSub = null;
  const me = useSessionStore().pubkey;
  if (!me) return;
  const run = ++syncRun;

  const cached = readCachedProfileEvent(me);
  if (cached) absorbProfileEvents([cached]);

  liveSub = relayConnectionService.subscribe(
    "profile-live",
    [{ kinds: [KIND_PROFILE_METADATA], since: Math.floor(Date.now() / 1000) }],
    { onEvent: (event) => void absorbProfileEvents([event]) },
  );

  void reconcileMine(me, run);
}

async function reconcileMine(me: string, run: number): Promise<void> {
  let here: RawNostrEvent | undefined;
  try {
    const events = await fetchEventsOnce([{ ...buildProfileFilter([me]), limit: 1 }]);
    here = events.reduce<RawNostrEvent | undefined>((a, b) => (!a || isNewerProfileEvent(b, a) ? b : a), undefined);
  } catch (err) {
    logError("profileSync.fetchMine", err);
    return;
  }
  if (run !== syncRun) return; // a newer session started meanwhile
  if (here) absorbProfileEvents([here]);
  const newest = profileEventFor(me);
  if (newest && (!here || isNewerProfileEvent(newest, here))) {
    await replicateProfileHere(newest);
  }
}

export function stopProfileSync(): void {
  syncRun++;
  liveSub?.close();
  liveSub = null;
}
