import type { Trash } from './api-types'
import type { TrashKind } from './services/trash'
import { entryTitle } from './utils'

/** One trashed record, whatever its kind, as the trash views list it. */
export interface TrashRow {
  id: string
  name: string
  /** Sent back with a purge so the server can catch a stale view. */
  deletedAt?: string
  avatarUrl?: string | null
}

export interface TrashGroup {
  kind: TrashKind
  label: string
  rows: TrashRow[]
}

/** The trash, grouped by kind, without the kinds that are empty. */
export function trashGroups(data: Trash | undefined): TrashGroup[] {
  // Every trashed row has a deletedAt; the type cannot say so.
  const at = (deletedAt: string | null) => deletedAt ?? undefined
  const groups: TrashGroup[] = [
    {
      kind: 'contact',
      label: 'People',
      rows: (data?.contacts ?? []).map((r) => ({
        id: r.id,
        name: r.displayName,
        deletedAt: at(r.deletedAt),
        avatarUrl: r.avatarUrl,
      })),
    },
    {
      kind: 'entry',
      label: 'Notes',
      rows: (data?.entries ?? []).map((r) => ({
        id: r.id,
        name: entryTitle(r),
        deletedAt: at(r.deletedAt),
      })),
    },
    {
      kind: 'task',
      label: 'Tasks',
      rows: (data?.tasks ?? []).map((r) => ({
        id: r.id,
        name: r.title,
        deletedAt: at(r.deletedAt),
      })),
    },
    {
      kind: 'project',
      label: 'Projects',
      rows: (data?.projects ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        deletedAt: at(r.deletedAt),
      })),
    },
  ]
  return groups.filter((g) => g.rows.length > 0)
}
