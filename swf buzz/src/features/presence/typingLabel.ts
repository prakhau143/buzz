/**
 * Wording for the typing indicator. Pure — every case is unit-tested.
 *
 *   1  "Prakhar is typing"
 *   2  "Prakhar and Rahul are typing"
 *   3  "Prakhar, Rahul and Amit are typing"
 *   5  "Prakhar, Rahul, Amit, Neha and Vikram are typing"
 *   6+ "Prakhar, Rahul, Amit, Neha, Vikram +1 other are typing"
 *
 * Names arrive in the order people STARTED typing (the typing store appends on
 * first signal and only removes on expiry), so the text never reshuffles.
 */
export const MAX_TYPING_NAMES = 5;
/** How many names the narrow (compact) form keeps before "+N others". */
const COMPACT_NAMES = 2;

const others = (n: number) => `+${n} ${n === 1 ? "other" : "others"}`;

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function build(names: readonly string[], keep: number): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length <= keep) return `${joinNames(names)} are typing`;
  return `${names.slice(0, keep).join(", ")} ${others(names.length - keep)} are typing`;
}

/** Full sentence: up to 5 names, then "+N others". */
export function typingLabel(names: readonly string[]): string {
  return build(names, MAX_TYPING_NAMES);
}

/** Narrow widths: up to 2 names, then "+N others" ("Prakhar, Rahul +3 others are typing"). */
export function compactTypingLabel(names: readonly string[]): string {
  return build(names, COMPACT_NAMES);
}

/**
 * What a screen reader hears — only the meaningful state, never the animation:
 * names for one or two people, a count beyond that.
 */
export function typingAnnouncement(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length <= 2) return build(names, 2);
  return `${names.length} people are typing`;
}
