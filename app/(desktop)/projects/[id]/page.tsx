'use client'
import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Plus, KanbanSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState } from '@/components/ui/misc'
import { Board } from '@/components/board/board'
import { TaskDialog } from '@/components/shared/task-dialog'
import { NewTaskDialog } from '@/components/board/new-task-dialog'
import { MiniGraph } from '@/components/graph/mini-graph'
import { NotFound } from '@/components/shared/not-found'
import { PageHeader } from '@/components/shared/page-header'
import { api, useBoard } from '@/lib/hooks/api'
import type { ProjectDetail } from '@/lib/api-types'

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const [openTask, setOpenTask] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  const {
    data: project,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${id}`),
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
    return <NotFound error={error} what="Project" href="/projects" back="Projects" />
  }

  return (
    <div className="flex h-full flex-col">
      {/* Same shape as the global board: the header sits where every page's
          does, and only the columns below it scroll. */}
      <div className="mx-auto w-full max-w-[var(--page-max)] px-6 pt-8 lg:px-8">
        <PageHeader
          eyebrow={
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 align-top hover:underline"
            >
              <ArrowLeft className="h-3 w-3" /> Projects
            </Link>
          }
          title={
            <span className="inline-flex items-center gap-3 align-top">
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ background: project.color ?? 'var(--primary)' }}
              />
              {project.name}
            </span>
          }
          description={
            <span className="flex flex-wrap items-center gap-2">
              <Badge>{project.status.toLowerCase().replace('_', ' ')}</Badge>
              {project.isDraft && (
                <Badge className="border-[var(--pending)] text-[var(--pending)]">
                  needs details
                </Badge>
              )}
              {project.description}
            </span>
          }
          actions={
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New task
            </Button>
          }
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto h-full w-full max-w-[var(--page-max)] px-6 pb-6 lg:px-8">
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
        {/* Below the board, which fills the view: scrolled to, and only then drawn. Not
            before the board is in, or it would be in view for a moment and load at once. */}
        {board && !project.isDraft && (
          <div className="mx-auto w-full max-w-[var(--page-max)] px-6 pb-6 lg:px-8">
            <MiniGraph focusId={`project:${project.id}`} name={project.name} level={2} />
          </div>
        )}
      </div>

      <TaskDialog taskId={openTask} onClose={() => setOpenTask(null)} />
      <NewTaskDialog open={creating} onOpenChange={setCreating} projectId={project.id} />
    </div>
  )
}
