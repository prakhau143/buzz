/**
 * Wave — byte-compatible with OLD BUZZ (`desktop/src/features/messages/lib/waveMessage.ts`):
 * an ordinary kind:9 message in the 1:1 DM whose content starts with a marker
 * comment. No dedicated kind and no separate notification; both clients render
 * the marker as a "👋 … waved at you." card instead of the raw text.
 */
export const WAVE_MESSAGE_MARKER = "<!-- buzz:wave:v1 -->";

export function buildWaveMessageContent(senderName: string): string {
  const name = senderName.trim() || "Someone";
  return `${WAVE_MESSAGE_MARKER}\n${name} waved at you.`;
}

/** The card text for a wave message, or `null` when the content is not a wave. */
export function parseWaveMessageContent(content: string): { text: string } | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith(WAVE_MESSAGE_MARKER)) return null;
  const text = trimmed.slice(WAVE_MESSAGE_MARKER.length).trim();
  return { text: text || "Someone waved at you." };
}
