'use client'
import * as React from 'react'
import { toast } from 'sonner'
import { SlidersHorizontal, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/mobile/bits'
import { useSaveSettings, useSettings } from '@/lib/hooks/settings'
import { CADENCE_LABEL } from '@/lib/cadence'

/**
 * The settings a phone actually needs. Column management, the timezone
 * picker's searchable list and the archive export/import stay on the desktop
 * page — they are administration, not something you reach for on a phone, and
 * the desktop page remains the one place that does everything.
 */
export default function MobileSettings() {
  const settings = useSettings()
  const save = useSaveSettings()
  const [draft, setV] = React.useState(settings)
  const [dirty, setDirty] = React.useState(false)

  // The query remains the source until the user starts editing.
  const v = dirty ? draft : settings

  const set = (patch: Partial<typeof settings>) => {
    setDirty(true)
    setV({ ...v, ...patch })
  }

  const commit = async () => {
    try {
      await save.mutateAsync(v)
      setDirty(false)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="flex items-center gap-2 text-[1.4rem]">
          <SlidersHorizontal className="h-5 w-5 text-[var(--primary)]" /> Settings
        </h1>
        <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
          Board columns, the full timezone list and data export/import live on the desktop page.
        </p>
      </header>

      <Section title="You">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Your name</Label>
            <Input value={v.userName} onChange={(e) => set({ userName: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>App title</Label>
            <Input value={v.appTitle} onChange={(e) => set({ appTitle: e.target.value })} />
          </div>
        </div>
      </Section>

      <Section title="Defaults">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Week starts on</Label>
            <Select
              value={v.calendarWeekStart}
              onChange={(e) =>
                set({ calendarWeekStart: e.target.value === 'sunday' ? 'sunday' : 'monday' })
              }
            >
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Default cadence</Label>
            <Select
              value={v.defaultCadence}
              onChange={(e) => set({ defaultCadence: e.target.value })}
            >
              {Object.entries(CADENCE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Section>

      <Section title="Weather">
        <div className="flex flex-col gap-3">
          <label className="kb-tap flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={v.weatherEnabled}
              onChange={(e) => set({ weatherEnabled: e.target.checked })}
              className="h-4 w-4"
            />
            Show weather on Today
          </label>
          {v.weatherEnabled && (
            <>
              <div className="flex flex-col gap-1">
                <Label>Location</Label>
                <Input
                  value={v.weatherLocation}
                  onChange={(e) => set({ weatherLocation: e.target.value })}
                  placeholder="City, region"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Units</Label>
                <Select
                  value={v.weatherUnit}
                  onChange={(e) =>
                    set({ weatherUnit: e.target.value === 'celsius' ? 'celsius' : 'fahrenheit' })
                  }
                >
                  <option value="fahrenheit">Fahrenheit</option>
                  <option value="celsius">Celsius</option>
                </Select>
              </div>
            </>
          )}
        </div>
      </Section>

      <Section title="Agents">
        <div className="flex flex-col gap-1">
          <Label htmlFor="agent-access">What AI agents may do</Label>
          <Select
            id="agent-access"
            value={v.agentAccess}
            onChange={(e) => set({ agentAccess: e.target.value === 'read' ? 'read' : 'write' })}
          >
            <option value="write">Read and write</option>
            <option value="read">Read only</option>
          </Select>
          <p className="text-[12px] text-[var(--muted-foreground)]">
            Agents must run on this computer. Nothing they do is deleted for good.
          </p>
        </div>
      </Section>

      {/* Sticky, because a save button below four sections is a button you have
          to go looking for after every edit. */}
      {dirty && (
        <div className="sticky bottom-2 z-10">
          <Button onClick={commit} disabled={save.isPending} className="w-full shadow-lg">
            {save.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
