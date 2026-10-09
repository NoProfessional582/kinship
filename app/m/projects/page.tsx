'use client'
import * as React from 'react'
import { Loader2, FolderKanban } from 'lucide-react'
import { MEmpty, MList, MRow, MTile } from '@/components/mobile/bits'
import { useProjects } from '@/lib/hooks/api'
import { m } from '@/lib/mobile/href'

/**
 * Projects, with the open/done count as the row's meta. The desktop page
 * spreads four status stat cells and a linked-people footer across a card;
 * on a phone that is four numbers nobody reads, so the row carries the one
 * number that says whether the project is live.
 */
export default function MobileProjects() {
  const { data: projects, isLoading } = useProjects()

  return (
    <div className="flex flex-col gap-3">
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {!isLoading && (projects?.length ?? 0) === 0 && <MEmpty>No projects yet.</MEmpty>}

      {(projects?.length ?? 0) > 0 && (
        <MTile>
          <MList>
            {projects!.map((p: any) => {
              const tasks = p.tasks ?? []
              const done = tasks.filter((t: any) => t.status === 'DONE').length
              return (
                <MRow
                  key={p.id}
                  href={m(`/projects/${p.slug}`)}
                  lead={
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)]"
                      style={{
                        background: `color-mix(in oklch, ${p.color || 'var(--hue-5)'} 18%, transparent)`,
                      }}
                    >
                      <FolderKanban
                        className="h-4 w-4"
                        style={{ color: p.color || 'var(--hue-5)' }}
                      />
                    </span>
                  }
                  title={p.name}
                  sub={p.status ? String(p.status).toLowerCase().replace(/_/g, ' ') : undefined}
                  meta={tasks.length ? `${done}/${tasks.length}` : undefined}
                  chevron
                />
              )
            })}
          </MList>
        </MTile>
      )}
    </div>
  )
}
