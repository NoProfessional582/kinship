import type { ProseNode } from './doc'
import { ESCAPABLE, NEW_ID } from './from-text'
import { CONTACT_MENTION, ENTITY_REF, isPendingId } from './nodes'

/**
 * A stored note as plain text with mentions, the form agents read notes in and
 * may write back. The syntax and escaping rules are in from-text.ts; text made
 * here reads back through `textToDoc` as the same note.
 *
 * Unlike `docToText`, which flattens a note for the search index, this keeps
 * every mention with its id. Only what the text form can say survives:
 * paragraphs, line breaks, bullet lists and mentions. Formatting is dropped,
 * and other blocks the editor makes (headings, quotes, code, numbered and
 * check lists) come out as paragraphs of their text. Nested bullets are
 * flattened into the list they sit in. A mention whose id cannot be written
 * comes out as its label.
 */

const ID_RE = /^[A-Za-z0-9_-]+$/
const INLINE = new Set(['text', 'hardBreak', CONTACT_MENTION, ENTITY_REF])

type Block = { para: string } | { items: string[] }

/** Builds one paragraph or list item, escaping text where it would misread. */
class Writer {
  out = ''
  private lineStart: boolean

  /** `inItem`: a list item, where a line break can only be a space. */
  constructor(private readonly inItem: boolean) {
    this.lineStart = !inItem
  }

  text(s: string) {
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      const next = s[i + 1]
      if (c === '\n') {
        this.lineBreak()
        continue
      }
      let escape = false
      if (c === '\\') {
        // A backslash at the end may meet a mention's bracket; escape it too.
        escape = next === undefined || ESCAPABLE.has(next)
      } else if (c === '[') {
        const prev = this.out[this.out.length - 1]
        escape = prev === '@' || prev === '[' || next === '[' || next === undefined
      } else if ((c === '-' || c === '*') && this.lineStart) {
        escape = next === ' ' || next === undefined
      }
      this.out += escape ? '\\' + c : c
      this.lineStart = false
    }
  }

  lineBreak() {
    if (this.inItem) {
      this.out += ' '
    } else {
      this.out += '\n'
      this.lineStart = true
    }
  }

  raw(s: string) {
    this.out += s
    this.lineStart = false
  }
}

function escapeLabel(label: string): string {
  return label.replace(/[\\[\]]/g, '\\$&')
}

/** The written id of a mention, or null when it cannot be written. */
function writtenId(id: unknown): string | null {
  if (isPendingId(id)) return NEW_ID
  return typeof id === 'string' && ID_RE.test(id) && id !== NEW_ID ? id : null
}

function writeInline(node: ProseNode, w: Writer): void {
  const label = String(node.attrs?.label ?? '')
  if (node.type === CONTACT_MENTION) {
    const id = writtenId(node.attrs?.id)
    if (id && label.trim()) w.raw(`@[${escapeLabel(label)}](contact:${id})`)
    else w.text('@' + label)
    return
  }
  if (node.type === ENTITY_REF) {
    const id = writtenId(node.attrs?.id)
    const kind = node.attrs?.kind === 'project' ? 'project' : 'task'
    if (id && label.trim()) w.raw(`[[${escapeLabel(label)}]](${kind}:${id})`)
    else w.text(label)
    return
  }
  if (node.type === 'hardBreak') {
    w.lineBreak()
    return
  }
  if (typeof node.text === 'string') w.text(node.text)
  node.content?.forEach((child) => writeInline(child, w))
}

function holdsInline(node: ProseNode): boolean {
  return !!node.content?.some((c) => INLINE.has(c.type ?? ''))
}

function isTextBlock(node: ProseNode): boolean {
  return node.type === 'paragraph' || node.type === 'heading' || holdsInline(node)
}

function render(node: ProseNode, inItem: boolean): string {
  const w = new Writer(inItem)
  node.content?.forEach((child) => writeInline(child, w))
  return w.out
}

/** Every line a bullet list holds, nested lists and extra paragraphs included. */
function listItems(node: ProseNode, items: string[]): void {
  for (const child of node.content ?? []) {
    if (isTextBlock(child)) items.push(render(child, true))
    else listItems(child, items)
  }
}

function collect(node: ProseNode, blocks: Block[]): void {
  if (node.type === 'bulletList') {
    const items: string[] = []
    listItems(node, items)
    if (items.length) blocks.push({ items })
  } else if (isTextBlock(node)) {
    blocks.push({ para: render(node, false) })
  } else {
    node.content?.forEach((child) => collect(child, blocks))
  }
}

/** The note as plain text with mentions; an empty note gives an empty string. */
export function docToBody(doc: ProseNode): string {
  const blocks: Block[] = []
  collect(doc, blocks)
  return blocks
    .flatMap((b) => {
      if ('items' in b) return [b.items.map((item) => '- ' + item).join('\n')]
      return b.para.trim() ? [b.para] : []
    })
    .join('\n\n')
}

/**
 * A stored entry with `body`, its note as plain text, added beside `bodyJson`.
 * Every answer that carries an entry goes through this, so `body` is always there.
 */
export function withBody<T extends { bodyJson: unknown }>(entry: T): T & { body: string } {
  const doc = entry.bodyJson
  const body = doc && typeof doc === 'object' ? docToBody(doc as ProseNode) : ''
  return { ...entry, body }
}
