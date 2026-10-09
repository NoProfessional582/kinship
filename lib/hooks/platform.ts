'use client'
import * as React from 'react'

/** Static browser data does not emit changes during the lifetime of a page. */
export const subscribeBrowser = () => () => {}
const browserReady = () => true
const serverReady = () => false

/** Keeps browser-only values out of server markup and the hydration render. */
export function useBrowserReady() {
  return React.useSyncExternalStore(subscribeBrowser, browserReady, serverReady)
}

/** The clock when this surface opened, hidden until hydration completes. */
export function useInitialNow() {
  const ready = useBrowserReady()
  const [now] = React.useState(() => new Date())
  return ready ? now : null
}

const modifier = () => (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘' : 'Ctrl')
const serverModifier = () => 'Ctrl'
export function useModifierKey() {
  return React.useSyncExternalStore(subscribeBrowser, modifier, serverModifier)
}

/** All deadline views share one cached clock and one timer. */
let clockValue: number | null = null
let clockTimer: ReturnType<typeof setInterval> | undefined
const clockListeners = new Set<() => void>()
function readClock() {
  if (clockValue === null) clockValue = Date.now()
  return clockValue
}
function subscribeClock(notify: () => void) {
  clockListeners.add(notify)
  if (clockTimer === undefined) {
    clockValue = Date.now()
    clockTimer = setInterval(() => {
      clockValue = Date.now()
      for (const listener of clockListeners) listener()
    }, 1000)
  }
  return () => {
    clockListeners.delete(notify)
    if (!clockListeners.size) {
      clearInterval(clockTimer)
      clockTimer = undefined
    }
  }
}
export function useClockNow() {
  return React.useSyncExternalStore(subscribeClock, readClock, () => null)
}
