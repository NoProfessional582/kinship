'use client'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ChipsInput } from '@/components/ui/chips'
import { ContactPicker, type ContactRef } from '@/components/ui/contact-picker'
import { AllDayToggle, DateTimeField, toAllDay, toTimed } from '@/components/ui/datetime-field'
import { useTimezone } from '@/lib/hooks/settings'
import { Field } from './contact-form'
import { api, useProjects } from '@/lib/hooks/api'
import type { BoardColumn, TaskRecord } from '@/lib/api-types'

export interface TaskFormValue {
  title: string
  description: string
  priority: string
  projectId: string
  parentTaskId: string
  columnId: string
  /** Canonical ISO instants; the widget converts for display. See DateTimeField. */
  startDate: string
  dueDate: string
  allDay: boolean
  /** Full refs, not bare ids: the chips have to render a name. */
  assignees: ContactRef[]
  tags: string[]
}

export function blankTask(title = ''): TaskFormValue {
  return {
    title,
    description: '',
    priority: 'MEDIUM',
    projectId: '',
    parentTaskId: '',
    columnId: '',
    startDate: '',
    dueDate: '',
    allDay: true,
    assignees: [],
    tags: [],
  }
}

export function taskFromRecord(t: TaskRecord): TaskFormValue {
  return {
    title: t.title ?? '',
    description: t.description ?? '',
    priority: t.priority ?? 'MEDIUM',
    projectId: t.projectId ?? '',
    parentTaskId: t.parentTaskId ?? '',
    columnId: t.columnId ?? '',
    startDate: t.startDate ? new Date(t.startDate).toISOString() : '',
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : '',
    allDay: t.allDay ?? true,
    assignees: t.assignees.map(({ contact: c }) => ({
      id: c.id,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
    })),
    tags: t.tags.map((x) => x.tag.name),
  }
}

export function taskToPayload(v: TaskFormValue, isDraft = false) {
  return {
    title: v.title.trim(),
    description: v.description || null,
    priority: v.priority,
    projectId: v.projectId || null,
    parentTaskId: v.parentTaskId || null,
    columnId: v.columnId || null,
    startDate: v.startDate || null,
    dueDate: v.dueDate || null,
    allDay: v.allDay,
    assigneeIds: v.assignees.map((a) => a.id),
    tags: v.tags,
    isDraft,
  }
}

export function TaskForm({
  value,
  onChange,
}: {
  value: TaskFormValue
  onChange: (v: TaskFormValue) => void
}) {
  const set = (patch: Partial<TaskFormValue>) => onChange({ ...value, ...patch })
  const { timezone } = useTimezone()
  const { data: projects } = useProjects()

  // Flipping the switch converts both dates rather than reinterpreting them:
  // the stored instant means something different under each mode, so leaving it
  // untouched would move the deadline.
  const setAllDay = (allDay: boolean) =>
    set({
      allDay,
      startDate: allDay
        ? toAllDay(value.startDate, timezone)
        : toTimed(value.startDate, timezone, 9),
      dueDate: allDay ? toAllDay(value.dueDate, timezone) : toTimed(value.dueDate, timezone, 17),
    })
  // One board for the whole app, so the column list does not depend on which
  // project the task belongs to.
  const { data: board } = useQuery({
    queryKey: ['columns'],
    queryFn: () => api.get<BoardColumn[]>('/api/columns'),
  })

  // Without a real column selected the status control would sit blank, so fall
  // back to the board's first column.
  React.useEffect(() => {
    if (!board?.length) return
    if (!value.columnId || !board.some((c) => c.id === value.columnId)) {
      onChange({ ...value, columnId: board[0].id })
    }
  }, [board, value, onChange])

  return (
    <div className="flex flex-col gap-4">
      <Field label="Title">
        <Input
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="What needs doing?"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Project">
          <Select value={value.projectId} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">No project</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={value.columnId} onChange={(e) => set({ columnId: e.target.value })}>
            {(board ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={value.priority} onChange={(e) => set({ priority: e.target.value })}>
            {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
              <option key={p} value={p}>
                {p.toLowerCase()}
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
        <Field label="Due date">
          <DateTimeField
            value={value.dueDate}
            allDay={value.allDay}
            onChange={(dueDate) => set({ dueDate })}
          />
        </Field>
        <div className="col-span-2 -mt-1 sm:col-span-3">
          <AllDayToggle checked={value.allDay} onChange={setAllDay} />
        </div>
      </div>

      <Field label="Assignees">
        <ContactPicker
          value={value.assignees}
          onChange={(assignees) => set({ assignees })}
          emptyHint="No contacts yet — add people first."
        />
      </Field>

      <Field label="Description">
        <Textarea
          rows={3}
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>

      <Field label="Tags">
        <ChipsInput value={value.tags} onChange={(tags) => set({ tags })} />
      </Field>
    </div>
  )
}
