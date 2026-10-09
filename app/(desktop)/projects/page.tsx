'use client'
import * as React from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FolderKanban, Plus, Loader2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, Avatar, EmptyState } from '@/components/ui/misc'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  ProjectForm, blankProject, projectFromRecord, projectToPayload, type ProjectFormValue,
} from '@/components/entity-modal/project-form'
import { api, useProjects } from '@/lib/hooks/api'

/** The board's states, in the order work moves through them. */
const STAGES = [
  { key: 'TODO', label: 'Backlog' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'DONE', label: 'Done' },
] as const

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects()
  const [editing, setEditing] = React.useState<{ id: string | null } | null>(null)
  const [form, setForm] = React.useState<ProjectFormValue>(blankProject())
  const [saving, setSaving] = React.useState(false)
  const qc = useQueryClient()

  const list = projects ?? []
  const totalTasks = list.reduce((n: number, p: any) => n + (p.taskTotal ?? 0), 0)

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Give the project a name'); return }
    setSaving(true)
    try {
      const payload = projectToPayload(form, false)
      if (editing?.id) await api.patch(`/api/projects/${editing.id}`, payload)
      else await api.post('/api/projects', payload)
      qc.invalidateQueries()
      setEditing(null)
      toast.success(editing?.id ? 'Project updated' : 'Project created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[var(--page-max)] px-6 py-8 lg:px-8">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--primary)]">
            Active work
          </p>
          <h1 className="mt-1 text-[2.6rem] leading-[1.08]">Projects</h1>
          <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
            {list.length} project{list.length === 1 ? '' : 's'} connected to {totalTasks} task{totalTasks === 1 ? '' : 's'}.
          </p>
        </div>
        <Button onClick={() => { setForm(blankProject()); setEditing({ id: null }) }}>
          <Plus className="h-3.5 w-3.5" /> Add project
        </Button>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {!isLoading && list.length === 0 && (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          hint="Create one, or write [[Project name]] in a note and pick “Create project”."
        />
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
        {list.map((p: any) => {
          const color = p.color ?? 'var(--primary)'
          const total = p.taskTotal ?? 0
          const pct = total ? Math.round(((p.doneCount ?? 0) / total) * 100) : 0
          return (
            <Card key={p.id} className="group relative flex flex-col p-5 transition-shadow hover:[box-shadow:var(--shadow-lift)]">
              <div className="mb-3 flex items-start gap-3">
                <span className="mt-0.5 h-9 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--muted-foreground)]">
                    Project
                  </p>
                  {/* Stretched so the whole card opens the project, while the
                      edit button above it stays independently clickable. */}
                  <Link href={`/projects/${p.slug}`} className="block truncate text-[1.3rem] leading-tight after:absolute after:inset-0 after:content-['']">
                    <span className="display">{p.name}</span>
                  </Link>
                </div>
                <div className="relative z-10 flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => { setForm(projectFromRecord(p)); setEditing({ id: p.id }) }}
                    aria-label={`Edit ${p.name}`}
                    title="Edit project"
                    className="rounded p-1 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--foreground)] focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <p className="mb-4 line-clamp-2 min-h-[2.6em] text-[13px] leading-snug text-[var(--muted-foreground)]">
                {p.description || 'No description yet.'}
              </p>

              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-[var(--muted-foreground)]">
                  Progress
                </span>
                <span className="tabular text-xs font-medium">{pct}%</span>
              </div>
              <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
              </div>

              <div className="mb-4 grid grid-cols-4 gap-1.5">
                {STAGES.map((s) => (
                  <div key={s.key} className="rounded-[var(--radius-sm)] bg-[var(--muted)] px-1 py-2 text-center">
                    <p className="display text-[1.05rem] leading-none">{p.taskCounts?.[s.key] ?? 0}</p>
                    <p className="mt-1 text-[10px] leading-tight text-[var(--muted-foreground)]">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  {(p.people ?? []).length > 0 ? 'Linked people' : 'No one assigned yet'}
                </span>
                <div className="flex -space-x-2">
                  {(p.people ?? []).slice(0, 5).map((c: any) => (
                    <Avatar
                      key={c.id}
                      src={c.avatarUrl}
                      name={c.displayName}
                      size={24}
                      className="ring-2 ring-[var(--card)]"
                    />
                  ))}
                  {(p.people ?? []).length > 5 && (
                    <span className="z-10 inline-flex h-6 items-center rounded-full bg-[var(--muted)] px-1.5 text-[10px] text-[var(--muted-foreground)] ring-2 ring-[var(--card)]">
                      +{p.people.length - 5}
                    </span>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit project' : 'New project'}</DialogTitle>
          </DialogHeader>
          <ProjectForm value={form} onChange={setForm} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : editing?.id ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
