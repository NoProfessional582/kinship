'use client'
/**
 * The map's theme, from the app's (next-themes): the dark map after dark, the light one
 * otherwise (user decision 2026-10-11). Only the WebGL scene needs it in script; the page
 * around the map follows the `.dark` class in CSS (app/globals.css `--map-background`).
 */
import { useTheme } from 'next-themes'
import type { MapTheme } from './constants'

export function useMapTheme(): MapTheme {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === 'dark' ? 'dark' : 'light'
}
