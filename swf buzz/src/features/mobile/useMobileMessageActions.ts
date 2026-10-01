import { computed, ref } from "vue";
import { useSessionStore } from "@/stores/session";
import { profileFor } from "@/features/profile/profileStore";
import { shortKey } from "@/features/identity/format";
import { reactionToggle } from "@/features/reactions/reactionToggle";
import type { MessageActionAbilities } from "./ui/MobileMessageActions.vue";
import type { Message, Reaction } from "@/types/domain";

/**
 * State for the mobile message action sheet, edit mode and report dialog on a
 * conversation screen. Each screen passes its OWN abilities and operations —
 * the same authorization rules and mutation paths its desktop counterpart
 * uses — so this owns only which message is targeted and which mode is open.
 */
export function useMobileMessageActions(opts: {
  abilities: (message: Message) => MessageActionAbilities;
  reactionsFor: (messageId: string) => Reaction[] | undefined;
  react: (targetEventId: string, emoji: string) => void;
  unreact: (targetEventId: string, emoji: string, reactionEventId: string) => void;
  openThread: (rootId: string) => void;
  edit?: (message: Message, content: string) => Promise<boolean>;
  remove?: (message: Message) => Promise<unknown>;
  pin?: (message: Message) => void;
  unpin?: (message: Message) => void;
}) {
  const session = useSessionStore();
  const target = ref<Message | null>(null);
  const editing = ref<Message | null>(null);
  const reporting = ref<Message | null>(null);
  const savingEdit = ref(false);

  const abilities = computed<MessageActionAbilities>(() => (target.value ? opts.abilities(target.value) : {}));
  const isOwn = computed(() => !!target.value && target.value.authorPubkey === session.pubkey);
  const authorName = computed(() => {
    const pk = target.value?.authorPubkey;
    return pk ? (profileFor(pk)?.displayName ?? shortKey(pk)) : "";
  });

  function open(message: Message) {
    target.value = message;
  }
  function close() {
    target.value = null;
  }
  function onReact(emoji: string) {
    const m = target.value;
    if (!m) return;
    const action = reactionToggle(opts.reactionsFor(m.id), emoji, session.pubkey);
    if (action.kind === "unreact") opts.unreact(m.id, emoji, action.reactionEventId);
    else opts.react(m.id, emoji);
  }
  function onReply() {
    const m = target.value;
    if (m) opts.openThread(m.thread.rootId ?? m.id);
  }
  function onEdit() {
    editing.value = target.value;
  }
  async function onDelete() {
    const m = target.value;
    if (m && opts.remove) await opts.remove(m);
  }
  function onReport() {
    reporting.value = target.value;
  }
  function onPin() {
    const m = target.value;
    if (m) opts.pin?.(m);
  }
  function onUnpin() {
    const m = target.value;
    if (m) opts.unpin?.(m);
  }
  async function saveEdit(content: string) {
    const m = editing.value;
    if (!m || !opts.edit) return;
    savingEdit.value = true;
    try {
      if (await opts.edit(m, content)) editing.value = null;
    } finally {
      savingEdit.value = false;
    }
  }
  function cancelEdit() {
    editing.value = null;
  }

  return {
    target,
    editing,
    reporting,
    savingEdit,
    abilities,
    isOwn,
    authorName,
    open,
    close,
    onReact,
    onReply,
    onEdit,
    onDelete,
    onReport,
    onPin,
    onUnpin,
    saveEdit,
    cancelEdit,
  };
}
