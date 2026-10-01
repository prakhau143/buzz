import { defineStore } from "pinia";
import type { Membership } from "@/features/access/communityDiscovery";

/**
 * Where a signed-in local identity goes next — the result of the central
 * post-authentication routing decision (`resolveAccess` in useAuth.ts).
 *
 *   operator    → the Operator dashboard (the relay said this identity is an operator)
 *   communities → the picker (member of more than one community)
 *   welcome     → onboarding: join with an invite (member of none)
 *   null        → nothing to route to (a community was opened, or it hasn't run yet)
 *
 * None of this is authority. Each field is a cache of what the relay answered to a
 * signed request in this session; the relay re-checks on every action.
 */
export type AccessDestination = "operator" | "communities" | "welcome";

export const useAccessStore = defineStore("access", {
  state: () => ({
    /** The relay answered the signed operator probe with 200. Never persisted. */
    isOperator: false,
    /** Communities whose relay said "member" to this identity, this session. */
    memberships: [] as Membership[],
    /** Community addresses that could not be asked (offline / timeout). */
    unreachable: [] as string[],
    destination: null as AccessDestination | null,
  }),
  actions: {
    setResult(input: {
      isOperator: boolean;
      memberships: Membership[];
      unreachable: string[];
      destination: AccessDestination | null;
    }) {
      this.isOperator = input.isOperator;
      this.memberships = input.memberships;
      this.unreachable = input.unreachable;
      this.destination = input.destination;
    },
    clear() {
      this.isOperator = false;
      this.memberships = [];
      this.unreachable = [];
      this.destination = null;
    },
  },
});
