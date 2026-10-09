'use client'
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  taskFromRecord,
  taskToPayload,
  type TaskFormValue,
} from '@/components/entity-modal/task-form'
import { api } from '@/lib/hooks/api'

/**
 * Everything the task detail view does that is not layout: the record, its
 * entries, view-vs-edit mode, the drill-down stack and the save and delete
 * paths.
 *
 * It lives here because the desktop and mobile GUIs disagree only about the
 * container — a centred dialog against a bottom sheet — and agree about all of
 * this. Leaving it inside `TaskDialog` would have meant the mobile sheet
 * re-implementing the mode and drill semantics, which is exactly the kind of
 * divergence that typechecks fine and then behaves differently on one surface.
 */
export function useTaskDetail(taskId: string | null, onClose: () => void) {
  const qc = useQueryClient()
  const [mode, setMode] = React.useState<'view' | 'edit'>('view')
  const [form, setForm] = React.useState<TaskFormValue | null>(null)
  const [saving, setSaving] = React.useState(false)

  // Drilling into a subtask swaps what the view shows without touching the
  // URL, which still points at the task that was opened — so closing and
  // reloading lands you back where you started rather than three levels deep.
  const [drill, setDrill] = React.useState<string | null>(null)
  const activeId = drill ?? taskId

  const [sourceId, setSourceId] = React.useState(taskId)
  if (sourceId !== taskId) {
    setSourceId(taskId)
    setDrill(null)
    setMode('view')
    setForm(null)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['task', activeId],
    queryFn: () => api.get<any>(`/api/tasks/${activeId}`),
    enabled: Boolean(activeId),
  })

  const { data: entries } = useQuery({
    queryKey: ['task-entries', activeId],
    queryFn: () => api.get<any[]>(`/api/entries?taskId=${activeId}`),
    enabled: Boolean(activeId),
  })

  // Entering edit mode seeds the form from the current record in startEdit.
  const save = async () => {
    if (!form || !activeId) return
    setSaving(true)
    try {
      await api.patch(`/api/tasks/${activeId}`, taskToPayload(form, false))
      toast.success('Saved')
      qc.invalidateQueries()
      setMode('view')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!activeId) return
    try {
      await api.del(`/api/tasks/${activeId}`)
      toast.success('Task deleted')
      qc.invalidateQueries()
      if (drill) setDrill(null)
      else onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  const startEdit = () => {
    if (data) setForm(taskFromRecord(data))
    setMode('edit')
  }

  const openTask = (id: string) => {
    setDrill(id)
    setMode('view')
  }

  return {
    data,
    entries,
    isLoading,
    mode,
    setMode,
    form,
    setForm,
    saving,
    save,
    remove,
    startEdit,
    openTask,
  }
}
