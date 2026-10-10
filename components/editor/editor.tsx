'use client'
import * as React from 'react'
import { useEditor, EditorContent, type Content, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  Quote,
  Heading2,
  ListChecks,
  Undo2,
  Redo2,
} from 'lucide-react'
import { ContactMention, EntityRef } from '@/lib/tiptap/extensions'
import { createSuggestionRenderer } from '@/lib/tiptap/renderer'
import { cn } from '@/lib/utils'

interface Props {
  onReady?: (editor: Editor) => void
  placeholder?: string
  className?: string
  content?: Content
  editable?: boolean
  autoFocus?: boolean
  /** Adds the @ / [[ trigger buttons to the right of the toolbar. */
  mentionShortcuts?: boolean
  onUpdate?: (editor: Editor) => void
  onSubmit?: () => void
}

export function RichEditor({
  onReady,
  placeholder,
  className,
  content,
  editable = true,
  autoFocus,
  mentionShortcuts,
  onUpdate,
  onSubmit,
}: Props) {
  const render = React.useMemo(() => createSuggestionRenderer(), [])
  // Kept in a ref so changing the handler never has to re-create the editor.
  const submitRef = React.useRef(onSubmit)
  React.useEffect(() => {
    submitRef.current = onSubmit
  }, [onSubmit])

  const editor = useEditor({
    // Next renders this on the server first; TipTap must not hydrate eagerly.
    immediatelyRender: false,
    editable,
    autofocus: autoFocus ? 'end' : false,
    extensions: [
      // StarterKit 3 already bundles Link; configuring it here rather than
      // registering @tiptap/extension-link separately avoids a duplicate name.
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Write freely — type @ for a person, [[ for a task or project…',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ContactMention.configure({ render }),
      EntityRef.configure({ render }),
    ],
    content: content ?? '',
    onUpdate: onUpdate ? ({ editor: e }) => onUpdate(e) : undefined,
    editorProps: {
      attributes: { class: 'focus:outline-none' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && submitRef.current) {
          event.preventDefault()
          submitRef.current()
          return true
        }
        return false
      },
    },
  })

  React.useEffect(() => {
    if (editor && onReady) onReady(editor)
  }, [editor, onReady])

  if (!editor) {
    return (
      <div
        className={cn('kb-editor min-h-36 animate-pulse rounded-md bg-[var(--muted)]', className)}
      />
    )
  }

  return (
    <div className={cn('kb-editor', className)}>
      {editable && <Toolbar editor={editor} mentionShortcuts={mentionShortcuts} />}
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor, mentionShortcuts }: { editor: Editor; mentionShortcuts?: boolean }) {
  const [, force] = React.useReducer((n: number) => n + 1, 0)

  React.useEffect(() => {
    const rerender = () => force()
    editor.on('selectionUpdate', rerender)
    editor.on('transaction', rerender)
    return () => {
      editor.off('selectionUpdate', rerender)
      editor.off('transaction', rerender)
    }
  }, [editor])

  const items = [
    {
      icon: Bold,
      label: 'Bold',
      run: () => editor.chain().focus().toggleBold().run(),
      active: editor.isActive('bold'),
    },
    {
      icon: Italic,
      label: 'Italic',
      run: () => editor.chain().focus().toggleItalic().run(),
      active: editor.isActive('italic'),
    },
    {
      icon: Strikethrough,
      label: 'Strikethrough',
      run: () => editor.chain().focus().toggleStrike().run(),
      active: editor.isActive('strike'),
    },
    {
      icon: Code,
      label: 'Code',
      run: () => editor.chain().focus().toggleCode().run(),
      active: editor.isActive('code'),
    },
    { sep: true },
    {
      icon: Heading2,
      label: 'Heading',
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      active: editor.isActive('heading', { level: 2 }),
    },
    {
      icon: List,
      label: 'Bullet list',
      run: () => editor.chain().focus().toggleBulletList().run(),
      active: editor.isActive('bulletList'),
    },
    {
      icon: ListOrdered,
      label: 'Numbered list',
      run: () => editor.chain().focus().toggleOrderedList().run(),
      active: editor.isActive('orderedList'),
    },
    {
      icon: ListChecks,
      label: 'Task list',
      run: () => editor.chain().focus().toggleTaskList().run(),
      active: editor.isActive('taskList'),
    },
    {
      icon: Quote,
      label: 'Quote',
      run: () => editor.chain().focus().toggleBlockquote().run(),
      active: editor.isActive('blockquote'),
    },
    { sep: true },
    { icon: Undo2, label: 'Undo', run: () => editor.chain().focus().undo().run(), active: false },
    { icon: Redo2, label: 'Redo', run: () => editor.chain().focus().redo().run(), active: false },
  ] as const

  // Typing the trigger character is what opens the suggestion popup, so these
  // buttons insert the character rather than calling the extension directly.
  const trigger = (chars: string) => {
    const { from } = editor.state.selection
    const before = from > 1 ? editor.state.doc.textBetween(from - 1, from) : ''
    const lead = before && before !== ' ' ? ' ' : ''
    editor
      .chain()
      .focus()
      .insertContent(lead + chars)
      .run()
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-0.5 border-b border-[var(--border)] pb-2">
      {items.map((item, i) =>
        'sep' in item ? (
          <div key={i} className="mx-1 h-4 w-px bg-[var(--border)]" />
        ) : (
          <button
            key={i}
            type="button"
            title={item.label}
            aria-label={item.label}
            onClick={item.run}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded transition-colors',
              item.active
                ? 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
            )}
          >
            <item.icon className="h-3.5 w-3.5" />
          </button>
        ),
      )}
      {mentionShortcuts && (
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => trigger('@')}
            className="kb-trigger inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] transition-colors"
          >
            <span className="kb-trigger-key">@</span> person
          </button>
          <button
            type="button"
            onClick={() => trigger('[[')}
            className="kb-trigger inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-1 text-[11px] transition-colors"
          >
            <span className="kb-trigger-key">[[</span> task or project
          </button>
        </div>
      )}
    </div>
  )
}
