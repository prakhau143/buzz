import { onBeforeUnmount, onMounted } from "vue";
import { isMacPlatform, SHORTCUTS, type ShortcutDef } from "./shortcutRegistry";

/**
 * Global shortcut dispatch. One window listener (installed once, by App.vue),
 * matching keydowns against the registry; components contribute the action
 * with `useShortcut(id, handler)` for as long as they are mounted.
 *
 * The most recently mounted handler for an id wins, so a view can take over a
 * shortcut from the shell while it is open and give it back on unmount.
 */
type Handler = (event: KeyboardEvent) => void;

const handlers = new Map<string, Handler[]>();

export function registerShortcutHandler(id: string, handler: Handler): () => void {
  const list = handlers.get(id) ?? [];
  list.push(handler);
  handlers.set(id, list);
  return () => {
    const current = handlers.get(id);
    if (!current) return;
    const index = current.lastIndexOf(handler);
    if (index >= 0) current.splice(index, 1);
    if (current.length === 0) handlers.delete(id);
  };
}

/** Bind a registered global shortcut to this component's lifetime. */
export function useShortcut(id: string, handler: Handler): void {
  let unregister: (() => void) | null = null;
  onMounted(() => (unregister = registerShortcutHandler(id, handler)));
  onBeforeUnmount(() => unregister?.());
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Exposed for tests: route one keydown through the registry. Returns the id handled, if any. */
export function dispatchShortcut(
  event: KeyboardEvent,
  mac = isMacPlatform(),
  registry: readonly ShortcutDef[] = SHORTCUTS,
): string | null {
  if (event.defaultPrevented || event.isComposing) return null;
  for (const def of registry) {
    if (def.scope !== "global" || !def.matches?.(event, mac)) continue;
    if (!def.allowInEditable && isEditableTarget(event.target)) continue;
    const list = handlers.get(def.id);
    const handler = list?.[list.length - 1];
    if (!handler) continue;
    event.preventDefault();
    handler(event);
    return def.id;
  }
  return null;
}

let installed = false;

export function useShortcutDispatcher(): void {
  const listener = (event: KeyboardEvent) => void dispatchShortcut(event);
  onMounted(() => {
    if (installed) return;
    installed = true;
    window.addEventListener("keydown", listener);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", listener);
    installed = false;
  });
}

/** Test helper. */
export function resetShortcutHandlersForTests(): void {
  handlers.clear();
}
