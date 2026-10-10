'use client'
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Trash2,
  Undo2,
  Users,
  NotebookPen,
  SquareCheck,
  FolderKanban,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react'
import { Card, Avatar, EmptyState } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/hooks/api'
import { useTimezone } from '@/lib/hooks/settings'
import type { Trash } from '@/lib/api-types'
import { trashGroups } from '@/lib/trash-rows'
import type { TrashKind } from '@/lib/services/trash'

const KIND_ICON: Record<TrashKind, LucideIcon> = {
  contact: Users,
  entry: NotebookPen,
  task: SquareCheck,
  project: FolderKanban,
}

function KindIcon({ kind, className }: { kind: TrashKind; className?: string }) {
  const Icon = KIND_ICON[kind]
  return <Icon className={className} />
}

export default function TrashPage() {
  const qc = useQueryClient()
  const { fmt } = useTimezone()
  const [confirming, setConfirming] = React.useState(false)

  const { data } = useQuery({ queryKey: ['trash'], queryFn: () => api.get<Trash>('/api/trash') })

  /**
   * `deletedAt` is sent with a purge so the server can tell that this view is
   * still current. If the row was restored and re-trashed in another tab the
   * timestamp has moved, and the purge is refused rather than destroying a row
   * on the strength of a stale list.
   */
  const act = async (
    action: string,
    kind?: string,
    id?: string,
    message?: string,
    deletedAt?: string,
  ) => {
    try {
      await api.post('/api/trash', { action, kind, id, deletedAt })
      qc.invalidateQueries()
      if (message) toast.success(message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not complete')
    }
  }

  const groups = trashGroups(data)

  return (
    <div className="mx-auto max-w-[var(--page-max)] px-6 py-8 lg:px-8">
      <header className="mb-5 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="flex items-center gap-2.5 text-2xl">
            <Trash2 className="h-5 w-5 text-[var(--muted-foreground)]" /> Trash
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Deleted items are kept here until you empty it. Nothing is removed on a timer.
          </p>
        </div>
        {(data?.total ?? 0) > 0 &&
          (confirming ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  act('empty', undefined, undefined, 'Trash emptied')
                  setConfirming(false)
                }}
              >
                <AlertTriangle className="h-3.5 w-3.5" /> Permanently delete {data?.total}
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              Empty trash
            </Button>
          ))}
      </header>

      {(data?.total ?? 0) === 0 && (
        <EmptyState
          icon={Trash2}
          title="Nothing deleted"
          hint="Anything you remove lands here first, so a misclick is always recoverable."
        />
      )}

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <Card key={g.kind} className="overflow-hidden">
            <div className="flex items-center gap-2 bg-[var(--muted)] px-4 py-2.5">
              <KindIcon kind={g.kind} className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {g.label} ({g.rows.length})
              </h2>
            </div>
            <div className="flex flex-col">
              {g.rows.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-2.5 last:border-0"
                >
                  {g.kind === 'contact' && <Avatar src={r.avatarUrl} name={r.name} size={26} />}
                  <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--muted-foreground)]">
                    {fmt(r.deletedAt, 'MMM d, HH:mm')}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => act('restore', g.kind, r.id, `${r.name} restored`)}
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Restore
                  </Button>
                  <button
                    onClick={() => act('purge', g.kind, r.id, 'Permanently deleted', r.deletedAt)}
                    className="rounded p-1 text-[var(--muted-foreground)] transition hover:text-[var(--destructive)]"
                    title="Delete permanently"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
