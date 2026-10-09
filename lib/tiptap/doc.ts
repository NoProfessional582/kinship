import { CONTACT_MENTION, ENTITY_REF, isPendingId, type EntityKind } from './nodes'

/**
 * A single walker over the TipTap document, shared by every consumer:
 * extracting references, rewriting provisional ids, and flattening to text.
 * Keeping one traversal here is what stops the three from drifting apart.
 */

export type ProseNode = {
  type?: string
  attrs?: Record<string, any>
  content?: ProseNode[]
  text?: string
  marks?: unknown[]
}

export interface DocRefs {
  /** Ids of contacts that already exist. */
  contactIds: string[]
  /** Existing task references. */
  taskIds: string[]
  /** Existing project references. */
  projectIds: string[]
  /** Provisional entities the note asked to create, deduped by provisional id. */
  pending: PendingEntity[]
}

export interface PendingEntity {
  /** The `new:<uuid>` placeholder carried by the node. */
  tempId: string
  type: 'contact' | 'task' | 'project'
  label: string
}

function walk(node: ProseNode | undefined, visit: (n: ProseNode) => void): void {
  if (!node) return
  visit(node)
  if (Array.isArray(node.content)) {
    for (const child of node.content) walk(child, visit)
  }
}

/** Collects every entity the document references, separating real from pending. */
export function collectDocRefs(doc: ProseNode): DocRefs {
  const contactIds = new Set<string>()
  const taskIds = new Set<string>()
  const projectIds = new Set<string>()
  const pending = new Map<string, PendingEntity>()

  walk(doc, (n) => {
    const id = n.attrs?.id
    if (typeof id !== 'string') return

    if (n.type === CONTACT_MENTION) {
      if (isPendingId(id)) {
        pending.set(id, { tempId: id, type: 'contact', label: String(n.attrs?.label ?? '') })
      } else {
        contactIds.add(id)
      }
      return
    }

    if (n.type === ENTITY_REF) {
      const kind = (n.attrs?.kind as EntityKind) ?? 'task'
      if (isPendingId(id)) {
        pending.set(id, { tempId: id, type: kind, label: String(n.attrs?.label ?? '') })
      } else if (kind === 'project') {
        projectIds.add(id)
      } else {
        taskIds.add(id)
      }
    }
  })

  return {
    contactIds: [...contactIds],
    taskIds: [...taskIds],
    projectIds: [...projectIds],
    pending: [...pending.values()],
  }
}

/**
 * Returns a deep copy of the document with every provisional id replaced by the
 * real one. Runs server-side inside the save transaction, so a failed save can
 * never leave the body pointing at rows that were rolled back.
 */
export function rewriteDocIds(doc: ProseNode, idMap: Map<string, string>): ProseNode {
  function transform(node: ProseNode): ProseNode {
    const next: ProseNode = { ...node }

    const id = node.attrs?.id
    if (
      (node.type === CONTACT_MENTION || node.type === ENTITY_REF) &&
      typeof id === 'string' &&
      idMap.has(id)
    ) {
      next.attrs = { ...node.attrs, id: idMap.get(id)! }
    } else if (node.attrs) {
      next.attrs = { ...node.attrs }
    }

    if (Array.isArray(node.content)) next.content = node.content.map(transform)
    return next
  }

  return transform(doc)
}

/**
 * Flattens the document to plain text for the full-text index. Mention labels
 * are inlined so searching a person's name finds the notes that tag them.
 */
export function docToText(doc: ProseNode): string {
  const parts: string[] = []
  const BLOCK = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'listItem',
    'taskItem',
    'codeBlock',
    'horizontalRule',
  ])

  function visit(node: ProseNode) {
    if (node.type === CONTACT_MENTION) {
      parts.push('@' + String(node.attrs?.label ?? ''))
      return
    }
    if (node.type === ENTITY_REF) {
      parts.push(String(node.attrs?.label ?? ''))
      return
    }
    if (typeof node.text === 'string') parts.push(node.text)
    if (Array.isArray(node.content)) node.content.forEach(visit)
    if (node.type && BLOCK.has(node.type)) parts.push('\n')
  }

  visit(doc)
  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
