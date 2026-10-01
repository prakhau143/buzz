<script setup lang="ts">
/**
 * One row of the community roster.
 *
 * The actions moved from a flat strip of buttons into a "⋮" menu: with
 * make-admin / make-member / timeout / ban / remove all visible at once, the
 * row was both unreadable and one stray click away from a destructive act.
 * Every destructive action now goes through a confirmation that NAMES the
 * person, per the design spec.
 */
import { computed, ref } from "vue";
import AvatarCircle from "@/components/AvatarCircle.vue";
import AppIcon from "@/components/AppIcon.vue";
import TimeoutDurationMenu from "./TimeoutDurationMenu.vue";
import { useProfile } from "@/composables/useProfile";
import { useEscapeKey } from "@/composables/useEscapeKey";
import { shortNpub } from "@/features/identity/format";
import { canBanOrTimeout, canChangeRole, canRemoveMember } from "../permissions";
import type { RelayMember, RelayMemberRole } from "@/protocol/relayMembers";

const props = defineProps<{
  member: RelayMember;
  myRole: RelayMemberRole | null;
  isSelf: boolean;
  canManage: boolean;
  busy: boolean;
  isBanned?: boolean;
  isTimedOut?: boolean;
}>();

const emit = defineEmits<{
  changeRole: [newRole: RelayMemberRole];
  remove: [];
  ban: [];
  unban: [];
  timeout: [seconds: number];
  untimeout: [];
  select: [];
}>();

const { data: profile } = useProfile(() => props.member.pubkey);
const displayName = computed(() => profile.value?.displayName ?? shortNpub(props.member.pubkey));
/** Job title, NOT the community role — a deliberately separate concept. */
const designation = computed(() => profile.value?.designation ?? null);

const showMenu = ref(false);
const showTimeoutMenu = ref(false);
const confirm = ref<"ban" | "remove" | null>(null);
useEscapeKey(() => {
  showMenu.value = false;
  showTimeoutMenu.value = false;
  confirm.value = null;
});

const canMakeAdmin = computed(() =>
  canChangeRole(props.myRole, props.member.role, props.isSelf, "admin"),
);
const canMakeMember = computed(() =>
  canChangeRole(props.myRole, props.member.role, props.isSelf, "member"),
);
const canRemove = computed(() => canRemoveMember(props.myRole, props.member.role, props.isSelf));
const canModerate = computed(
  () => !props.isSelf && canBanOrTimeout(props.myRole, props.member.role),
);
/** Owner protection: the sole owner must never be removable or demotable. */
const isProtectedOwner = computed(() => props.member.role === "owner");
const hasAnyAction = computed(
  () => canMakeAdmin.value || canMakeMember.value || canRemove.value || canModerate.value,
);

function pickTimeout(seconds: number) {
  showTimeoutMenu.value = false;
  emit("timeout", seconds);
}

function confirmDestructive() {
  const which = confirm.value;
  confirm.value = null;
  if (which === "ban") emit("ban");
  else if (which === "remove") emit("remove");
}
</script>

<template>
  <li class="member-row">
    <button type="button" class="identity" @click="emit('select')">
      <AvatarCircle
        :name="displayName"
        :avatar-url="profile?.avatarUrl"
        :is-agent="profile?.isAgent"
        :size="32"
      />
      <span class="identity-text">
        <span class="name-line">
          <span class="name">{{ displayName }}</span>
          <span v-if="isSelf" class="you">you</span>
        </span>
        <span class="sub-line">
          <span v-if="designation" class="designation">{{ designation }}</span>
          <span v-if="designation" class="dot" aria-hidden="true">·</span>
          <span class="pubkey">{{ shortNpub(member.pubkey) }}</span>
        </span>
      </span>
    </button>

    <span class="badges">
      <span v-if="isBanned" class="badge banned">Banned</span>
      <span v-else-if="isTimedOut" class="badge timed-out">Timed out</span>
      <span class="role" :class="member.role">{{ member.role }}</span>
    </span>

    <div v-if="canManage && hasAnyAction" class="actions">
      <button
        type="button"
        class="menu-trigger"
        aria-label="Member actions"
        aria-haspopup="menu"
        :aria-expanded="showMenu"
        :disabled="busy"
        :data-testid="`member-actions-${member.pubkey.slice(0, 8)}`"
        @click="showMenu = !showMenu"
      >
        <AppIcon name="more" :size="16" />
      </button>

      <div v-if="showMenu" class="menu-overlay" @click.self="showMenu = false">
        <div class="menu-card" role="menu">
          <button
            v-if="canMakeAdmin"
            type="button"
            class="menu-item"
            role="menuitem"
            @click="(showMenu = false), emit('changeRole', 'admin')"
          >
            Make admin
          </button>
          <button
            v-if="canMakeMember"
            type="button"
            class="menu-item"
            role="menuitem"
            @click="(showMenu = false), emit('changeRole', 'member')"
          >
            Make member
          </button>
          <template v-if="canModerate">
            <div class="menu-divider" />
            <button
              v-if="!isTimedOut"
              type="button"
              class="menu-item"
              role="menuitem"
              data-testid="member-timeout"
              @click="(showMenu = false), (showTimeoutMenu = true)"
            >
              Timeout…
            </button>
            <button
              v-else
              type="button"
              class="menu-item"
              role="menuitem"
              @click="(showMenu = false), emit('untimeout')"
            >
              Lift timeout
            </button>
            <button
              v-if="!isBanned"
              type="button"
              class="menu-item danger"
              role="menuitem"
              data-testid="member-ban"
              @click="(showMenu = false), (confirm = 'ban')"
            >
              Ban from community
            </button>
            <button
              v-else
              type="button"
              class="menu-item"
              role="menuitem"
              @click="(showMenu = false), emit('unban')"
            >
              Lift ban
            </button>
          </template>
          <template v-if="canRemove">
            <div class="menu-divider" />
            <button
              type="button"
              class="menu-item danger"
              role="menuitem"
              data-testid="member-remove"
              @click="(showMenu = false), (confirm = 'remove')"
            >
              Remove from community
            </button>
          </template>
        </div>
      </div>

      <TimeoutDurationMenu
        v-if="showTimeoutMenu"
        @pick="pickTimeout"
        @close="showTimeoutMenu = false"
      />

      <div v-if="confirm" class="confirm-overlay" @click.self="confirm = null">
        <div class="confirm-card" role="alertdialog" aria-modal="true">
          <h3 class="confirm-title">
            {{ confirm === "ban" ? `Ban ${displayName}?` : `Remove ${displayName}?` }}
          </h3>
          <p class="confirm-body">
            {{
              confirm === "ban"
                ? `${displayName} will be blocked from posting anywhere in this community until the ban is lifted.`
                : `${displayName} will lose access to this community's channels. They can be added again later.`
            }}
          </p>
          <div class="confirm-actions">
            <button type="button" class="btn" @click="confirm = null">Cancel</button>
            <button
              type="button"
              class="btn danger-btn"
              data-testid="member-confirm-destructive"
              @click="confirmDestructive"
            >
              {{ confirm === "ban" ? "Ban" : "Remove" }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <span v-else-if="canManage && isProtectedOwner" class="owner-note" title="The community owner can't be removed or demoted here">
      Owner
    </span>
  </li>
</template>

<style scoped>
.member-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
}
.member-row:hover {
  background: var(--color-surface-muted);
}

.identity {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.identity-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.name-line {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.name {
  font-size: var(--font-size-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.you {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
.sub-line {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
  min-width: 0;
}
.designation {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pubkey {
  font-family: monospace;
}

.badges {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.badge {
  font-size: var(--font-size-xs);
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
}
.badge.banned {
  background: var(--color-danger);
  color: var(--color-on-primary);
}
.badge.timed-out {
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
.role {
  font-size: var(--font-size-xs);
  text-transform: capitalize;
  color: var(--color-text-subtle);
}
.role.owner,
.role.admin {
  color: var(--color-primary);
  font-weight: 600;
}

.menu-trigger {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: var(--radius-md);
  padding: var(--space-1);
}
.menu-trigger:hover,
.menu-trigger:focus-visible {
  background: var(--color-surface-hover);
}

.menu-overlay,
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-dropdown);
}
.confirm-overlay {
  z-index: var(--z-modal);
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.menu-card {
  position: absolute;
  right: var(--space-5);
  width: 220px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
}
.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--color-text);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.menu-item:hover,
.menu-item:focus-visible {
  background: var(--color-surface-hover);
}
.menu-item.danger {
  color: var(--color-danger);
}
.menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: var(--space-1) 0;
}

.confirm-card {
  width: 380px;
  max-width: calc(100vw - var(--space-4) * 2);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.confirm-title {
  margin: 0;
  font-size: var(--font-size-md);
  color: var(--color-text);
}
.confirm-body {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.btn {
  height: 28px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
}
.danger-btn {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--color-on-primary);
}

.owner-note {
  font-size: var(--font-size-xs);
  color: var(--color-text-subtle);
}
</style>
