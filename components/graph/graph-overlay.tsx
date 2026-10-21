'use client'
/**
 * The map's glass overlay: the colour legend, auto-orbit, a camera reset, and live controls
 * for node size, link width, glow and stars, and the attraction between linked records
 * (which lays the map out again, so the page applies it once the slider settles). Each
 * legend entry is also a checkbox that shows or hides that type of record. Settings and
 * the filter last for the visit; nothing is saved.
 *
 * On a wide screen the controls sit top left and the legend bottom right, clear of the
 * status line (bottom left), stepping left of the inspector while it is open (on a wide
 * enough screen; hidden otherwise). On a phone
 * both fold into one panel behind a "View" button, so the map stays free to turn with a
 * finger. The "Records" picker (graph-record-picker.tsx) sits beside that button at every
 * width.
 *
 * Like the rest of the map, it follows the app's theme: Kinship's paper, ink and terracotta by
 * day, the approved dark glass after dark (each class's `dark:` partner).
 */
import * as React from 'react'
import { Crosshair, RotateCw, Settings2, Sparkles } from 'lucide-react'
import { GRAPH_COLORS, GRAPH_NODE_TYPES, type GraphNodeType } from '@/lib/graph/constants'
import { MAX_ATTRACTION, MIN_ATTRACTION } from '@/lib/graph/layout3d'
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

/** How close linked records sit (layout3d.ts `attraction`); applied by laying out again. */
export const ATTRACTION_SLIDER = {
  label: 'Attraction',
  min: MIN_ATTRACTION,
  max: MAX_ATTRACTION,
  step: 0.1,
  show: (v: number) => `${v.toFixed(2)}x`,
} as const

const NEXT_STARS: Record<StarDensity, StarDensity> = {
  dense: 'sparse',
  sparse: 'off',
  off: 'dense',
}
const NONE_HIDDEN: ReadonlySet<GraphNodeType> = new Set()
const STAR_NAMES: Record<StarDensity, string> = { dense: 'Dense', sparse: 'Sparse', off: 'Off' }

const GLASS =
  'rounded-lg border border-(--line) dark:border-white/10 bg-(--panel)/85 dark:bg-slate-900/60 text-(--ink-raw) dark:text-slate-200 shadow-lg backdrop-blur-md'
const BUTTON =
  'inline-flex items-center gap-1.5 rounded-md border border-(--line) dark:border-white/15 px-2.5 py-1.5 text-xs font-medium hover:bg-(--ink-raw)/[0.07] dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-(--terracotta) dark:focus-visible:ring-sky-400 focus-visible:outline-none'
const BUTTON_ON =
  'border-(--terracotta) bg-(--terracotta) text-(--primary-foreground) shadow-[0_0_14px_rgba(189,91,63,0.35)] hover:bg-(--terracotta) dark:border-indigo-400 dark:bg-indigo-500 dark:text-white dark:shadow-[0_0_14px_rgba(99,102,241,0.5)] dark:hover:bg-indigo-500'

export interface GraphOverlayProps {
  settings: SceneSettings
  onSettingsChange: (settings: SceneSettings) => void
  /** The record types the legend has turned off. */
  hiddenTypes?: ReadonlySet<GraphNodeType>
  onHiddenTypesChange?: (hiddenTypes: ReadonlySet<GraphNodeType>) => void
  attraction: number
  onAttractionChange: (attraction: number) => void
  autoOrbit: boolean
  onAutoOrbitChange: (on: boolean) => void
  /** Back to the whole graph, with nothing selected. */
  onReset: () => void
  /** The record picker, given the overlay's button look; shown at every width. */
  records?: (buttonClass: string) => React.ReactNode
  /** The inspector is open on the right, where the legend would sit. */
  drawerOpen?: boolean
}

export function GraphOverlay({
  settings,
  onSettingsChange,
  hiddenTypes = NONE_HIDDEN,
  onHiddenTypesChange = () => {},
  attraction,
  onAttractionChange,
  autoOrbit,
  onAutoOrbitChange,
  onReset,
  records,
  drawerOpen = false,
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
        <div className="flex gap-2">
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
          {records?.(`${GLASS} ${BUTTON}`)}
        </div>
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

          {SLIDERS.map(({ key, ...slider }) => (
            <Slider
              key={key}
              id={`${panel}-${key}`}
              {...slider}
              value={settings[key]}
              onChange={(value) => onSettingsChange({ ...settings, [key]: value })}
            />
          ))}
          <Slider
            id={`${panel}-attraction`}
            {...ATTRACTION_SLIDER}
            value={attraction}
            onChange={onAttractionChange}
          />

          <Legend
            className="sm:hidden"
            hiddenTypes={hiddenTypes}
            onHiddenTypesChange={onHiddenTypesChange}
          />
        </section>
      </div>

      <Legend
        hiddenTypes={hiddenTypes}
        onHiddenTypesChange={onHiddenTypesChange}
        className={`${GLASS} absolute bottom-3 z-10 hidden p-3 ${
          // Beside the drawer only where there is room for it and the status line.
          drawerOpen ? 'right-[calc(350px+1.5rem)] lg:block' : 'right-3 sm:block'
        }`}
      />
    </>
  )
}

function Slider({
  id,
  label,
  min,
  max,
  step,
  show,
  value,
  onChange,
}: {
  id: string
  label: string
  min: number
  max: number
  step: number
  show: (v: number) => string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
      <label htmlFor={id} className="text-xs text-(--ink-raw)/85 dark:text-slate-300">
        {label}
      </label>
      <output htmlFor={id} className="text-xs text-(--ink-raw) tabular-nums dark:text-slate-100">
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
        onChange={(event) => onChange(Number(event.target.value))}
        className="col-span-2 w-full accent-(--terracotta) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--terracotta) dark:accent-indigo-400 dark:focus-visible:outline-sky-400"
      />
    </div>
  )
}

/**
 * The colour key, each entry also a checkbox for whether that type shows on the map. A
 * hidden type's swatch is an empty ring and its name fades.
 */
function Legend({
  className,
  hiddenTypes,
  onHiddenTypesChange,
}: {
  className: string
  hiddenTypes: ReadonlySet<GraphNodeType>
  onHiddenTypesChange: (hiddenTypes: ReadonlySet<GraphNodeType>) => void
}) {
  const toggle = (type: GraphNodeType, shown: boolean) => {
    const next = new Set(hiddenTypes)
    if (shown) next.delete(type)
    else next.add(type)
    onHiddenTypesChange(next)
  }
  return (
    <div className={className} role="group" aria-label="Legend" data-map-chrome>
      <p className="mb-1.5 text-xs font-semibold text-(--ink-raw) dark:text-white">Legend</p>
      <ul className="space-y-1">
        {GRAPH_NODE_TYPES.map((type) => {
          const shown = !hiddenTypes.has(type)
          const color = GRAPH_COLORS[type]
          return (
            <li key={type}>
              <label
                className={`-mx-1 flex cursor-pointer items-center gap-2 rounded px-1 text-xs select-none hover:bg-(--ink-raw)/[0.07] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-(--terracotta) dark:hover:bg-white/10 dark:has-[:focus-visible]:ring-sky-400 ${shown ? '' : 'opacity-50'}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={shown}
                  onChange={(event) => toggle(type, event.target.checked)}
                />
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full border"
                  style={
                    shown
                      ? { background: color, borderColor: color, boxShadow: `0 0 8px ${color}` }
                      : { background: 'transparent', borderColor: color }
                  }
                />
                {LEGEND_LABELS[type]}
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
