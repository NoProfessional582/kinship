'use client'
/**
 * The map's glass overlay: the colour legend, auto-orbit, a camera reset, and live controls
 * for node size, link width, glow and stars. Settings last for the visit; nothing is saved.
 *
 * On a wide screen the controls sit top left and the legend bottom right, clear of the
 * status line (bottom left). On a phone both fold into one panel behind a "View" button,
 * so the map stays free to turn with a finger.
 *
 * Like the rest of the map, it is always dark (#080a0e behind it), whatever the app's theme.
 */
import * as React from 'react'
import { Crosshair, RotateCw, Settings2, Sparkles } from 'lucide-react'
import { GRAPH_COLORS, GRAPH_NODE_TYPES, type GraphNodeType } from '@/lib/graph/constants'
import type { SceneSettings, StarDensity } from '@/lib/graph/scene'

/** The prototype's legend names. */
export const LEGEND_LABELS: Record<GraphNodeType, string> = {
  contact: 'Contacts (People)',
  project: 'Projects',
  entry: 'Notes & Entries',
  task: 'Tasks',
  tag: 'Tags & Topics',
}

/**
 * The prototype's ranges, and how each value reads. Link width starts at 0.04, not the
 * prototype's 0.05, so that its 0.02 steps land on the approved 0.10.
 */
export const SLIDERS = [
  {
    key: 'nodeScale',
    label: 'Node size',
    min: 0.4,
    max: 2.4,
    step: 0.1,
    show: (v: number) => `${v.toFixed(1)}x`,
  },
  {
    key: 'linkWidth',
    label: 'Link width',
    min: 0.04,
    max: 0.4,
    step: 0.02,
    show: (v: number) => v.toFixed(2),
  },
  {
    key: 'glowIntensity',
    label: 'Glow',
    min: 0.4,
    max: 2.5,
    step: 0.1,
    show: (v: number) => `${v.toFixed(1)}x`,
  },
] as const satisfies readonly {
  key: Exclude<keyof SceneSettings, 'starDensity'>
  label: string
  min: number
  max: number
  step: number
  show: (v: number) => string
}[]

const NEXT_STARS: Record<StarDensity, StarDensity> = {
  dense: 'sparse',
  sparse: 'off',
  off: 'dense',
}
const STAR_NAMES: Record<StarDensity, string> = { dense: 'Dense', sparse: 'Sparse', off: 'Off' }

const GLASS =
  'rounded-lg border border-white/10 bg-slate-900/60 text-slate-200 shadow-lg backdrop-blur-md'
const BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-white/15 px-2.5 py-1.5 text-xs font-medium hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none'
const BUTTON_ON =
  'border-indigo-400 bg-indigo-500 text-white shadow-[0_0_14px_rgba(99,102,241,0.5)] hover:bg-indigo-500'

export interface GraphOverlayProps {
  settings: SceneSettings
  onSettingsChange: (settings: SceneSettings) => void
  autoOrbit: boolean
  onAutoOrbitChange: (on: boolean) => void
  /** Back to the whole graph, with nothing selected. */
  onReset: () => void
}

export function GraphOverlay({
  settings,
  onSettingsChange,
  autoOrbit,
  onAutoOrbitChange,
  onReset,
}: GraphOverlayProps) {
  // Only folds on a phone; on a wide screen the panel is always open (sm:flex below).
  const [open, setOpen] = React.useState(false)
  const panel = React.useId()

  return (
    <>
      <div
        data-map-chrome
        className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2"
      >
        <button
          type="button"
          className={`${GLASS} ${BUTTON} sm:hidden`}
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen(!open)}
        >
          <Settings2 aria-hidden className="h-3.5 w-3.5" />
          View
        </button>
        <section
          id={panel}
          aria-label="Map controls"
          className={`${GLASS} ${open ? 'flex' : 'hidden'} max-h-[calc(100vh-8rem)] w-64 flex-col gap-3 overflow-y-auto p-3 sm:flex`}
          data-testid="map-overlay"
        >
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={`${BUTTON} ${autoOrbit ? BUTTON_ON : ''}`}
              aria-pressed={autoOrbit}
              onClick={() => onAutoOrbitChange(!autoOrbit)}
            >
              <RotateCw aria-hidden className="h-3.5 w-3.5" />
              Auto-orbit
            </button>
            <button type="button" className={BUTTON} onClick={onReset}>
              <Crosshair aria-hidden className="h-3.5 w-3.5" />
              Reset view
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() =>
                onSettingsChange({ ...settings, starDensity: NEXT_STARS[settings.starDensity] })
              }
            >
              <Sparkles aria-hidden className="h-3.5 w-3.5" />
              Stars: {STAR_NAMES[settings.starDensity]}
            </button>
          </div>

          {SLIDERS.map(({ key, label, min, max, step, show }) => {
            const id = `${panel}-${key}`
            const value = settings[key]
            return (
              <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
                <label htmlFor={id} className="text-xs text-slate-300">
                  {label}
                </label>
                <output htmlFor={id} className="text-xs text-slate-100 tabular-nums">
                  {show(value)}
                </output>
                <input
                  id={id}
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={value}
                  aria-valuetext={show(value)}
                  onChange={(event) =>
                    onSettingsChange({ ...settings, [key]: Number(event.target.value) })
                  }
                  className="col-span-2 w-full accent-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
                />
              </div>
            )
          })}

          <Legend className="sm:hidden" />
        </section>
      </div>

      <Legend className={`${GLASS} absolute right-3 bottom-3 z-10 hidden p-3 sm:block`} />
    </>
  )
}

function Legend({ className }: { className: string }) {
  return (
    <div className={className} role="group" aria-label="Legend" data-map-chrome>
      <p className="mb-1.5 text-xs font-semibold text-white">Legend</p>
      <ul className="space-y-1">
        {GRAPH_NODE_TYPES.map((type) => (
          <li key={type} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: GRAPH_COLORS[type], boxShadow: `0 0 8px ${GRAPH_COLORS[type]}` }}
            />
            {LEGEND_LABELS[type]}
          </li>
        ))}
      </ul>
    </div>
  )
}
