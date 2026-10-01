/**
 * Where a reader was in a message feed: a message and its distance from the
 * top of the viewport (plus the raw scrollTop, for diagnostics). Anchoring to a
 * message rather than a pixel offset survives messages above it changing
 * height (images decoding, edits) between leaving and coming back.
 */
export interface ScrollAnchor {
  id: string;
  offset: number;
  scrollTop: number;
}
