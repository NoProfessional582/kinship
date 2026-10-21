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
import { PageHeader } from '@/components/shared/page-header'
import { useBoard, useProjects } from '@/lib/hooks/api'
import { NewTaskDialog } from '@/components/board/new-task-dialog'

function BoardInner() {
  const params = useSearchParams()
  const router = useRouter()
  const [groupBy, setGroupBy] = React.useState<GroupBy>('none')
  const [creating, setCreating] = React.useState(false)

  // The project filter lives in the URL beside the open task, so a filtered
  // board survives a reload and opening a card does not clear it.
  const projectId = params.get('project') || null
  const openTaskId = params.get('task')
  const navigate = (next: { project?: string | null; task?: string | null }) => {
    const q = new URLSearchParams()
    const project = next.project !== undefined ? next.project : projectId
    const task = next.task !== undefined ? next.task : openTaskId
    if (project) q.set('project', project)
    if (task) q.set('task', task)
    const qs = q.toString()
    router.replace(qs ? `/board?${qs}` : '/board', { scroll: false })
  }
  const setOpenTask = (id: string | null) => navigate({ task: id })

  const { data, isLoading } = useBoard(projectId)
  const { data: projects } = useProjects()
  // Swimlanes by project mean nothing once the board shows a single project.
  const effectiveGroupBy: GroupBy = projectId && groupBy === 'project' ? 'none' : groupBy

  return (
    <div className="flex h-full flex-col">
      {/* The header sits on the same measure and at the same height as every
          other page's; only the columns below it scroll. */}
      <div className="mx-auto w-full max-w-[var(--page-max)] px-6 pt-8 lg:px-8">
        <PageHeader
          eyebrow="Tasks"
          title="Board"
          description="Drag cards between columns. Group by project to get swimlanes — dropping into one reassigns the task."
          actions={
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="board-project">Project</Label>
                <Select
                  id="board-project"
                  value={projectId ?? ''}
                  onChange={(e) => navigate({ project: e.target.value || null })}
                  className="h-8 w-44 text-xs"
                >
                  <option value="">All projects</option>
                  {(projects ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <Label>Group by</Label>
                <Select
                  value={effectiveGroupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                  className="h-8 w-32 text-xs"
                >
                  <option value="none">None</option>
                  <option value="project" disabled={!!projectId}>
                    Project
                  </option>
                  <option value="assignee">Assignee</option>
                </Select>
              </div>

              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" /> New task
              </Button>
            </>
          }
        />
      </div>

      {/* Scrolling stays on the outer element so the columns can run past the
          measure when there are more of them than fit. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto h-full w-full max-w-[var(--page-max)] px-6 pb-6 lg:px-8">
          {isLoading && (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading board…
            </div>
          )}
          {!isLoading && (data?.tasks ?? []).length === 0 && (
            <EmptyState
              icon={KanbanSquare}
              title={projectId ? 'No tasks in this project yet' : 'No tasks yet'}
              hint="Create one here, or write [[Some task]] in a note and the board picks it up automatically."
            />
          )}
          {!isLoading && data && (data.tasks ?? []).length > 0 && (
            <Board
              columns={data.columns}
              tasks={data.tasks}
              projectId={projectId}
              groupBy={effectiveGroupBy}
              onOpenTask={(t) => setOpenTask(t.id)}
            />
          )}
        </div>
      </div>

      <TaskDialog taskId={openTaskId} onClose={() => setOpenTask(null)} />
      <NewTaskDialog
        open={creating}
        onOpenChange={setCreating}
        projectId={projectId ?? undefined}
      />
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
