'use client'
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  TaskForm,
  blankTask,
  taskToPayload,
  type TaskFormValue,
} from '@/components/entity-modal/task-form'
import { api } from '@/lib/hooks/api'

export function NewTaskDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  projectId?: string
}) {
  const [form, setForm] = React.useState<TaskFormValue>(() => ({
    ...blankTask(),
    projectId: projectId ?? '',
  }))
  const [saving, setSaving] = React.useState(false)
  const qc = useQueryClient()

  const [source, setSource] = React.useState({ open, projectId })
  if (source.open !== open || source.projectId !== projectId) {
    setSource({ open, projectId })
    if (open) setForm({ ...blankTask(), projectId: projectId ?? '' })
  }

  const save = async () => {
    if (!form.title.trim()) {
      toast.error('Give the task a title')
      return
    }
    setSaving(true)
    try {
      await api.post('/api/tasks', taskToPayload(form, false))
      qc.invalidateQueries()
      onOpenChange(false)
      toast.success('Task created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <TaskForm value={form} onChange={setForm} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
