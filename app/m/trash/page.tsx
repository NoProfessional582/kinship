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
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section, MEmpty, MList } from '@/components/mobile/bits'
import { api } from '@/lib/hooks/api'
import type { Trash } from '@/lib/api-types'
import { trashGroups } from '@/lib/trash-rows'
import type { TrashKind } from '@/lib/services/trash'

/**
 * Trash on a phone. Restore is the primary action and gets a real tap target;
 * emptying is behind a confirm, as on the desktop page, because it is the one
 * irreversible thing in the app.
 */
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

export default function MobileTrash() {
  const qc = useQueryClient()
  const [confirming, setConfirming] = React.useState(false)
  const { data } = useQuery({ queryKey: ['trash'], queryFn: () => api.get<Trash>('/api/trash') })

  const act = async (action: string, kind?: string, id?: string, message?: string) => {
    try {
      await api.post('/api/trash', { action, kind, id })
      qc.invalidateQueries()
      if (message) toast.success(message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not complete')
    }
  }

  const groups = trashGroups(data)

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="flex items-center gap-2 text-[1.4rem]">
          <Trash2 className="h-5 w-5 text-[var(--muted-foreground)]" /> Trash
        </h1>
        <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
          Deleted items stay here until you empty it. Nothing is removed on a timer.
        </p>
      </header>

      {(data?.total ?? 0) === 0 && <MEmpty>Nothing in the trash.</MEmpty>}

      {groups.map((g) => (
        <Section key={g.kind} title={g.label}>
          <MList>
            {g.rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 border-b border-[var(--border)] py-2 last:border-0"
              >
                <KindIcon
                  kind={g.kind}
                  className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                <button
                  onClick={() => act('restore', g.kind, r.id, 'Restored')}
                  className="kb-tap flex items-center justify-center rounded-[var(--radius-md)] text-[var(--muted-foreground)]"
                  aria-label={`Restore ${r.name}`}
                >
                  <Undo2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </MList>
        </Section>
      ))}

      {(data?.total ?? 0) > 0 && (
        <div className="pt-1">
          {confirming ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-[var(--destructive)]"
                onClick={() => {
                  act('empty', undefined, undefined, 'Trash emptied')
                  setConfirming(false)
                }}
              >
                Empty for good
              </Button>
            </div>
          ) : (
            <Button variant="ghost" className="w-full" onClick={() => setConfirming(true)}>
              <Trash2 className="h-4 w-4" /> Empty trash ({data?.total})
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
