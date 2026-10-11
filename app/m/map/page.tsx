'use client'
/**
 * The 3D map (components/graph/map-view.tsx) in the phone frame, which gives it the whole
 * space between the top bar and the tab bar. Its record links stay under /m.
 */
import { MapView } from '@/components/graph/map-view'
import { m } from '@/lib/mobile/href'

export default function MobileMapPage() {
  return <MapView recordHref={m} />
}
