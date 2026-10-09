// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { ContactMention, EntityRef, insertTagNode } from '@/lib/tiptap/extensions'
import { CONTACT_MENTION, ENTITY_REF, isPendingId } from '@/lib/tiptap/nodes'

/**
 * Drives a real TipTap editor through the *actual* insert used by both
 * suggestion commands, so re-introducing a trailing space fails these tests
 * rather than silently changing behaviour in the browser only.
 */
let editor: Editor

beforeEach(() => {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({
    element,
    extensions: [
      Document, Paragraph, Text,
      ContactMention.configure({ render: undefined as any }),
      EntityRef.configure({ render: undefined as any }),
    ],
    content: '<p></p>',
  })
})

/** Types the trigger text, then commits a tag over it the way the plugin does. */
function commitTag(typed: string, node: { type: string; attrs: Record<string, unknown> }) {
  editor.commands.setContent('<p></p>')
  editor.commands.insertContent(typed)
  const to = editor.state.selection.from
  insertTagNode(editor, { from: to - typed.length, to }, node)
}

afterEach(() => { editor?.destroy() })

const maya = { type: CONTACT_MENTION, attrs: { id: 'c1', label: 'Maya Okafor' } }
const sitemap = { type: ENTITY_REF, attrs: { id: 't1', kind: 'task', label: 'Draft the sitemap' } }

const paragraph = () => (editor.getJSON().content as any[])[0]

describe('committing a tag', () => {
  it('inserts only the tag, with nothing after it', () => {
    commitTag('@may', maya)
    const para = paragraph()
    expect(para.content).toHaveLength(1)
    expect(para.content[0].type).toBe(CONTACT_MENTION)
    expect(para.content[0].attrs.label).toBe('Maya Okafor')
  })

  it('lets punctuation sit flush against the tag', () => {
    commitTag('@may', maya)
    editor.commands.insertContent(',')
    expect(editor.getText()).toBe('@Maya Okafor,')
    expect(paragraph().content[1]).toMatchObject({ type: 'text', text: ',' })
  })

  it('supports a period straight after a [[ ref', () => {
    commitTag('[[site', sitemap)
    editor.commands.insertContent('.')
    expect(editor.getText()).toBe('Draft the sitemap.')
    expect(paragraph().content[0].attrs.kind).toBe('task')
  })

  it('still allows a space when the writer types one', () => {
    commitTag('@may', maya)
    editor.commands.insertContent(' and then some')
    expect(editor.getText()).toBe('@Maya Okafor and then some')
  })

  it('consumes the typed trigger text entirely', () => {
    commitTag('@may', maya)
    expect(editor.getText()).toBe('@Maya Okafor')
    expect(editor.getText()).not.toContain('@may')
  })

  it('keeps a provisional id pending so it renders dashed', () => {
    commitTag('@new', { type: CONTACT_MENTION, attrs: { id: 'new:abc', label: 'Brand New' } })
    expect(isPendingId(paragraph().content[0].attrs.id)).toBe(true)
  })

  it('tags mid-sentence without disturbing surrounding text', () => {
    editor.commands.setContent('<p></p>')
    editor.commands.insertContent('spoke to @may')
    const to = editor.state.selection.from
    insertTagNode(editor, { from: to - '@may'.length, to }, maya)
    editor.commands.insertContent(', see notes')
    expect(editor.getText()).toBe('spoke to @Maya Okafor, see notes')
  })
})
