'use client'
import * as React from 'react'
import { ArrowRight, ChevronDown, ChevronUp, Send } from 'lucide-react'
import { RichEditor } from '@/components/editor/editor'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ChipsInput } from '@/components/ui/chips'
import { Select } from '@/components/ui/select'
import { ENTRY_KINDS } from '@/components/entity-modal/entry-form'
import { useComposer } from '@/lib/hooks/composer'
import { useSettings } from '@/lib/hooks/settings'
import {
  MSheet,
  MSheetContent,
  MSheetTitle,
  MSheetBody,
  MSheetFooter,
  MSheetHeader,
} from '@/components/mobile/sheet'
import { cn } from '@/lib/utils'

/**
 * Capture on a phone.
 *
 * The desktop card puts kind chips, a title, the editor, direction, duration,
 * location, date, follow-up, project and tags on screen at once. That is a
 * reasonable trade on a wide card and a wall on a 412px screen — so here the
 * body is the whole first screen and every other field sits behind Details.
 *
 * It shares `useComposer` with the desktop card, which means the draft written
 * on the phone is the same draft the laptop restores, and the ENTRY_KINDS
 * comms/slot flags are read in exactly one place.
 */
export function MobileCapture() {
  const {
    open,
    setOpen,
    restored,
    hasDraft,
    setHasDraft,
    kind,
    setKind,
    title,
    setTitle,
    occurredAt,
    setOccurredAt,
    dateTouched,
    direction,
    setDirection,
    durationMin,
    setDurationMin,
    location,
    setLocation,
    followUpAt,
    setFollowUpAt,
    projectId,
    setProjectId,
    tags,
    setTags,
    saving,
    setBodyRev,
    active,
    onReady,
    save,
    projects,
  } = useComposer()

  const settings = useSettings()
  const [details, setDetails] = React.useState(false)

  return (
    <>
      {/* The dark card, same as the desktop dashboard opens with. Inverting the
          one panel that asks a question is what makes capture read as the point
          of the screen rather than one tile among several — and on a phone, in
          a column of pale tiles, it is also the only thing that says where to
          start. The watermark and the hero palette come from `.kb-hero`. */}
      <div
        className="kb-hero relative overflow-hidden rounded-[var(--radius)] p-3.5"
        data-mark={settings.appTitle.slice(0, 1).toUpperCase()}
      >
        <p className="display pr-10 text-[1.05rem] leading-tight text-[var(--hero-ink)]">
          What’s worth remembering?
        </p>
        <button
          onClick={() => setOpen(true)}
          className="kb-tap mt-2.5 flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-[var(--hero-line)] bg-[var(--hero-soft)] p-1.5 pl-3 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--hero-muted)]">
            {hasDraft ? 'Pick up your draft…' : 'Type @ for people, [[ for tasks…'}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--primary)] px-3 py-2 text-[13px] font-medium text-[var(--primary-foreground)]">
            {hasDraft ? 'Resume' : 'Write'} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>

      <MSheet open={open} onOpenChange={setOpen}>
        <MSheetContent tall hideClose>
          <MSheetHeader>
            <MSheetTitle className="sr-only">Capture</MSheetTitle>
            {/* Kind is the one piece of metadata that changes what the rest of
                the form even means, so it stays above the fold. It scrolls
                sideways in its own track rather than wrapping to three rows. */}
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2">
              {ENTRY_KINDS.map((k) => (
                <button
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  className={cn(
                    'kb-tap-inline shrink-0 gap-1.5 rounded-full border px-3 text-xs transition-colors',
                    kind === k.value
                      ? 'border-transparent bg-[var(--primary)] text-white'
                      : 'border-[var(--border)] text-[var(--muted-foreground)]',
                  )}
                >
                  <k.icon className="h-3.5 w-3.5" />
                  {k.label}
                </button>
              ))}
            </div>
          </MSheetHeader>

          <MSheetBody className="flex flex-col">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="mb-2 text-base font-medium"
            />
            {/* Fills the sheet while the body is the whole screen; stops
                growing once Details is open so the fields are reachable
                without scrolling past a mostly-empty editor. */}
            <div
              className={cn(
                'flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]',
                !details && 'flex-1',
              )}
            >
              <RichEditor
                className="kb-editor-framed"
                content={restored?.body}
                mentionShortcuts
                onReady={onReady}
                onUpdate={() => {
                  setHasDraft(true)
                  setBodyRev((n) => n + 1)
                }}
                placeholder="Type @ for people, [[ for tasks and projects…"
              />
            </div>

            <button
              onClick={() => setDetails((v) => !v)}
              className="kb-tap mt-2 flex w-full items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]"
            >
              {details ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              Details
            </button>

            {details && (
              <div className="mt-2 flex flex-col gap-3">
                {/* Both flags, read from the shared hook. `comms` asks whether
                    this was an exchange with someone; `slot` whether it took
                    time and a place. They part company on EVENT. */}
                {active.comms && (
                  <div className="flex flex-col gap-1">
                    <Label>Direction</Label>
                    <Select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
                      <option value="">—</option>
                      <option value="INBOUND">Inbound</option>
                      <option value="OUTBOUND">Outbound</option>
                    </Select>
                  </div>
                )}
                {active.slot && (
                  <>
                    <div className="flex flex-col gap-1">
                      <Label>Duration (min)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={durationMin}
                        onChange={(e) => setDurationMin(e.target.value)}
                        placeholder="25"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label>Location</Label>
                      <Input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Zoom, office…"
                      />
                    </div>
                  </>
                )}
                <div className="flex flex-col gap-1">
                  <Label>When</Label>
                  <Input
                    type="datetime-local"
                    value={occurredAt}
                    onChange={(e) => {
                      dateTouched.current = true
                      setOccurredAt(e.target.value)
                    }}
                    className="tabular"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Follow up</Label>
                  <Input
                    type="datetime-local"
                    value={followUpAt}
                    onChange={(e) => setFollowUpAt(e.target.value)}
                    className="tabular"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Project</Label>
                  <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    <option value="">None</option>
                    {(projects ?? []).map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Tags</Label>
                  <ChipsInput value={tags} onChange={setTags} placeholder="Add a tag…" />
                </div>
              </div>
            )}
          </MSheetBody>

          <MSheetFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <span className="flex-1" />
            <Button onClick={save} disabled={saving}>
              <Send className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          </MSheetFooter>
        </MSheetContent>
      </MSheet>
    </>
  )
}
