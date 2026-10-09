'use client'
import * as React from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { KanbanSquare, Plus, Loader2 } from 'lucide-react'
import { Board, type GroupBy } from '@/components/board/board'
import { TaskDialog } from '@/components/shared/task-dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/misc'
import { useBoard } from '@/lib/hooks/api'
import { NewTaskDialog } from '@/components/board/new-task-dialog'

function BoardInner() {
  const params = useSearchParams()
  const router = useRouter()
  const [groupBy, setGroupBy] = React.useState<GroupBy>('none')
  const [creating, setCreating] = React.useState(false)
  const { data, isLoading } = useBoard(null)

  const openTaskId = params.get('task')
  const setOpenTask = (id: string | null) =>
    router.replace(id ? `/board?task=${id}` : '/board', { scroll: false })

  return (
    <div className="flex h-full flex-col">
      {/* The rule spans the window; the content inside it sits on the same
          measure as every other page, so the board is not the one screen that
          starts hard against the sidebar. */}
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex w-full max-w-[var(--page-max)] flex-wrap items-end gap-3 px-6 py-3 lg:px-8">
          <div className="mr-auto">
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <KanbanSquare className="h-4 w-4" /> Board
            </h1>
            <p className="text-xs text-[var(--muted-foreground)]">
              Drag cards between columns. Group by project to get swimlanes — dropping into one
              reassigns the task.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label>Group by</Label>
            <Select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="h-8 w-32 text-xs"
            >
              <option value="none">None</option>
              <option value="project">Project</option>
              <option value="assignee">Assignee</option>
            </Select>
          </div>

          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New task
          </Button>
        </div>
      </header>

      {/* Scrolling stays on the outer element so the columns can run past the
          measure when there are more of them than fit. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto h-full w-full max-w-[var(--page-max)] px-6 py-4 lg:px-8">
          {isLoading && (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading board…
            </div>
          )}
          {!isLoading && (data?.tasks ?? []).length === 0 && (
            <EmptyState
              icon={KanbanSquare}
              title="No tasks yet"
              hint="Create one here, or write [[Some task]] in a note and the board picks it up automatically."
            />
          )}
          {!isLoading && data && (data.tasks ?? []).length > 0 && (
            <Board
              columns={data.columns}
              tasks={data.tasks}
              projectId={null}
              groupBy={groupBy}
              onOpenTask={(t) => setOpenTask(t.id)}
            />
          )}
        </div>
      </div>

      <TaskDialog taskId={openTaskId} onClose={() => setOpenTask(null)} />
      <NewTaskDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

export default function BoardPage() {
  return (
    <React.Suspense fallback={null}>
      <BoardInner />
    </React.Suspense>
  )
}
