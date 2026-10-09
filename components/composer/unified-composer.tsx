'use client'
import * as React from 'react'
import { ArrowDownLeft, ArrowUpRight, Send, X, ArrowRight } from 'lucide-react'
import { RichEditor } from '@/components/editor/editor'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ChipsInput } from '@/components/ui/chips'
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/misc'
import { ENTRY_KINDS } from '@/components/entity-modal/entry-form'
import { useComposer } from '@/lib/hooks/composer'
import { useSettings } from '@/lib/hooks/settings'
import { useModifierKey } from '@/lib/hooks/platform'
import { cn } from '@/lib/utils'

/**
 * The one capture surface: the dark card the dashboard opens with, rendered
 * identically anywhere it appears. It used to have a second, light "panel"
 * skin for the notes page, which is how the same control ended up looking like
 * two different features depending on which page you reached it from.
 *
 * The behaviour lives in `useComposer` — the draft store, the zone-aware date,
 * the kind flags and the save. This file is the desktop card around it; the
 * mobile GUI builds a different surface on the same hook.
 */
export function UnifiedComposer({
  onSaved, prompt, hint,
}: {
  onSaved?: () => void
  prompt?: string
  hint?: string
}) {
  const settings = useSettings()
  const mod = useModifierKey()

  const {
    open, setOpen, restored, hasDraft, setHasDraft,
    kind, setKind, title, setTitle, occurredAt, setOccurredAt, dateTouched,
    direction, setDirection, durationMin, setDurationMin,
    location, setLocation, followUpAt, setFollowUpAt,
    projectId, setProjectId, tags, setTags,
    saving, setBodyRev, active, onReady, reset, save,
    projects,
  } = useComposer(onSaved)

  // The dark card needs its own field skin; repeating it per input was how the
  // date picker ended up light-on-light.
  const heroField = 'border-[var(--hero-line)] bg-[var(--hero-soft)] text-[var(--hero-ink)]'

  const form = (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {ENTRY_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              kind === k.value
                ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'border-[var(--hero-line)] text-[var(--hero-muted)] hover:bg-[var(--hero-soft)]',
            )}
          >
            <k.icon className="h-3.5 w-3.5" />
            {k.label}
          </button>
        ))}
      </div>

      <Field label="Title" optional>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Give this entry a title…"
          className={cn('text-base font-medium placeholder:text-[var(--hero-muted)]', heroField)}
        />
      </Field>

      <div className="mt-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--hero-line)] bg-[var(--hero-soft)]">
        <RichEditor
          className="kb-editor-framed"
          content={restored?.body}
          autoFocus
          mentionShortcuts
          onSubmit={save}
          onReady={onReady}
          onUpdate={() => { setHasDraft(true); setBodyRev((n) => n + 1) }}
          placeholder="What happened? Type @ for people or [[ for tasks and projects…"
        />
      </div>

      {(active.comms || active.slot) && (
        <div className={cn(
          'mt-3 grid grid-cols-2 gap-3 rounded-[var(--radius-md)] bg-[var(--hero-soft)] p-3',
          active.comms ? 'sm:grid-cols-4' : 'sm:grid-cols-3',
        )}>
          {active.comms && (
          <div className="flex flex-col gap-1">
            <Label>Direction</Label>
            <div className="flex gap-1">
              {([['INBOUND', ArrowDownLeft], ['OUTBOUND', ArrowUpRight]] as const).map(([d, Icon]) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(direction === d ? '' : d)}
                  title={d.toLowerCase()}
                  className={cn(
                    'inline-flex h-8 flex-1 items-center justify-center rounded-md border text-xs transition-colors',
                    direction === d
                      ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'border-[var(--hero-line)] hover:bg-[var(--hero-soft)]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>
          )}
          <div className="flex flex-col gap-1">
            <Label>Duration (min)</Label>
            <Input type="number" min={0} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} className={cn('h-8 text-xs', heroField)} placeholder="25" />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label>Location</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} className={cn('h-8 text-xs', heroField)} placeholder="Zoom, office…" />
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="Date & time">
          <Input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => { dateTouched.current = true; setOccurredAt(e.target.value) }}
            className={cn('tabular', heroField)}
          />
        </Field>
        {/* One field, two rows. Saving with a date here writes a second entry
            dated to it, tied back to this one and carrying the same people, so
            the promised conversation already has a note waiting when it
            happens. Storage and capture do not have to match: nobody wants to
            compose two notes to record one. */}
        <Field label="Follow-up" optional>
          <Input
            type="datetime-local"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
            className={cn('tabular', heroField)}
            title="Starts a note for the next conversation, linked to this one"
          />
        </Field>
        <Field label="Project" optional>
          <Select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={cn(heroField)}
          >
            <option value="">No project</option>
            {(projects ?? []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Tags" optional>
          <ChipsInput value={tags} onChange={setTags} placeholder="Add a tag…" />
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--hero-line)] pt-3">
        <p className="text-[11px] text-[var(--hero-muted)]">
          {hasDraft ? 'Draft saved locally' : 'Nothing to save yet'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => { reset(); setOpen(false) }} className="text-[var(--hero-muted)] hover:bg-[var(--hero-soft)] hover:text-[var(--hero-ink)]">
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="shrink-0">
            <Send className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save entry'}
            <kbd className="ml-1 hidden text-[10px] opacity-70 sm:inline">{mod} ↵</kbd>
          </Button>
        </div>
      </div>
    </>
  )

  return (
    <Card
      className="kb-hero relative overflow-hidden border-0 p-6"
      data-mark={settings.appTitle.slice(0, 1).toUpperCase()}
    >
      <div className="mb-5 pr-8">
        <h2 className="text-[1.6rem] leading-tight text-[var(--hero-ink)]">
          {prompt ?? 'What’s worth remembering?'}
        </h2>
        <p className="mt-1 text-sm text-[var(--hero-muted)]">
          {hint ?? 'Capture a conversation, a thought, or a commitment. Connections happen automatically.'}
        </p>
      </div>

      {open ? (
        <>
          <button
            type="button"
            onClick={() => { reset(); setOpen(false) }}
            aria-label="Close composer"
            className="absolute right-4 top-4 rounded-full p-1.5 text-[var(--hero-muted)] transition-colors hover:bg-[var(--hero-soft)] hover:text-[var(--hero-ink)]"
          >
            <X className="h-4 w-4" />
          </button>
          {form}
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--hero-line)] bg-[var(--hero-soft)] p-1.5 pl-4 text-left transition-colors hover:border-[color-mix(in_oklch,var(--hero-ink)_28%,transparent)]"
        >
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--hero-muted)]">
            {hasDraft ? 'Pick up your draft…' : 'Type @ for people or [[ for projects…'}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--primary)] px-3.5 py-2 text-sm font-medium text-[var(--primary-foreground)]">
            {hasDraft ? 'Resume' : 'Start writing'} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </button>
      )}
    </Card>
  )
}

function Field({ label, optional, children }: {
  label: string; optional?: boolean; children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--hero-muted)]">
        {label}{optional && <span className="ml-1.5 opacity-60">optional</span>}
      </span>
      {children}
    </div>
  )
}
