'use client'
import * as React from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { MobileBoard } from '@/components/mobile/board'
import { MobileTaskSheet } from '@/components/mobile/task-sheet'
import { NewTaskDialog } from '@/components/board/new-task-dialog'
import { useBoard, useProjects } from '@/lib/hooks/api'

/** The global board, scoped by project through the same /api/tasks query. */
export default function MobileBoardPage() {
  const [projectId, setProjectId] = React.useState<string>('')
  const [openTask, setOpenTask] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  const { data: board, isLoading } = useBoard(projectId || null)
  const { data: projects } = useProjects()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-10 min-w-0 flex-1"
          aria-label="Filter by project"
        >
          <option value="">All projects</option>
          {(projects ?? []).map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
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
