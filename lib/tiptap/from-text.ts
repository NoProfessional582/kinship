import { normalizeLabel } from '../utils'
import { EMPTY_DOC, type ProseNode } from './doc'
import { CONTACT_MENTION, ENTITY_REF, makePendingId, type EntityKind } from './nodes'

/**
 * Plain text with mentions, the form agents and scripts write notes in, turned
 * into the TipTap document the editor stores. `docToBody` (to-text.ts) is the
 * way back; the two share the rules below, so text written by one is read back
 * unchanged by the other.
 *
 * Mentions:
 *   person   @[Jane Doe](contact:<id>)
 *   task     [[Ship v2]](task:<id>)
 *   project  [[Launch]](project:<id>)
 * An id of `new` asks the save to create the record, as choosing "create" in
 * the editor's tag menu does: it becomes a `new:<uuid>` placeholder, and every
 * `new` mention of the same kind and label shares one, so one row is created.
 * Anything that is not a whole, well-formed mention stays text as written.
 *
 * Blocks: blank lines separate paragraphs; a single newline is a line break
 * (`hardBreak`) inside the paragraph. Lines starting `- ` or `* ` are bullet
 * list items, and a run of them is one list.
 *
 * Escaping: a backslash before one of  \ [ ] - *  stands for that character
 * alone, and any other backslash is literal. So `\[` keeps a bracket from
 * opening a mention, `\]` puts a bracket inside a label, `\- ` at the start of
 * a line keeps it from becoming a list item, and `\\` is one backslash. Only
 * the text that needs it is escaped on the way out.
 */

/** The characters a backslash escapes. */
export const ESCAPABLE = new Set(['\\', '[', ']', '-', '*'])

/** Record ids as the database makes them (cuid), or `new` for a record to create. */
const ID = '[A-Za-z0-9_-]+'
const LABEL = String.raw`((?:\\[\s\S]|[^\\\]])+)`
const CONTACT_RE = new RegExp(String.raw`^@\[${LABEL}\]\(contact:(${ID})\)`)
const ENTITY_RE = new RegExp(String.raw`^\[\[${LABEL}\]\]\((task|project):(${ID})\)`)
const BULLET_RE = /^[-*] /

/** The id written for a record the save should create. */
export const NEW_ID = 'new'

function unescape(s: string): string {
  return s.replace(/\\([\s\S])/g, (all, c: string) => (ESCAPABLE.has(c) ? c : all))
}

/** Hands out one placeholder per kind and label, for `new` mentions. */
function pendingIds(): (type: string, label: string) => string {
  const ids = new Map<string, string>()
  return (type, label) => {
    const key = `${type}\u0000${normalizeLabel(label)}`
    let id = ids.get(key)
    if (!id) {
      id = makePendingId()
      ids.set(key, id)
    }
    return id
  }
}

function parseInline(line: string, pending: ReturnType<typeof pendingIds>): ProseNode[] {
  const out: ProseNode[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ type: 'text', text })
    text = ''
  }

  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === '\\' && i + 1 < line.length && ESCAPABLE.has(line[i + 1])) {
      text += line[i + 1]
      i += 2
      continue
    }
    if (c === '@' && line[i + 1] === '[') {
      const m = CONTACT_RE.exec(line.slice(i))
      const label = m ? unescape(m[1]) : ''
      if (m && label.trim()) {
        flush()
        const id = m[2] === NEW_ID ? pending('contact', label) : m[2]
        out.push({ type: CONTACT_MENTION, attrs: { id, label } })
        i += m[0].length
        continue
      }
    }
    if (c === '[' && line[i + 1] === '[') {
      const m = ENTITY_RE.exec(line.slice(i))
      const label = m ? unescape(m[1]) : ''
      if (m && label.trim()) {
        flush()
        const kind = m[2] as EntityKind
        const id = m[3] === NEW_ID ? pending(kind, label) : m[3]
        out.push({ type: ENTITY_REF, attrs: { id, kind, label } })
        i += m[0].length
        continue
      }
    }
    text += c
    i += 1
  }
  flush()
  return out
}

function paragraph(content: ProseNode[]): ProseNode {
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/**
 * The TipTap document for a note written as plain text. Empty or blank text
 * gives the same empty document a new note gets.
 */
export function textToDoc(text: string): ProseNode {
  const pending = pendingIds()
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ProseNode[] = []

  // Lines of the paragraph or list being built, flushed at a blank line or
  // where a list meets a paragraph.
  let para: string[] = []
  let items: string[] = []

  const flushPara = () => {
    if (!para.length) return
    const content: ProseNode[] = []
    para.forEach((line, n) => {
      if (n > 0) content.push({ type: 'hardBreak' })
      content.push(...parseInline(line, pending))
    })
    blocks.push(paragraph(content))
    para = []
  }
  const flushItems = () => {
    if (!items.length) return
    blocks.push({
      type: 'bulletList',
      content: items.map((item) => ({
        type: 'listItem',
        content: [paragraph(parseInline(item, pending))],
      })),
    })
    items = []
  }

  for (const line of lines) {
    if (!line.trim()) {
      flushPara()
      flushItems()
    } else if (BULLET_RE.test(line)) {
      flushPara()
      items.push(line.slice(2))
    } else {
      flushItems()
      para.push(line)
    }
  }
  flushPara()
  flushItems()

  return blocks.length ? { type: 'doc', content: blocks } : structuredClone(EMPTY_DOC)
}
