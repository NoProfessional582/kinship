'use client'
import * as React from 'react'
import { Loader2, Trash2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TaskView } from '@/components/shared/task-view'
import { TaskForm } from '@/components/entity-modal/task-form'
import { notFoundText } from '@/components/shared/not-found'
import { useTaskDetail } from '@/lib/hooks/task-detail'
import {
  MSheet,
  MSheetContent,
  MSheetTitle,
  MSheetBody,
  MSheetFooter,
} from '@/components/mobile/sheet'

/**
 * The task detail view on a phone. Same hook as the desktop `TaskDialog` — the
 * view/edit mode, the drill-into-subtask stack, the save and the delete are all
 * `useTaskDetail`; only the container differs.
 */
export function MobileTaskSheet({
  taskId,
  onClose,
}: {
  taskId: string | null
  onClose: () => void
}) {
  const {
    data,
    entries,
    isLoading,
    error,
    mode,
    setMode,
    form,
    setForm,
    saving,
    save,
    remove,
    startEdit,
    openTask,
  } = useTaskDetail(taskId, onClose)
  const missing = notFoundText(error, 'Task')

  return (
    <MSheet
      open={Boolean(taskId)}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <MSheetContent tall hideClose>
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : !data ? (
          <>
            <MSheetBody className="flex flex-col items-center gap-2 pt-6 text-center">
              <MSheetTitle className="text-base font-semibold">{missing.title}</MSheetTitle>
              <p className="max-w-xs text-sm text-[var(--muted-foreground)]">{missing.hint}</p>
            </MSheetBody>
            <MSheetFooter>
              <Button variant="ghost" className="w-full" onClick={onClose}>
                Close
              </Button>
            </MSheetFooter>
          </>
        ) : (
          <>
            <MSheetTitle className="sr-only">{data.title}</MSheetTitle>
            <MSheetBody className="pt-2">
              {mode === 'view' ? (
                <TaskView task={data} entries={entries} onOpenTask={openTask} />
              ) : form ? (
                <div className="flex flex-col gap-4">
                  <h2 className="text-base font-semibold">Edit task</h2>
                  <TaskForm value={form} onChange={setForm} />
                </div>
              ) : null}
            </MSheetBody>
            <MSheetFooter>
              <Button variant="ghost" size="icon" onClick={remove} title="Delete task">
                <Trash2 className="h-4 w-4 text-[var(--destructive)]" />
              </Button>
              <span className="flex-1" />
              {mode === 'view' ? (
                <Button onClick={startEdit}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => setMode('view')} disabled={saving}>
                    Cancel
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </>
              )}
            </MSheetFooter>
          </>
        )}
      </MSheetContent>
    </MSheet>
  )
}
