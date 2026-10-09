'use client'
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { User, SquareCheck, FolderKanban } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useEnrichmentQueue } from '@/lib/store'
import { api } from '@/lib/hooks/api'
import { ContactForm, blankContact, contactToPayload, type ContactFormValue } from './contact-form'
import { TaskForm, blankTask, taskToPayload, type TaskFormValue } from './task-form'
import { ProjectForm, blankProject, projectToPayload, type ProjectFormValue } from './project-form'

const META = {
  contact: {
    icon: User,
    title: 'New contact',
    hint: 'Fill in what you know — you can always come back to it.',
  },
  task: {
    icon: SquareCheck,
    title: 'New task',
    hint: 'Give it a home and a deadline so it lands on the board and calendar.',
  },
  project: {
    icon: FolderKanban,
    title: 'New project',
    hint: 'Projects group tasks and give the board its swimlanes.',
  },
} as const

/**
 * Drains newly created entities one at a time after a save, so capture is never
 * interrupted by data entry. Skipping leaves the row `isDraft: true`, where the
 * dashboard's "Needs details" tray picks it up.
 */
export function EnrichmentQueue() {
  const { queue, index, advance, dismiss } = useEnrichmentQueue()
  const qc = useQueryClient()
  const current = queue[index]

  const [contact, setContact] = React.useState<ContactFormValue>(blankContact())
  const [task, setTask] = React.useState<TaskFormValue>(blankTask())
  const [project, setProject] = React.useState<ProjectFormValue>(blankProject())
  const [saving, setSaving] = React.useState(false)

  // Re-seed the form whenever the queue advances to a different entity.
  React.useEffect(() => {
    if (!current) return
    if (current.type === 'contact') setContact(blankContact(current.label))
    if (current.type === 'task') setTask(blankTask(current.label))
    if (current.type === 'project') setProject(blankProject(current.label))
  }, [current?.id, current?.type, current?.label])

  if (!current) return null

  const meta = META[current.type]
  const Icon = meta.icon

  const save = async () => {
    setSaving(true)
    try {
      if (current.type === 'contact') {
        await api.patch(`/api/contacts/${current.id}`, contactToPayload(contact, false))
      } else if (current.type === 'task') {
        await api.patch(`/api/tasks/${current.id}`, taskToPayload(task, false))
      } else {
        await api.patch(`/api/projects/${current.id}`, projectToPayload(project, false))
      }
      qc.invalidateQueries()
      advance()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const isLast = index + 1 >= queue.length

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <DialogContent className={current.type === 'contact' ? 'max-w-3xl' : 'max-w-xl'} hideClose>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-[var(--primary)]" />
              {meta.title}
            </DialogTitle>
            <span className="shrink-0 rounded-full bg-[var(--muted)] px-2.5 py-0.5 text-xs font-medium text-[var(--muted-foreground)]">
              {index + 1} of {queue.length}
            </span>
          </div>
          <DialogDescription>{meta.hint}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 px-1">
          {current.type === 'contact' && <ContactForm value={contact} onChange={setContact} />}
          {current.type === 'task' && <TaskForm value={task} onChange={setTask} />}
          {current.type === 'project' && <ProjectForm value={project} onChange={setProject} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={advance} disabled={saving}>
            Skip for now
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isLast ? 'Save & finish' : 'Save & next →'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
