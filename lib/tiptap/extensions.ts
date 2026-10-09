import { Node, mergeAttributes } from '@tiptap/core'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import { canOfferCreate, normalizeLabel } from '../utils'
import { CONTACT_MENTION, ENTITY_REF, isPendingId, makePendingId, type EntityKind } from './nodes'
import type { SuggestionItem } from '@/components/editor/suggestion-list'

/**
 * Reuses the provisional id already present in the document for the same label,
 * so writing "@Sarah" twice and choosing "create" both times yields one contact
 * with two mentions rather than two duplicate people.
 *
 * Reading it back off the document rather than tracking it in separate state is
 * what keeps it correct across undo, redo and paste.
 */
/**
 * The provisional id an earlier placeholder for the same thing already got, so
 * two mentions of it in one note create one row rather than two.
 *
 * `kind` is part of the identity, not decoration: entity refs cover both tasks
 * and projects, and matching on the label alone made "[[Q3 Planning]] as a
 * task" and "[[Q3 Planning]] as a project" share one tempId. `collectDocRefs`
 * dedupes pending entities by tempId, so the pair collapsed into a single row
 * of whichever kind was written last, and the other chip linked to something
 * that did not exist.
 */
function reusePendingId(editor: Editor, nodeName: string, label: string, kind?: string): string {
  const target = normalizeLabel(label)
  let found: string | null = null
  editor.state.doc.descendants((node) => {
    if (found) return false
    if (
      node.type.name === nodeName &&
      isPendingId(node.attrs.id) &&
      (kind === undefined || node.attrs.kind === kind) &&
      normalizeLabel(String(node.attrs.label ?? '')) === target
    ) {
      found = node.attrs.id
    }
    return true
  })
  return found ?? makePendingId()
}

async function fetchSuggestions(
  type: 'contact' | 'entity',
  query: string,
): Promise<SuggestionItem[]> {
  try {
    const res = await fetch(`/api/search/mentions?type=${type}&q=${encodeURIComponent(query)}`)
    if (!res.ok) return []
    return (await res.json()) as SuggestionItem[]
  } catch {
    return []
  }
}

/**
 * Each Suggestion instance needs its own PluginKey. They default to
 * PluginKey('suggestion'), and ProseMirror rejects two different instances of a
 * keyed plugin with `RangeError: Adding different instances of a keyed plugin`
 * -- which throws during editor construction and takes the whole React tree
 * down, not just the editor.
 */
const CONTACT_SUGGESTION_KEY = new PluginKey('contactMentionSuggestion')
const ENTITY_SUGGESTION_KEY = new PluginKey('entityRefSuggestion')

/**
 * Replaces the typed trigger text with the tag node.
 *
 * Deliberately inserts nothing after it: with a trailing space the caret lands
 * past a gap, so a comma or period following a tag would be separated from it.
 * Both triggers share this so the behaviour cannot drift between them.
 */
export function insertTagNode(
  editor: Editor,
  range: { from: number; to: number },
  node: { type: string; attrs: Record<string, unknown> },
): void {
  editor.chain().focus().insertContentAt(range, node).run()
}

type RenderFn = SuggestionOptions<SuggestionItem>['render']

// --------------------------------------------------------------- @ contacts

export const ContactMention = Node.create<{ render: RenderFn }>({
  name: CONTACT_MENTION,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return { render: undefined as unknown as RenderFn }
  },

  addAttributes() {
    return {
      id: { default: null },
      label: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="contact-mention"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'contact-mention',
        'data-id': node.attrs.id,
        'data-label': node.attrs.label,
        'data-pending': isPendingId(node.attrs.id) ? 'true' : 'false',
        class: 'kb-tag',
      }),
      `@${node.attrs.label}`,
    ]
  },

  renderText({ node }) {
    return `@${node.attrs.label}`
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestionItem>({
        editor: this.editor,
        pluginKey: CONTACT_SUGGESTION_KEY,
        char: '@',
        allowSpaces: true,
        startOfLine: false,
        render: this.options.render,
        items: async ({ query }) => {
          const results = await fetchSuggestions('contact', query)
          const term = query.trim()
          const exact = results.some((r) => normalizeLabel(r.label) === normalizeLabel(term))
          if (exact || !canOfferCreate(term)) return results
          return [
            ...results,
            { id: 'create', label: term, kind: 'contact', createAs: 'contact' } as SuggestionItem,
          ]
        },
        command: ({ editor, range, props }) => {
          const id = props.createAs
            ? reusePendingId(editor, CONTACT_MENTION, props.label)
            : props.id
          insertTagNode(editor, range, {
            type: CONTACT_MENTION,
            attrs: { id, label: props.label },
          })
        },
      }),
    ]
  },
})

// ------------------------------------------------ [[ tasks and projects

export const EntityRef = Node.create<{ render: RenderFn }>({
  name: ENTITY_REF,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return { render: undefined as unknown as RenderFn }
  },

  addAttributes() {
    return {
      id: { default: null },
      kind: { default: 'task' as EntityKind },
      label: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="entity-ref"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'entity-ref',
        'data-id': node.attrs.id,
        'data-kind': node.attrs.kind,
        'data-label': node.attrs.label,
        'data-pending': isPendingId(node.attrs.id) ? 'true' : 'false',
        class: 'kb-tag',
      }),
      node.attrs.label,
    ]
  },

  renderText({ node }) {
    return node.attrs.label
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestionItem>({
        editor: this.editor,
        pluginKey: ENTITY_SUGGESTION_KEY,
        // Multi-character triggers work because @tiptap/suggestion runs the
        // trigger through escapeForRegEx before building its match regex.
        char: '[[',
        allowSpaces: true,
        startOfLine: false,
        render: this.options.render,
        items: async ({ query }) => {
          // Tolerate a manually typed closing "]]".
          const term = query.trim().replace(/\]+$/, '').trim()
          const results = await fetchSuggestions('entity', term)
          const exact = results.some((r) => normalizeLabel(r.label) === normalizeLabel(term))
          if (exact || !canOfferCreate(term)) return results
          return [
            ...results,
            { id: 'create-task', label: term, kind: 'task', createAs: 'task' } as SuggestionItem,
            {
              id: 'create-project',
              label: term,
              kind: 'project',
              createAs: 'project',
            } as SuggestionItem,
          ]
        },
        command: ({ editor, range, props }) => {
          const kind: EntityKind = (props.createAs ?? props.kind) as EntityKind
          const id = props.createAs
            ? reusePendingId(editor, ENTITY_REF, props.label, kind)
            : props.id
          insertTagNode(editor, range, {
            type: ENTITY_REF,
            attrs: { id, kind, label: props.label },
          })
        },
      }),
    ]
  },
})
