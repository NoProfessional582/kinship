'use client'
import * as React from 'react'

/**
 * The modifier this keyboard actually uses. Resolved after mount because the
 * server has no platform to read, and rendering ⌘ on a Windows machine tells
 * the user to press a key that is not there.
 */
export function useModifierKey() {
  const [mod, setMod] = React.useState('Ctrl')
  React.useEffect(() => {
    const ua = navigator.userAgent
    setMod(/Mac|iPhone|iPad|iPod/.test(ua) ? '⌘' : 'Ctrl')
  }, [])
  return mod
}
