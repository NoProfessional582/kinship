'use client'
import * as React from 'react'
import { subscribeBrowser } from './platform'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { browserTimezone, formatInstant, msUntilZoneMidnight, zonedToday } from '../format'

export interface Settings {
  timezone: string | null
  userName: string
  appTitle: string
  tagline: string
  weatherEnabled: boolean
  weatherLocation: string
  weatherUnit: 'fahrenheit' | 'celsius'
  calendarWeekStart: 'sunday' | 'monday'
  fontScale: number
  defaultCadence: string
  agentAccess: 'write' | 'read'
}

const FALLBACK: Settings = {
  timezone: null,
  userName: 'You',
  appTitle: 'Kinship',
  tagline: 'Personal knowledge & relationships',
  weatherEnabled: false,
  weatherLocation: 'San Francisco, CA',
  weatherUnit: 'fahrenheit',
  calendarWeekStart: 'monday',
  fontScale: 1,
  defaultCadence: 'MONTHLY',
  agentAccess: 'write',
}

export function useSettings() {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<Settings>('/api/settings'),
    staleTime: 5 * 60_000,
  })
  return { ...FALLBACK, ...(data ?? {}) }
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.patch<Settings>('/api/settings', patch),
    onSuccess: () => qc.invalidateQueries(),
  })
}

/**
 * The resolved timezone plus a formatter bound to it, so every instant on
 * screen agrees on which zone it is being shown in.
 */
export function useTimezone() {
  const settings = useSettings()
  const fallback = React.useSyncExternalStore(subscribeBrowser, browserTimezone, () => 'UTC')

  const timezone = settings.timezone ?? fallback
  const fmt = React.useCallback(
    (value: string | Date | null | undefined, pattern: string) =>
      formatInstant(value, pattern, timezone),
    [timezone],
  )
  return { timezone, isAuto: !settings.timezone, fmt }
}

/** Applies the saved type scale to the document, mirroring Codex's --font-scale. */
export function useFontScale() {
  const { fontScale } = useSettings()
  React.useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale ?? 1))
  }, [fontScale])
}

export interface Weather {
  enabled: boolean
  location?: string
  temperature?: number
  unit?: string
  code?: number | null
  error?: string
}

export function useWeather() {
  const { weatherEnabled } = useSettings()
  return useQuery({
    queryKey: ['weather'],
    queryFn: () => api.get<Weather>('/api/weather'),
    enabled: weatherEnabled,
    staleTime: 15 * 60_000,
    refetchOnWindowFocus: false,
  })
}

/** open-meteo WMO codes, collapsed to the handful worth showing. */
export function weatherLabel(code: number | null | undefined): string {
  if (code == null) return ''
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Cloudy'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Drizzle'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  if (code <= 86) return 'Snow showers'
  return 'Storm'
}

/**
 * Today's calendar day in the app's zone, or `null` until the browser has had a
 * chance to say what zone that is. Callers must handle the null: rendering a
 * date the server guessed is a hydration mismatch, and guessing UTC is how a
 * due date reads "tomorrow" all evening.
 */
export function useZonedToday(): Date | null {
  const { timezone } = useTimezone()
  const [today, setToday] = React.useState<Date | null>(null)

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    // Re-resolve at the zone's own midnight rather than on an interval, so a
    // tab left open overnight does not keep yesterday's "today" — and re-arm
    // from inside the tick, or it only ever happens once. The old version added
    // 24h to a browser-local midnight and armed a single timeout: it fired at
    // the wrong instant whenever the pinned zone differed from the browser, and
    // when the zone ran behind, the deadline was already past, the 1s floor
    // fired immediately, `today` did not change, and nothing rearmed it.
    const tick = () => {
      setToday(zonedToday(timezone))
      timer = setTimeout(tick, Math.max(1000, msUntilZoneMidnight(timezone)))
    }
    tick()
    return () => clearTimeout(timer)
  }, [timezone])

  return today
}
