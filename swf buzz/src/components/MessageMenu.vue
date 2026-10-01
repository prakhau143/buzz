<script setup lang="ts">
/**
 * Per-message "⋮" action menu (desktop). Touch layouts use the
 * MobileMessageActions sheet instead — both offer the same logical abilities.
 *
 * Edit and delete became real in Phase 4B — kind:40003 edits and kind:5 /
 * kind:9005 deletions are now published, subscribed to and rendered end to end,
 * so the menu offers them. `canEdit` / `deleteMode` come from
 * `channelPermissions.ts`, which mirrors the relay's own rules; pin/unpin come
 * from `features/pins/pinModel.ts`. Unauthorized actions are HIDDEN rather
 * than shown disabled, per the design spec.
 *
 * Phase H: rendered through `PositionedContextMenu` — teleported, collision-
 * aware, keyboard-navigable — instead of an absolutely positioned card that
 * always opened downward and was cut off by the composer near the bottom.
 *
 * Still deliberately absent: "Remind me later" — no reminder store or scheduler
 * exists anywhere in this codebase, and a menu item that silently does nothing
 * is worse than none. See `docs/PHASE_3_IMPLEMENTATION_AUDIT.md`.
 */
import { computed } from "vue";
import { nip19 } from "nostr-tools";
import { config } from "@/app/config";
import AppIcon from "./AppIcon.vue";
import PositionedContextMenu from "./PositionedContextMenu.vue";

const props = defineProps<{
  /** The "⋮" button that opened the menu — the placement anchor and focus return target. */
  anchor: HTMLElement | null;
  messageContent: string;
  messageEventId: string;
  authorPubkey: string;
  isOwnMessage: boolean;
  canEdit?: boolean;
  /** "self" → kind:5, "admin" → kind:9005, null/undefined → no delete offered. */
  deleteMode?: "self" | "admin" | null;
  /** Offer "Reply in thread" (the surface supports threads). */
  canReply?: boolean;
  /** This viewer may pin this message (pinModel rules). */
  canPin?: boolean;
  /** This message is the conversation's active pin and this viewer may unpin it. */
  canUnpin?: boolean;
}>();
const emit = defineEmits<{
  reply: [];
  pin: [];
  unpin: [];
  "mark-unread": [];
  report: [];
  edit: [];
  delete: [];
  close: [];
}>();

function choose(action: () => void) {
  action();
  emit("close");
}

async function copyMessage() {
  try {
    await navigator.clipboard.writeText(props.messageContent);
  } finally {
    emit("close");
  }
}

/**
 * There is no app-level "open this exact message" deep link (that would need
 * a new `swfbuzz://` link type registered on the Rust side, out of scope
 * this pass) — instead this copies a standard NIP-19 `nevent` identifier
 * (real Nostr, not an invented protocol), which any Nostr-aware tool can
 * resolve back to this exact event.
 */
async function copyLink() {
  try {
    const nevent = nip19.neventEncode({
      id: props.messageEventId,
      author: props.authorPubkey,
      relays: [config.relayUrl],
    });
    await navigator.clipboard.writeText(`nostr:${nevent}`);
  } finally {
    emit("close");
  }
}

// Report is meaningless on my own message.
const showReport = computed(() => !props.isOwnMessage);
const showEdit = computed(() => props.canEdit === true);
const showDelete = computed(() => !!props.deleteMode);
/** Deleting somebody else's message is a moderation act — name it as one. */
const deleteLabel = computed(() =>
  props.deleteMode === "admin" && !props.isOwnMessage ? "Delete (moderator)" : "Delete message",
);
</script>

<template>
  <PositionedContextMenu :anchor="anchor" label="Message actions" @close="emit('close')">
    <button v-if="canReply" type="button" class="menu-item" role="menuitem" data-testid="message-menu-reply" @click="choose(() => emit('reply'))">
      <AppIcon name="reply" :size="16" class="item-icon" />Reply in thread
    </button>
    <button v-if="canUnpin" type="button" class="menu-item" role="menuitem" data-testid="message-unpin" @click="choose(() => emit('unpin'))">
      <AppIcon name="pin-off" :size="16" class="item-icon" />Unpin message
    </button>
    <button v-else-if="canPin" type="button" class="menu-item" role="menuitem" data-testid="message-pin" @click="choose(() => emit('pin'))">
      <AppIcon name="pin" :size="16" class="item-icon" />Pin message
    </button>
    <button type="button" class="menu-item" role="menuitem" data-testid="message-copy" @click="copyMessage">
      <AppIcon name="copy" :size="16" class="item-icon" />Copy message
    </button>
    <button type="button" class="menu-item" role="menuitem" data-testid="message-copy-link" @click="copyLink">
      <AppIcon name="link" :size="16" class="item-icon" />Copy link
    </button>
    <button type="button" class="menu-item" role="menuitem" data-testid="message-mark-unread" @click="choose(() => emit('mark-unread'))">
      <AppIcon name="mail" :size="16" class="item-icon" />Mark unread
    </button>
    <template v-if="showEdit">
      <div class="menu-divider" role="separator" />
      <button
        type="button"
        class="menu-item"
        role="menuitem"
        data-testid="message-edit"
        @click="choose(() => emit('edit'))"
      >
        <AppIcon name="edit" :size="16" class="item-icon" />Edit message
      </button>
    </template>
    <template v-if="showDelete || showReport">
      <div class="menu-divider" role="separator" />
      <button
        v-if="showDelete"
        type="button"
        class="menu-item danger"
        role="menuitem"
        data-testid="message-delete"
        @click="choose(() => emit('delete'))"
      >
        <AppIcon name="trash" :size="16" class="item-icon" />{{ deleteLabel }}
      </button>
      <button v-if="showReport" type="button" class="menu-item danger" role="menuitem" data-testid="message-report" @click="choose(() => emit('report'))">
        <AppIcon name="warning" :size="16" class="item-icon" />Report message
      </button>
    </template>
  </PositionedContextMenu>
</template>

<style scoped>
.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.menu-item:hover,
.menu-item:focus-visible {
  background: var(--color-surface-hover);
  outline: none;
}
.menu-item:focus-visible {
  box-shadow: inset 0 0 0 2px var(--focus-ring-color);
}
.menu-item:active {
  background: var(--color-surface-muted);
}
.item-icon {
  color: var(--color-text-muted);
}
.menu-item.danger,
.menu-item.danger .item-icon {
  color: var(--color-danger);
}
.menu-item.danger:hover,
.menu-item.danger:focus-visible {
  background: var(--color-danger-muted);
}

.menu-divider {
  height: 1px;
  flex: none;
  background: var(--color-border);
  margin: 4px 2px;
}
</style>
