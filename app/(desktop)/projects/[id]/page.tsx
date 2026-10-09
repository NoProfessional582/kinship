'use client'
import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Plus, KanbanSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState } from '@/components/ui/misc'
import { Board } from '@/components/board/board'
import { TaskDialog } from '@/components/shared/task-dialog'
import { NewTaskDialog } from '@/components/board/new-task-dialog'
import { api, useBoard } from '@/lib/hooks/api'

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [openTask, setOpenTask] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<any>(`/api/projects/${id}`),
  })

  // The board is scoped by the project's real id, which the slug resolves to.
  const { data: board } = useBoard(project?.id ?? null)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading project…
      </div>
    )
  }
  if (!project) {
    return (
      <p className="py-16 text-center text-sm text-[var(--muted-foreground)]">Project not found.</p>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Same shape as the global board: rules run the full width, content sits
          on the shared measure. */}
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex w-full max-w-[var(--page-max)] flex-wrap items-center gap-3 px-6 py-3 lg:px-8">
          <Button variant="ghost" size="sm" onClick={() => router.push('/projects')}>
            <ArrowLeft className="h-3.5 w-3.5" /> Projects
          </Button>
          <div className="mr-auto flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: project.color ?? 'var(--primary)' }}
            />
            <h1 className="text-lg font-semibold">{project.name}</h1>
            <Badge>{project.status.toLowerCase().replace('_', ' ')}</Badge>
            {project.isDraft && (
              <Badge className="border-[var(--pending)] text-[var(--pending)]">needs details</Badge>
            )}
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New task
          </Button>
        </div>
      </header>

      {project.description && (
        <div className="border-b border-[var(--border)]">
          <p className="mx-auto w-full max-w-[var(--page-max)] px-6 py-2.5 text-sm lg:px-8 text-[var(--muted-foreground)]">
            {project.description}
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto h-full w-full max-w-[var(--page-max)] px-6 py-4 lg:px-8">
          {board && board.tasks.length === 0 && (
            <EmptyState
              icon={KanbanSquare}
              title="No tasks in this project yet"
              hint="Add one, or tag it from a note."
            />
          )}
          {board && board.tasks.length > 0 && (
            <Board
              columns={board.columns}
              tasks={board.tasks}
              projectId={project.id}
              groupBy="none"
              onOpenTask={(t) => setOpenTask(t.id)}
            />
          )}
        </div>
      </div>

      <TaskDialog taskId={openTask} onClose={() => setOpenTask(null)} />
      <NewTaskDialog open={creating} onOpenChange={setCreating} projectId={project.id} />
    </div>
  )
}
