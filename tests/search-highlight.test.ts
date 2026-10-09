import { describe, expect, it } from 'vitest'
import { HL_END, HL_OPTIONS, HL_START, escapeHtml, highlightSnippet } from '@/lib/search-highlight'

describe('escapeHtml', () => {
  it('neutralises every character that could open a tag or attribute', () => {
    expect(escapeHtml('<img src="x" onerror=alert(1)>&')).toBe(
      '&lt;img src=&quot;x&quot; onerror=alert(1)&gt;&amp;',
    )
  })

  it('escapes the ampersand first, so an entity is not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('highlightSnippet', () => {
  it('turns the sentinels into bold runs', () => {
    expect(highlightSnippet(`a ${HL_START}match${HL_END} here`)).toBe('a <b>match</b> here')
  })

  it('escapes markup that came from the note body', () => {
    // ts_headline copies the surrounding document through verbatim, and the
    // palette renders the result with dangerouslySetInnerHTML.
    const snippet = `note about <script>alert(1)</script> and ${HL_START}sarah${HL_END}`
    const out = highlightSnippet(snippet)!
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('<b>sarah</b>')
  })

  it('does not let a note fabricate its own tags', () => {
    const out = highlightSnippet('<b onmouseover="steal()">not a highlight</b>')!
    expect(out).toBe('&lt;b onmouseover=&quot;steal()&quot;&gt;not a highlight&lt;/b&gt;')
  })

  it('returns null for an absent snippet', () => {
    expect(highlightSnippet(null)).toBeNull()
    expect(highlightSnippet(undefined)).toBeNull()
    expect(highlightSnippet('')).toBeNull()
  })
})

describe('HL_OPTIONS', () => {
  it('asks ts_headline for the sentinels the renderer looks for', () => {
    expect(HL_OPTIONS).toContain(`StartSel="${HL_START}"`)
    expect(HL_OPTIONS).toContain(`StopSel="${HL_END}"`)
  })

  it('carries no interpolation of its own, so it can be a bound parameter', () => {
    expect(HL_OPTIONS).not.toContain('$')
  })
})
