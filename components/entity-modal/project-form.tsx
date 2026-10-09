'use client'
import * as React from 'react'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { AllDayToggle, DateTimeField, toAllDay, toTimed } from '@/components/ui/datetime-field'
import { useTimezone } from '@/lib/hooks/settings'
import { Field } from './contact-form'
import { cn } from '@/lib/utils'

export interface ProjectFormValue {
  name: string
  description: string
  color: string
  status: string
  /** Canonical ISO instants; the widget converts for display. See DateTimeField. */
  startDate: string
  targetDate: string
  allDay: boolean
}

// Drawn from the app's own palette so a project's colour never fights the
// surface it sits on.
const PALETTE = [
  '#bd5b3f',
  '#697760',
  '#ba8a42',
  '#4a6572',
  '#7a6a86',
  '#8c5a4a',
  '#5f7d6e',
  '#95432e',
  '#a06a86',
  '#8a8578',
]

export function blankProject(name = ''): ProjectFormValue {
  return {
    name,
    description: '',
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    status: 'TODO',
    startDate: '',
    targetDate: '',
    allDay: true,
  }
}

export function projectFromRecord(p: any): ProjectFormValue {
  return {
    name: p.name ?? '',
    description: p.description ?? '',
    color: p.color ?? PALETTE[0],
    status: p.status ?? 'TODO',
    startDate: p.startDate ? new Date(p.startDate).toISOString() : '',
    targetDate: p.targetDate ? new Date(p.targetDate).toISOString() : '',
    allDay: p.allDay ?? true,
  }
}

export function projectToPayload(v: ProjectFormValue, isDraft = false) {
  return {
    name: v.name.trim(),
    description: v.description || null,
    color: v.color || null,
    status: v.status,
    startDate: v.startDate || null,
    targetDate: v.targetDate || null,
    allDay: v.allDay,
    isDraft,
  }
}

export function ProjectForm({
  value,
  onChange,
}: {
  value: ProjectFormValue
  onChange: (v: ProjectFormValue) => void
}) {
  const set = (patch: Partial<ProjectFormValue>) => onChange({ ...value, ...patch })
  const { timezone } = useTimezone()

  // See TaskForm: the stored instant means something different under each mode.
  const setAllDay = (allDay: boolean) =>
    set({
      allDay,
      startDate: allDay
        ? toAllDay(value.startDate, timezone)
        : toTimed(value.startDate, timezone, 9),
      targetDate: allDay
        ? toAllDay(value.targetDate, timezone)
        : toTimed(value.targetDate, timezone, 17),
    })

  return (
    <div className="flex flex-col gap-4">
      <Field label="Name">
        <Input
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Project name"
        />
      </Field>

      <Field label="Colour">
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set({ color: c })}
              aria-label={`Colour ${c}`}
              className={cn(
                'h-6 w-6 rounded-full border-2 transition-transform',
                value.color === c ? 'scale-110 border-[var(--foreground)]' : 'border-transparent',
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Status">
          <Select value={value.status} onChange={(e) => set({ status: e.target.value })}>
            {['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'ARCHIVED'].map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ').toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start date">
          <DateTimeField
            value={value.startDate}
            allDay={value.allDay}
            onChange={(startDate) => set({ startDate })}
          />
        </Field>
        <Field label="Target date">
          <DateTimeField
            value={value.targetDate}
            allDay={value.allDay}
            onChange={(targetDate) => set({ targetDate })}
          />
        </Field>
        <div className="col-span-2 -mt-1 sm:col-span-3">
          <AllDayToggle checked={value.allDay} onChange={setAllDay} />
        </div>
      </div>

      <Field label="Description">
        <Textarea
          rows={3}
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
    </div>
  )
}
