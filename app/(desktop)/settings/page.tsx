'use client'
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  SlidersHorizontal,
  Globe,
  CloudSun,
  Type,
  User,
  KanbanSquare,
  Plus,
  X,
  Check,
  DatabaseBackup,
  Download,
  Upload,
  AlertTriangle,
} from 'lucide-react'
import { Card } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { api } from '@/lib/hooks/api'
import { useSaveSettings, useSettings } from '@/lib/hooks/settings'
import { allTimezones, browserTimezone, formatInstant, zoneOffsetLabel } from '@/lib/format'
import { CADENCE_LABEL } from '@/lib/cadence'
import { SCHEMA_MISMATCH, type ImportSummary } from '@/lib/archive-format'
import { cn } from '@/lib/utils'

const COLUMN_COLORS = ['#bd5b3f', '#ba8a42', '#697760', '#4a6572', '#8c5a4a', '#7a6a86', '#74746c']
const STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'ARCHIVED']

export default function SettingsPage() {
  const settings = useSettings()
  const save = useSaveSettings()

  const commit = async (patch: any, message: string) => {
    try {
      await save.mutateAsync(patch)
      toast.success(message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  return (
    <div className="mx-auto max-w-[var(--page-max)] px-6 py-8 lg:px-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl">
          <SlidersHorizontal className="h-5 w-5 text-[var(--primary)]" /> Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Everything here is stored locally with your data. Nothing is sent anywhere except the
          weather lookup, which is off unless you turn it on.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        <IdentityPanel settings={settings} commit={commit} />
        <DisplayPanel settings={settings} commit={commit} />
        <TimezonePanel settings={settings} commit={commit} />
        <WeatherPanel settings={settings} commit={commit} />
        <ColumnsPanel />
        <DataPanel />
      </div>
    </div>
  )
}

function Panel({
  icon: Icon,
  title,
  hint,
  hue = 'var(--hue-1)',
  children,
}: {
  icon: any
  title: string
  hint?: string
  hue?: string
  children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-center gap-2 px-5 py-3"
        style={{ background: `color-mix(in oklch, ${hue} 10%, transparent)` }}
      >
        <Icon className="h-4 w-4" style={{ color: hue }} />
        <h2 className="flex-1 text-base" style={{ color: hue }}>
          {title}
        </h2>
      </div>
      <div className="flex flex-col gap-3.5 p-5">
        {hint && <p className="-mt-1 text-xs text-[var(--muted-foreground)]">{hint}</p>}
        {children}
      </div>
    </Card>
  )
}

function IdentityPanel({ settings, commit }: any) {
  const [v, setV] = React.useState({ userName: '', appTitle: '', tagline: '' })
  React.useEffect(
    () =>
      setV({
        userName: settings.userName,
        appTitle: settings.appTitle,
        tagline: settings.tagline,
      }),
    [settings.userName, settings.appTitle, settings.tagline],
  )

  return (
    <Panel
      icon={User}
      title="Identity"
      hint="Used for the greeting on the dashboard and the name in the sidebar."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label>Your name</Label>
          <Input value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>App title</Label>
          <Input value={v.appTitle} onChange={(e) => setV({ ...v, appTitle: e.target.value })} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label>Tagline</Label>
        <Input value={v.tagline} onChange={(e) => setV({ ...v, tagline: e.target.value })} />
      </div>
      <Button className="w-fit" onClick={() => commit(v, 'Identity saved')}>
        Save identity
      </Button>
    </Panel>
  )
}

function DisplayPanel({ settings, commit }: any) {
  const scales = [
    { v: 0.9, label: 'Compact' },
    { v: 1, label: 'Default' },
    { v: 1.12, label: 'Comfortable' },
    { v: 1.25, label: 'Large' },
  ]
  return (
    <Panel
      icon={Type}
      title="Display"
      hue="var(--hue-3)"
      hint="Type size applies everywhere immediately."
    >
      <div className="flex flex-col gap-1.5">
        <Label>Text size</Label>
        <div className="flex flex-wrap gap-2">
          {scales.map((s) => (
            <button
              key={s.v}
              onClick={() => commit({ fontScale: s.v }, `Text size: ${s.label.toLowerCase()}`)}
              className={cn(
                'rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm transition-colors',
                Math.abs(settings.fontScale - s.v) < 0.01
                  ? 'border-[var(--primary)] bg-[var(--accent)] text-[var(--accent-foreground)]'
                  : 'border-[var(--border)] hover:bg-[var(--muted)]',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label>Week starts on</Label>
          <Select
            value={settings.calendarWeekStart}
            onChange={(e) => commit({ calendarWeekStart: e.target.value }, 'Week start saved')}
          >
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Default check-in cadence</Label>
          <Select
            value={settings.defaultCadence}
            onChange={(e) => commit({ defaultCadence: e.target.value }, 'Default cadence saved')}
          >
            {Object.entries(CADENCE_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Panel>
  )
}

function TimezonePanel({ settings, commit }: any) {
  const [filter, setFilter] = React.useState('')
  const [detected, setDetected] = React.useState('UTC')
  const [now, setNow] = React.useState<Date | null>(null)
  // The zone list and each zone's offset come from the runtime's time zone data,
  // which the server and the browser need not share (they disagreed on Morocco's
  // offset, a hydration error), so like `detected` and `now` they are built in
  // the browser only.
  const [allZones, setAllZones] = React.useState<string[]>([])
  React.useEffect(() => setDetected(browserTimezone()), [])
  React.useEffect(() => setAllZones(allTimezones()), [])
  React.useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const effective = settings.timezone ?? detected
  const zones = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (q ? allZones.filter((z) => z.toLowerCase().includes(q)) : allZones).slice(0, 80)
  }, [allZones, filter])

  return (
    <Panel
      icon={Globe}
      title="Timezone"
      hue="var(--hue-2)"
      hint="Everything is stored in UTC; this only controls how times are shown."
    >
      <div className="rounded-[var(--radius-sm)] bg-[var(--muted)] px-3 py-2">
        <p className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
          Right now in {effective}
        </p>
        <p className="font-mono text-lg tabular-nums">
          {now ? formatInstant(now, 'EEE d MMM, HH:mm:ss', effective) : '—'}
        </p>
      </div>
      <button
        onClick={() => commit({ timezone: null }, 'Following this browser')}
        className={cn(
          'flex items-center gap-2 rounded-[var(--radius-sm)] border p-2.5 text-left text-sm transition-colors',
          !settings.timezone
            ? 'border-[var(--primary)] bg-[var(--accent)]'
            : 'border-[var(--border)] hover:bg-[var(--muted)]',
        )}
      >
        <span className="flex-1">
          Follow this browser <span className="text-[var(--muted-foreground)]">({detected})</span>
        </span>
        {!settings.timezone && <Check className="h-4 w-4 text-[var(--primary)]" />}
      </button>
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search zones… e.g. Denver"
      />
      <div className="max-h-48 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
        {zones.map((z) => (
          <button
            key={z}
            onClick={() => commit({ timezone: z }, `Times shown in ${z}`)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
              settings.timezone === z ? 'bg-[var(--accent)]' : 'hover:bg-[var(--muted)]',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{z}</span>
            <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
              {zoneOffsetLabel(z)}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  )
}

function WeatherPanel({ settings, commit }: any) {
  const [location, setLocation] = React.useState('')
  React.useEffect(() => setLocation(settings.weatherLocation), [settings.weatherLocation])

  return (
    <Panel
      icon={CloudSun}
      title="Weather"
      hue="var(--hue-4)"
      hint="The only feature that reaches outside this machine. Looked up through open-meteo, proxied by the server so your browser never contacts them directly."
    >
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={settings.weatherEnabled}
          onChange={(e) =>
            commit(
              { weatherEnabled: e.target.checked },
              e.target.checked ? 'Weather on' : 'Weather off',
            )
          }
        />
        Show weather on the dashboard
      </label>
      {settings.weatherEnabled && (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="flex flex-col gap-1">
            <Label>Location</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, region"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Units</Label>
            <Select
              value={settings.weatherUnit}
              onChange={(e) => commit({ weatherUnit: e.target.value }, 'Units saved')}
            >
              <option value="fahrenheit">°F</option>
              <option value="celsius">°C</option>
            </Select>
          </div>
          <Button
            variant="outline"
            className="self-end"
            onClick={() => commit({ weatherLocation: location }, 'Location saved')}
          >
            Save
          </Button>
        </div>
      )}
    </Panel>
  )
}

/** Board columns are yours to define: name, colour, and the status they confer. */
function ColumnsPanel() {
  const qc = useQueryClient()
  const { data: columns } = useQuery({
    queryKey: ['columns'],
    queryFn: () => api.get<any[]>('/api/columns'),
  })
  const [adding, setAdding] = React.useState(false)
  const [draft, setDraft] = React.useState({ name: '', color: COLUMN_COLORS[0], status: 'TODO' })

  const refresh = () => qc.invalidateQueries()

  const add = async () => {
    if (!draft.name.trim()) {
      toast.error('Give the column a name')
      return
    }
    try {
      await api.post('/api/columns', draft)
      setAdding(false)
      setDraft({ name: '', color: COLUMN_COLORS[0], status: 'TODO' })
      refresh()
      toast.success('Column added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add')
    }
  }

  const patch = async (id: string, body: any) => {
    try {
      await api.patch(`/api/columns/${id}`, body)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const remove = async (id: string) => {
    try {
      await api.del(`/api/columns/${id}`)
      refresh()
      toast.success('Column removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the column')
    }
  }

  const move = async (index: number, delta: number) => {
    if (!columns) return
    const next = [...columns]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    try {
      await api.patch('/api/columns/reorder', { columnIds: next.map((c) => c.id) })
      refresh()
    } catch {
      toast.error('Could not reorder')
    }
  }

  return (
    <Panel
      icon={KanbanSquare}
      title="Board columns"
      hue="var(--hue-5)"
      hint="The column a card sits in is what sets its status, so these are your workflow states."
    >
      <div className="flex flex-col gap-2">
        {(columns ?? []).map((c: any, i: number) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] p-2"
          >
            <div className="flex flex-col">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="px-1 text-[10px] leading-none text-[var(--muted-foreground)] disabled:opacity-25"
                aria-label="Move up"
              >
                ▲
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === (columns?.length ?? 0) - 1}
                className="px-1 text-[10px] leading-none text-[var(--muted-foreground)] disabled:opacity-25"
                aria-label="Move down"
              >
                ▼
              </button>
            </div>
            <Input
              defaultValue={c.name}
              onBlur={(e) => e.target.value !== c.name && patch(c.id, { name: e.target.value })}
              className="h-8 w-36 text-sm"
            />
            <Select
              defaultValue={c.status}
              onChange={(e) => patch(c.id, { status: e.target.value })}
              className="h-8 w-36 text-xs"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </Select>
            <div className="flex gap-1">
              {COLUMN_COLORS.map((col) => (
                <button
                  key={col}
                  onClick={() => patch(c.id, { color: col })}
                  aria-label={`Colour ${col}`}
                  className={cn(
                    'h-5 w-5 rounded-full border-2 transition-transform',
                    c.color === col ? 'scale-110 border-[var(--foreground)]' : 'border-transparent',
                  )}
                  style={{ background: col }}
                />
              ))}
            </div>
            <span className="flex-1" />
            <button
              onClick={() => remove(c.id)}
              aria-label="Remove column"
              className="rounded p-1 text-[var(--muted-foreground)] transition hover:text-[var(--destructive)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-sm)] bg-[var(--muted)] p-2.5">
          <div className="flex flex-col gap-1">
            <Label>Name</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-8 w-40 text-sm"
              placeholder="Waiting on"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Status</Label>
            <Select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              className="h-8 w-36 text-xs"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" onClick={add}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--muted-foreground)] transition hover:text-[var(--primary)]"
        >
          <Plus className="h-3.5 w-3.5" /> Add column
        </button>
      )}
    </Panel>
  )
}

/**
 * Moving the app to another machine.
 *
 * An archive is one JSON file holding every row and every avatar — the photos
 * matter, because they live in a Docker volume rather than the database, and a
 * database-only move leaves every dossier picture behind.
 *
 * Import replaces this database with the archive's contents. There is no merge:
 * ids are preserved so that every mention, ref and edge still points at what it
 * pointed at, and honouring that while blending two databases is not a thing
 * that can be done safely.
 */
function DataPanel() {
  const qc = useQueryClient()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<ImportSummary | null>(null)

  const armed = !!file && confirm.trim().toLowerCase() === 'replace' && !busy
  // The one failure worth offering a way past: both sides hold the same data,
  // they just disagree about the schema it was written under.
  const forceable = failure?.startsWith(SCHEMA_MISMATCH) ?? false

  const runImport = async (force: boolean) => {
    if (!file) return
    setBusy(true)
    setFailure(null)
    setDone(null)
    try {
      // The File goes to fetch as the body rather than being read into a string
      // first. An archive carrying a few hundred avatars is large, and there is
      // no reason for the tab to hold a second copy of it in memory.
      const res = await fetch(`/api/import?confirm=replace${force ? '&force=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: file,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Import failed (${res.status})`)

      setDone(body as ImportSummary)
      toast.success('Archive restored — reloading')
      // Every cache in the app now describes rows that no longer exist, and so
      // do the title, the type scale and the timezone. Reloading is cheaper and
      // more honest than invalidating them one at a time.
      qc.clear()
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      icon={DatabaseBackup}
      title="Data"
      hue="var(--hue-6)"
      hint="One file holds everything: every contact, entry, task and tag, plus the avatar images. Use it to move this app to another machine, or to keep a backup."
    >
      <div className="flex flex-col gap-1.5">
        <Label>Export</Label>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* A plain link, not a fetch: the browser streams it straight to disk
              and names it from the Content-Disposition, so a large archive never
              passes through this tab's memory. */}
          <Button asChild variant="outline">
            <a href="/api/export" download>
              <Download className="h-4 w-4" /> Download archive
            </a>
          </Button>
          <span className="text-xs text-[var(--muted-foreground)]">
            Readable JSON. Keep it somewhere safe — it is all of your data in one file.
          </span>
        </div>
      </div>

      <div className="h-px bg-[var(--border)]" />

      <div className="flex flex-col gap-2">
        <Label>Import</Label>
        <p className="text-xs text-[var(--muted-foreground)]">
          Restores an archive over this database. Everything currently here is deleted first — all
          of it, not just the rows the archive replaces. Do this on the new machine, not the old
          one.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setFailure(null)
              setDone(null)
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> Choose archive
          </Button>
          <span className="text-xs text-[var(--muted-foreground)]">
            {file ? `${file.name} — ${(file.size / 1024 / 1024).toFixed(2)} MB` : 'No file chosen'}
          </span>
        </div>

        {file && !done && (
          <div className="flex flex-wrap items-end gap-2.5 rounded-[var(--radius-sm)] border border-[var(--destructive)]/40 bg-[var(--destructive)]/5 p-3">
            <div className="flex flex-col gap-1">
              <Label>
                Type <span className="font-mono">replace</span> to confirm
              </Label>
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-8 w-40 text-sm"
                placeholder="replace"
                autoComplete="off"
              />
            </div>
            <Button variant="destructive" disabled={!armed} onClick={() => runImport(false)}>
              {busy ? 'Restoring…' : 'Replace everything'}
            </Button>
          </div>
        )}

        {failure && (
          <div className="flex flex-col items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--destructive)]/40 p-3">
            <p className="flex items-start gap-2 text-sm text-[var(--destructive)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {failure}
            </p>
            {forceable && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => runImport(true)}>
                Import anyway
              </Button>
            )}
          </div>
        )}

        {done && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
            <p className="flex items-center gap-2">
              <Check className="h-4 w-4 text-[var(--primary)]" />
              Restored {Object.values(done.counts).reduce((a, b) => a + b, 0)} rows
              {done.uploads > 0 && ` and ${done.uploads} image${done.uploads === 1 ? '' : 's'}`}.
              Reloading…
            </p>
          </div>
        )}
      </div>
    </Panel>
  )
}
