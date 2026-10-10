/**
 * Snippet highlighting for the command palette, kept free of any database
 * import so it can be unit-tested without a connection.
 *
 * `ts_headline` wraps matches in markup and the palette renders the result as
 * HTML so the highlight survives. Postgres does not escape the note text around
 * the match, so its default `<b>` would hand whatever someone typed into a note
 * straight to the browser as markup. Distinctive sentinels are asked for
 * instead: the whole string is escaped, then only the sentinels become tags.
 *
 * A note containing a sentinel literally is the one collision, and it costs a
 * stray bold run rather than injected markup.
 */

export const HL_START = '[[kb-hl]]'
export const HL_END = '[[/kb-hl]]'

/**
 * Passed to `ts_headline` as a bound parameter rather than interpolated: inside
 * a `$queryRaw` tagged template every `${}` becomes a placeholder, so building
 * the option string in the SQL would put `$2` inside a quoted literal and leave
 * the bind count wrong. ts_headline takes its options as a plain text argument,
 * which makes one parameter the right shape anyway.
 */
export const HL_OPTIONS =
  `StartSel="${HL_START}", StopSel="${HL_END}", ` +
  'MaxWords=18, MinWords=6, ShortWord=2, MaxFragments=1'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Escaped snippet HTML, with the sentinels turned back into `<b>` runs. */
export function highlightSnippet(raw: string | null | undefined): string | null {
  if (!raw) return null
  return escapeHtml(raw)
    .split(escapeHtml(HL_START))
    .join('<b>')
    .split(escapeHtml(HL_END))
    .join('</b>')
}
