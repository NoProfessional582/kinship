'use client'
import * as React from 'react'
import { Loader2, Trash2, Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TaskView } from '@/components/shared/task-view'
import { TaskForm } from '@/components/entity-modal/task-form'
import { notFoundText } from '@/components/shared/not-found'
import { useTaskDetail } from '@/lib/hooks/task-detail'

/**
 * The single task detail view. Opened from board cards, calendar events, the
 * command palette and any `?task=` deep link, so there is one place to change.
 *
 * It opens read-only. Landing straight in the editor meant every glance at a
 * card put you in a form built for entering values rather than reading them;
 * `mode` keeps both on one surface so Edit does not teleport you somewhere new.
 *
 * The behaviour lives in `useTaskDetail`; this file is the desktop container
 * for it. The mobile GUI renders the same hook inside a bottom sheet.
 */
export function TaskDialog({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
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
    <Dialog
      open={Boolean(taskId)}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-2xl gap-0 p-0">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : !data ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center">
            <DialogTitle className="text-base font-semibold">{missing.title}</DialogTitle>
            <p className="max-w-xs text-sm text-[var(--muted-foreground)]">{missing.hint}</p>
          </div>
        ) : (
          <>
            {/* The accessible name has to exist in both modes; the view renders
                its own visible heading, so this one is for screen readers. */}
            <DialogTitle className="sr-only">{data.title}</DialogTitle>

            <div className="max-h-[70vh] overflow-y-auto px-6 pb-5 pt-6">
              {mode === 'view' ? (
                <TaskView task={data} entries={entries} onOpenTask={openTask} />
              ) : form ? (
                <div className="flex flex-col gap-4">
                  <h2 className="text-base font-semibold">Edit task</h2>
                  <TaskForm value={form} onChange={setForm} />
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--border)] px-6 py-3">
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
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
