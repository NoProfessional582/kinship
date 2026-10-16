import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { ContactMention, EntityRef } from '@/lib/tiptap/extensions'
import { collectDocRefs, EMPTY_DOC, type ProseNode } from '@/lib/tiptap/doc'
import { textToDoc } from '@/lib/tiptap/from-text'
import { docToBody } from '@/lib/tiptap/to-text'
import { CONTACT_MENTION, ENTITY_REF, isPendingId } from '@/lib/tiptap/nodes'

const text = (t: string): ProseNode => ({ type: 'text', text: t })
const para = (...content: ProseNode[]): ProseNode =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
const doc = (...content: ProseNode[]): ProseNode => ({ type: 'doc', content })
const contact = (id: string, label: string): ProseNode => ({
  type: CONTACT_MENTION,
  attrs: { id, label },
})
const ref = (id: string, kind: 'task' | 'project', label: string): ProseNode => ({
  type: ENTITY_REF,
  attrs: { id, kind, label },
})
const br: ProseNode = { type: 'hardBreak' }
const list = (...items: ProseNode[][]): ProseNode => ({
  type: 'bulletList',
  content: items.map((c) => ({ type: 'listItem', content: [para(...c)] })),
})

/** Replaces each distinct `new:<uuid>` with `new:1`, `new:2`… in order, so docs compare. */
function stablePending(d: ProseNode): ProseNode {
  const seen = new Map<string, string>()
  return JSON.parse(JSON.stringify(d), (key, value: unknown) => {
    if (key === 'id' && isPendingId(value)) {
      if (!seen.has(value)) seen.set(value, `new:${seen.size + 1}`)
      return seen.get(value)
    }
    return value
  }) as ProseNode
}

describe('textToDoc', () => {
  it('reads each kind of mention with its id', () => {
    expect(
      textToDoc(
        'Met @[Jane Doe](contact:c1) about [[Ship v2]](task:t1) for [[Launch]](project:p1).',
      ),
    ).toEqual(
      doc(
        para(
          text('Met '),
          contact('c1', 'Jane Doe'),
          text(' about '),
          ref('t1', 'task', 'Ship v2'),
          text(' for '),
          ref('p1', 'project', 'Launch'),
          text('.'),
        ),
      ),
    )
  })

  it('turns `new` into one shared placeholder per kind and label', () => {
    const d = textToDoc(
      '@[Sam](contact:new) and @[ sam ](contact:new), [[Q3]](task:new) [[Q3]](project:new)',
    )
    const refs = collectDocRefs(d)
    expect(refs.contactIds).toEqual([])
    expect(refs.pending.map((p) => p.type)).toEqual(['contact', 'task', 'project'])
    expect(refs.pending.every((p) => isPendingId(p.tempId))).toBe(true)
  })

  it('gives separate notes separate placeholders', () => {
    const a = collectDocRefs(textToDoc('@[Sam](contact:new)')).pending[0].tempId
    const b = collectDocRefs(textToDoc('@[Sam](contact:new)')).pending[0].tempId
    expect(a).not.toBe(b)
  })

  it('leaves anything that is not a whole mention as text', () => {
    for (const t of [
      'a [link](https://x.y) and (aside) @ home',
      '@[Jane](contact:)',
      '@[](contact:c1)',
      '@[Jane](task:t1)',
      '[[Ship]](contact:c1)',
      '[[Ship]](task:new:abc)',
      '[[Ship](task:t1)',
      'email@[host]',
      '@[Jane](contact:c1',
    ]) {
      expect(textToDoc(t)).toEqual(doc(para(text(t))))
    }
  })

  it('reads escapes, and keeps other backslashes', () => {
    expect(textToDoc(String.raw`@\[x](contact:c1) C:\path \@ \\`)).toEqual(
      doc(para(text(String.raw`@[x](contact:c1) C:\path \@ ` + '\\'))),
    )
    expect(textToDoc(String.raw`@[A \] B \\ C](contact:c1)`)).toEqual(
      doc(para(contact('c1', String.raw`A ] B \ C`))),
    )
    expect(textToDoc('\\- not a bullet\n\\* nor this')).toEqual(
      doc(para(text('- not a bullet'), br, text('* nor this'))),
    )
  })

  it('splits paragraphs at blank lines and breaks lines inside one', () => {
    expect(textToDoc('one\ntwo\n\n  \n\nthree\r\nfour')).toEqual(
      doc(para(text('one'), br, text('two')), para(text('three'), br, text('four'))),
    )
  })

  it('makes a run of bullet lines one list, apart from the paragraphs around it', () => {
    expect(textToDoc('Agenda:\n- one\n* [[Two]](task:t2)\n- \nAfter')).toEqual(
      doc(
        para(text('Agenda:')),
        list([text('one')], [ref('t2', 'task', 'Two')], []),
        para(text('After')),
      ),
    )
    expect(textToDoc('-not\n -nor\n  - nor')).toEqual(
      doc(para(text('-not'), br, text(' -nor'), br, text('  - nor'))),
    )
  })

  it('gives the empty note for empty or blank text', () => {
    for (const t of ['', '   ', '\n\n \t\n']) expect(textToDoc(t)).toEqual(EMPTY_DOC)
    expect(textToDoc('')).not.toBe(EMPTY_DOC)
  })
})

describe('docToBody', () => {
  it('writes mentions with real ids and placeholders as `new`', () => {
    expect(
      docToBody(
        doc(
          para(
            contact('c1', 'Jane'),
            text(' / '),
            contact('new:abc', 'Sam'),
            text(' / '),
            ref('t1', 'task', 'Ship'),
            text(' / '),
            ref('new:def', 'project', 'Launch'),
          ),
        ),
      ),
    ).toBe(
      '@[Jane](contact:c1) / @[Sam](contact:new) / [[Ship]](task:t1) / [[Launch]](project:new)',
    )
  })

  it('writes a mention it cannot express as its label', () => {
    expect(
      docToBody(
        doc(para(contact('', 'Jane'), text(' '), ref('bad id', 'task', 'Ship'), contact('c1', ''))),
      ),
    ).toBe('@Jane Ship@')
  })

  it('escapes only what would misread', () => {
    expect(docToBody(doc(para(text('@[x](contact:c1) and [[y]](task:t1) [a] (b)'))))).toBe(
      String.raw`@\[x](contact:c1) and \[\[y]](task:t1) [a] (b)`,
    )
    expect(docToBody(doc(para(text(String.raw`C:\path \[ end` + '\\'))))).toBe(
      String.raw`C:\path \\[ end\\`,
    )
    expect(docToBody(doc(para(text('- a'), br, text('* b'), br, text('a - b'))))).toBe(
      '\\- a\n\\* b\na - b',
    )
    expect(docToBody(doc(para(contact('c1', 'A ] [B \\'))))).toBe(
      String.raw`@[A \] \[B \\](contact:c1)`,
    )
    // A bracket or backslash ending one text node could join the next node's syntax.
    expect(
      docToBody(doc(para(text('x['), ref('t1', 'task', 'T'), text('\\'), contact('c1', 'C')))),
    ).toBe(String.raw`x\[[[T]](task:t1)\\@[C](contact:c1)`)
  })

  it('degrades formatting and other editor blocks to text', () => {
    const editorDoc = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
      para(text('bold'), { type: 'text', text: ' and link', marks: [{ type: 'bold' }] }),
      { type: 'blockquote', content: [para(text('quoted'))] },
      { type: 'codeBlock', content: [text('line 1\nline 2')] },
      { type: 'horizontalRule' },
      {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [para(text('first'))] }],
      },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [para(contact('c1', 'Jane'))] },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [para(text('outer'), br, text('more')), list([text('inner')])],
          },
        ],
      },
      para(),
    )
    expect(docToBody(editorDoc)).toBe(
      [
        'Title',
        'bold and link',
        'quoted',
        'line 1\nline 2',
        'first',
        '@[Jane](contact:c1)',
        '- outer more\n- inner',
      ].join('\n\n'),
    )
  })

  it('gives an empty string for the empty note', () => {
    expect(docToBody(EMPTY_DOC)).toBe('')
    expect(docToBody({ type: 'doc' })).toBe('')
  })
})

describe('round trip', () => {
  /** Each written the way docToBody writes it, so it must come back unchanged. */
  const canonical = [
    '',
    'One line.',
    'Met @[Jane Doe](contact:c1) about [[Ship v2]](task:t1) for [[Launch]](project:p1).',
    'New @[Sam](contact:new), again @[Sam](contact:new), [[Q3]](task:new) and [[Q3]](project:new)',
    'first line\nsecond line\n  indented\n\nnext paragraph',
    'Agenda:\n\n- one\n- [[Two]](task:t2) and @[Jane](contact:c1)\n- \n\nAfter',
    String.raw`@\[not](contact:c1) \[\[nor]](task:t1) C:\path \ [a] (b) email@x`,
    String.raw`@[A \] \[B \\](contact:c1)`,
    '\\- not a list\n\\* nor this\nan - inline dash',
    '- item - with dash\n- * star',
  ]

  // The editor's extensions, as lib/tiptap/render.ts builds them.
  const schema = getSchema([
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ContactMention,
    EntityRef,
  ])

  it.each(canonical)('makes a doc the editor accepts from %j', (t) => {
    expect(() => schema.nodeFromJSON(textToDoc(t)).check()).not.toThrow()
  })

  it.each(canonical)('text → doc → text keeps %j', (t) => {
    expect(docToBody(textToDoc(t))).toBe(t)
  })

  it.each(canonical)('doc → text → doc keeps the doc made from %j', (t) => {
    const d = textToDoc(t)
    expect(stablePending(textToDoc(docToBody(d)))).toEqual(stablePending(d))
  })

  it('normalises other spellings to the canonical text', () => {
    const cases: [string, string][] = [
      ['\r\n\r\nA\r\nB\r\n\r\n\r\n\r\nC  \n\n', 'A\nB\n\nC  '],
      ['* one\n* two', '- one\n- two'],
      ['Intro\n- item\nOutro', 'Intro\n\n- item\n\nOutro'],
      [String.raw`\[ plain \] \- mid`, String.raw`[ plain ] - mid`],
    ]
    for (const [input, out] of cases) expect(docToBody(textToDoc(input))).toBe(out)
  })
})
