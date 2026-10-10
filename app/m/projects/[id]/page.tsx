'use client'
import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/misc'
import { MobileBoard } from '@/components/mobile/board'
import { MobileTaskSheet } from '@/components/mobile/task-sheet'
import { NewTaskDialog } from '@/components/board/new-task-dialog'
import { api, useBoard } from '@/lib/hooks/api'
import { m } from '@/lib/mobile/href'
import type { ProjectDetail } from '@/lib/api-types'

export default function MobileProject() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [openTask, setOpenTask] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  const { data: project, isLoading } = useQuery({
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
    return (
      <p className="py-16 text-center text-sm text-[var(--muted-foreground)]">Project not found.</p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => router.push(m('/projects'))}
        className="kb-tap -ml-1 flex items-center gap-1.5 self-start text-xs text-[var(--muted-foreground)]"
      >
        <ArrowLeft className="h-4 w-4" /> Projects
      </button>

      <header>
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: project.color ?? 'var(--primary)' }}
          />
          <h1 className="min-w-0 flex-1 truncate text-[1.35rem]">{project.name}</h1>
          <Badge>{String(project.status).toLowerCase().replace(/_/g, ' ')}</Badge>
        </div>
        {project.description && (
          <p className="mt-1.5 text-[13px] text-[var(--muted-foreground)]">{project.description}</p>
        )}
      </header>

      <Button onClick={() => setCreating(true)} variant="ghost" className="w-full">
        <Plus className="h-4 w-4" /> New task
      </Button>

      {board && (
        <MobileBoard
          columns={board.columns}
          tasks={board.tasks}
          projectId={project.id}
          onOpenTask={setOpenTask}
        />
      )}

      <MobileTaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
      {creating && (
        <NewTaskDialog open={creating} onOpenChange={setCreating} projectId={project.id} />
      )}
    </div>
  )
}
