'use client'
import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { MobileBoard } from '@/components/mobile/board'
import { MobileTaskSheet } from '@/components/mobile/task-sheet'
import { NewTaskDialog } from '@/components/board/new-task-dialog'
import { useBoard, useProjects } from '@/lib/hooks/api'

/**
 * The global board, scoped by project through the same /api/tasks query. The
 * open task is in the URL (`?task=`), as on the desktop board, so a search
 * result can open it.
 */
function MobileBoardInner() {
  const params = useSearchParams()
  const router = useRouter()
  const [projectId, setProjectId] = React.useState<string>('')
  const openTask = params.get('task')
  const setOpenTask = (id: string | null) =>
    router.replace(id ? `/m/board?task=${id}` : '/m/board', { scroll: false })
  const [creating, setCreating] = React.useState(false)

  const { data: board, isLoading } = useBoard(projectId || null)
  const { data: projects } = useProjects()

  return (
    <div className="flex flex-col gap-3">
      {/* The tab bar names the page on screen; the heading is for screen readers. */}
      <h1 className="sr-only">Board</h1>
      <div className="flex items-center gap-2">
        <Select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-10 min-w-0 flex-1"
          aria-label="Filter by project"
        >
          <option value="">All projects</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Button onClick={() => setCreating(true)} className="shrink-0">
          <Plus className="h-4 w-4" /> Task
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading board…
        </div>
      )}

      {board && (
        <MobileBoard
          columns={board.columns}
          tasks={board.tasks}
          projectId={projectId || null}
          onOpenTask={setOpenTask}
        />
      )}

      <MobileTaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
      {creating && (
        <NewTaskDialog
          open={creating}
          onOpenChange={setCreating}
          projectId={projectId || undefined}
        />
      )}
    </div>
  )
}

export default function MobileBoardPage() {
  return (
    <React.Suspense fallback={null}>
      <MobileBoardInner />
    </React.Suspense>
  )
}
