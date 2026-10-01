/**
 * Buzz command kinds (41010 DM-open, 30620, 46020, …) do not answer with an
 * event — they answer inside the relay's OK "reason" string, as a
 * `response:`-prefixed JSON document:
 *
 *   ["OK", "<id>", true, "response:{\"channel_id\":\"…\",\"created\":true}"]
 *
 * The prefix is part of the wire format, not decoration: every other Buzz
 * client strips it before parsing (relay `command_executor.rs` writes it at
 * `format!("response:{}", …)`; the CLI, the OLD BUZZ desktop Tauri layer and
 * the Dart mobile client each strip it back off). Parsing the reason as bare
 * JSON therefore always fails, and the caller sees an empty object.
 *
 * The raw-JSON fallback mirrors OLD BUZZ `desktop/src-tauri/src/relay.rs`
 * `parse_command_response`, which tolerates relays that omit the prefix.
 */

/**
 * Parse a command-event OK reason. Returns `null` when the reason carries no
 * JSON payload at all — which is a normal, non-error outcome: the relay
 * answers idempotent replays with a plain `"duplicate: already processed"`.
 * Callers decide what a missing payload means for them.
 */
export function parseCommandResponse<T>(okReason: string): T | null {
  const withoutPrefix = okReason.startsWith("response:")
    ? okReason.slice("response:".length)
    : okReason;
  try {
    const parsed: unknown = JSON.parse(withoutPrefix);
    // `JSON.parse` happily returns strings, numbers and null; only an object
    // can carry the named fields a command response is read for.
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as T;
  } catch {
    return null;
  }
}
