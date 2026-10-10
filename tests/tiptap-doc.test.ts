import { describe, expect, it } from 'vitest'
import { collectDocRefs, rewriteDocIds, docToText, type ProseNode } from '@/lib/tiptap/doc'
import { CONTACT_MENTION, ENTITY_REF, isPendingId, makePendingId } from '@/lib/tiptap/nodes'

const doc: ProseNode = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Spoke with ' },
        { type: CONTACT_MENTION, attrs: { id: 'new:c1', label: 'Maya Okafor' } },
        { type: 'text', text: ' about ' },
        { type: ENTITY_REF, attrs: { id: 'new:p1', kind: 'project', label: 'Website redesign' } },
        { type: 'text', text: ' and ' },
        { type: ENTITY_REF, attrs: { id: 'task-real', kind: 'task', label: 'Draft the sitemap' } },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Looping in ' },
        { type: CONTACT_MENTION, attrs: { id: 'new:c1', label: 'Maya Okafor' } },
        { type: 'text', text: ' again, plus ' },
        { type: CONTACT_MENTION, attrs: { id: 'contact-real', label: 'Tobias' } },
      ],
    },
  ],
}

describe('collectDocRefs', () => {
  const refs = collectDocRefs(doc)

  it('separates existing references from pending ones', () => {
    expect(refs.contactIds).toEqual(['contact-real'])
    expect(refs.taskIds).toEqual(['task-real'])
    expect(refs.projectIds).toEqual([])
  })

  it('dedupes a repeated placeholder so one entity is created, not two', () => {
    const contacts = refs.pending.filter((p) => p.type === 'contact')
    expect(contacts).toHaveLength(1)
    expect(contacts[0].label).toBe('Maya Okafor')
  })

  it('routes a pending [[ ref to the kind the node carries', () => {
    expect(refs.pending.find((p) => p.tempId === 'new:p1')?.type).toBe('project')
  })
})

describe('rewriteDocIds', () => {
  const map = new Map([
    ['new:c1', 'cuid-maya'],
    ['new:p1', 'cuid-project'],
  ])
  const out = rewriteDocIds(doc, map)

  it('leaves no provisional ids behind', () => {
    expect(JSON.stringify(out)).not.toContain('new:')
  })

  it('rewrites every occurrence of a repeated placeholder', () => {
    const ids = JSON.stringify(out).match(/cuid-maya/g) ?? []
    expect(ids).toHaveLength(2)
  })

  it('does not disturb ids that were already real', () => {
    expect(JSON.stringify(out)).toContain('contact-real')
    expect(JSON.stringify(out)).toContain('task-real')
  })

  it('does not mutate the input document', () => {
    expect(JSON.stringify(doc)).toContain('new:c1')
  })
})

describe('docToText', () => {
  const text = docToText(doc)

  it('inlines mention labels so tagged names are searchable', () => {
    expect(text).toContain('@Maya Okafor')
    expect(text).toContain('Website redesign')
  })

  it('keeps the surrounding prose', () => {
    expect(text).toContain('Spoke with')
  })
})

describe('provisional ids', () => {
  it('round-trips through the pending predicate', () => {
    expect(isPendingId(makePendingId())).toBe(true)
  })

  it('does not classify a real cuid as pending', () => {
    expect(isPendingId('cmt289yc1000001lqm3s0fyce')).toBe(false)
  })
})
