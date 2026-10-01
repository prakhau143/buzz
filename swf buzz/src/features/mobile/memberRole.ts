import type { InjectionKey } from "vue";
import type { Member } from "@/types/domain";

/**
 * A conversation screen that knows its members provides their roles, so the
 * mobile profile sheet can say "Admin" / "Member" for this conversation —
 * from the existing member query, never a separate role model.
 */
export const MEMBER_ROLE_KEY: InjectionKey<(pubkey: string) => Member["role"] | null> = Symbol("mobileMemberRole");
