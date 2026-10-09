import { generateHTML } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { ContactMention, EntityRef } from './extensions'
import type { ProseNode } from './doc'

/**
 * Serializes a stored TipTap document to HTML for read-only display.
 *
 * The same extensions that produced the document are used to render it, so
 * mention and reference nodes go through their own `renderHTML` and come out as
 * `.kb-tag` spans — which is what keeps the coloured people and task chips
 * alive outside the editor. Rendering the flattened `bodyText` instead is what
 * previously stripped lists, emphasis and links from the activity feed.
 *
 * This is far cheaper than mounting an editor per card: no ProseMirror view,
 * no plugins, just a schema walk.
 */
const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: true },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  ContactMention.configure({ render: undefined }),
  EntityRef.configure({ render: undefined }),
]

export function renderEntryHtml(doc: ProseNode | null | undefined): string {
  if (!doc || typeof doc !== 'object') return ''
  try {
    return generateHTML(doc, EXTENSIONS)
  } catch {
    // A malformed document must never take the feed down with it.
    return ''
  }
}
