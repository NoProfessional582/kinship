'use client'
/**
 * The map's WebGL canvas: the scene from lib/graph/scene.ts, a camera that orbits it, and
 * hit-proxy picking for hover and click. Browser only, so it is loaded through
 * graph-canvas-loader.tsx (next/dynamic, no server rendering) and three never reaches the
 * server's bundle.
 *
 * It draws on demand: once for each camera move, resize, change of labels, highlight or
 * settings, while the controls' damping settles after a drag or the orbit glides to a
 * selected record, while the selected record's beacon pulses, and while auto-orbit is on;
 * never in a loop while the view is still and nothing is selected. With reduced motion the beacon is a still ring and the
 * orbit moves to a selection at once.
 * While a drawer covers part of it (`inset`), the view's centre moves into the part still
 * showing, so the selected record is not hidden behind it.
 * Leaving the page frees everything it made: the scene's geometries, materials and
 * textures, the controls, the observer, the listeners and the WebGL context.
 * A new `theme` rebuilds the scene in its colours and leaves the camera where it is, as does
 * a new layout of the same records (the Attraction slider, `frame` unchanged), so the map
 * is seen to draw together or spread out; a new `frame` frames the graph afresh.
 * `compact` is for the small map inside a record's page: the page keeps the wheel and a
 * vertical swipe, so it scrolls past the map; a sideways drag still turns it, a tap or click
 * still picks, and a hover lights over the selection (highlight.ts, hoverFirst).
 */
import * as React from 'react'
import { PerspectiveCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { GraphLink, GraphNodeType, MapTheme } from '@/lib/graph/constants'
import { highlightState, neighbourSets } from '@/lib/graph/highlight'
import type { GraphLayout } from '@/lib/graph/layout3d'
import {
  SCENE_DEFAULTS,
  SCENE_STYLE,
  buildGraphScene,
  canvasTextures,
  fitCameraToBounds,
  framingDistance,
  type GraphScene,
  type SceneSettings,
} from '@/lib/graph/scene'

export interface GraphCanvasHandle {
  /** Back to the opening view of the whole graph. */
  resetCamera(): void
}

export interface GraphCanvasProps {
  layout: GraphLayout
  links: readonly GraphLink[]
  /** The record to preview: it and its direct connections light up, the rest dim. */
  hoveredId?: string | null
  /** The record in focus: lit like a hover, but it wins over one, gets the beacon, and the
   * orbit centres on it. */
  selectedId?: string | null
  /** The overlay's settings, applied to the built scene as they change. */
  settings?: SceneSettings
  /** The record types the legend has turned off: hidden in place, with their links. */
  hiddenTypes?: ReadonlySet<GraphNodeType>
  /**
   * The camera frames the whole graph again when this changes, and holds its place for a
   * new layout otherwise. The layout itself when left out: every new layout is framed.
   */
  frame?: unknown
  /** The app's theme: the dark map, as approved, or the light one. */
  theme?: MapTheme
  /** Turns the view slowly round the orbit centre; off unless the user turns it on. */
  autoOrbit?: boolean
  /** CSS pixels covered on the right and along the bottom (the inspector), if any. */
  inset?: Inset
  /** A small map inside a page, which scrolls over it: no zoom or pan, hover first. */
  compact?: boolean
  /** The record under the pointer, or null when it leaves them all. */
  onHover?: (nodeId: string | null) => void
  /** A click (not a drag) on a record, or null for a click on empty space. */
  onSelect?: (nodeId: string | null) => void
  /** The first frame of a scene is drawn: the map is on screen. */
  onReady?: () => void
  /** WebGL could not start, or the browser took its context away. */
  onUnavailable: () => void
  ref?: React.Ref<GraphCanvasHandle>
}

/** As in the prototype. */
const CONTROLS = { dampingFactor: 0.05, minDistance: 18, maxDistance: 250, autoRotateSpeed: 0.65 }
/** The frame the prototype's damping was tuned at (60 a second), in ms. */
const FRAME = 1000 / 60
/** A longer gap (a stalled tab) eases as if it were this long, so the view does not jump. */
const MAX_FRAME_GAP = 250
/** Sharper than this costs a phone more than anyone can see. */
const MAX_PIXEL_RATIO = 2
/** A press that moves further than this, in CSS pixels, is a drag and selects nothing. */
const CLICK_SLOP = 5
/** The orbit centre's glide to a selected record ends this close to it, in scene units. */
const GLIDE_DONE = 0.01
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Whether this browser can make a WebGL context at all, asked before making the renderer. */
export function webglAvailable(doc: Document = document): boolean {
  try {
    const probe = doc.createElement('canvas')
    const gl = probe.getContext('webgl2') ?? probe.getContext('webgl')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

export interface Inset {
  right: number
  bottom: number
}
const NO_INSET: Inset = { right: 0, bottom: 0 }
const NONE_HIDDEN: ReadonlySet<GraphNodeType> = new Set()

/** The view centre's shift, in CSS pixels: half of what is covered on each side. */
function shiftFor(inset: Inset) {
  return new Vector2(inset.right / 2, inset.bottom / 2)
}

/**
 * Moves the projection's centre left and up by `shift` without zooming; the raycaster reads
 * the same projection, so picking still lands on what is drawn.
 */
function applyShift(camera: PerspectiveCamera, host: HTMLElement, shift: Vector2) {
  const width = host.clientWidth
  const height = host.clientHeight
  if (width === 0 || height === 0) return
  // For the browser tests: where the view's centre is now, in whole pixels.
  host.dataset.viewShift = `${Math.round(shift.x)},${Math.round(shift.y)}`
  if (shift.x === 0 && shift.y === 0) camera.clearViewOffset()
  else camera.setViewOffset(width, height, shift.x, shift.y, width, height)
}

/** What the scene effect needs from the renderer effect. */
interface View {
  renderer: WebGLRenderer
  camera: PerspectiveCamera
  controls: OrbitControls
  world: Scene
  /** Ask for a frame; several asks before it comes make one frame. */
  invalidate(): void
  /** Set by the scene effect: the hit proxies to pick from, and the camera fit. */
  graph: GraphScene | null
  /** When the scene being shown began to build, until its first frame is drawn. */
  building: number | null
  /** The record with the beacon. */
  selectedId: string | null
  /** Where the orbit centre is gliding to, until it gets there. */
  glide: Vector3 | null
  /** The view centre's shift now, and the one it eases to (applyShift). */
  shift: Vector2
  shiftTo: Vector2
  reducedMotion: boolean
}

/** The performance entry timing a scene's build and first frame, read by the benchmark. */
export const FIRST_DRAW_MEASURE = 'graph:first-draw'

export default function GraphCanvas({
  layout,
  links,
  hoveredId = null,
  selectedId = null,
  settings = SCENE_DEFAULTS,
  hiddenTypes = NONE_HIDDEN,
  frame,
  theme = 'dark',
  autoOrbit = false,
  inset = NO_INSET,
  compact = false,
  onHover,
  onSelect,
  onReady,
  onUnavailable,
  ref,
}: GraphCanvasProps) {
  const container = React.useRef<HTMLDivElement>(null)
  const view = React.useRef<View | null>(null)
  // The latest callbacks, without rebuilding the renderer when a parent re-renders.
  const handlers = React.useRef({ onHover, onSelect, onReady, onUnavailable })
  React.useEffect(() => {
    handlers.current = { onHover, onSelect, onReady, onUnavailable }
  })

  // The renderer, camera and controls: made once per mount.
  React.useEffect(() => {
    const host = container.current
    if (!host) return
    if (!webglAvailable()) {
      handlers.current.onUnavailable()
      return
    }
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    } catch {
      handlers.current.onUnavailable()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'none'
    canvas.setAttribute('aria-hidden', 'true')
    host.appendChild(canvas)

    const { fov, near, far } = SCENE_STYLE.camera
    const camera = new PerspectiveCamera(fov, 1, near, far)
    const world = new Scene()

    const motion = window.matchMedia(REDUCED_MOTION)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = !motion.matches
    controls.dampingFactor = CONTROLS.dampingFactor
    // The wheel zooms towards the record under the pointer, not the middle of the view
    // (user decision 2026-10-11); the small map does not zoom at all.
    controls.zoomToCursor = !compact
    controls.minDistance = CONTROLS.minDistance
    controls.maxDistance = CONTROLS.maxDistance
    controls.autoRotate = false
    controls.autoRotateSpeed = CONTROLS.autoRotateSpeed
    if (compact) {
      // Only sideways drags reach the controls; the browser scrolls the page for the rest.
      canvas.style.touchAction = 'pan-y'
      controls.enableZoom = false
      controls.enablePan = false
    }

    let frame = 0
    let frames = 0
    let disposed = false
    let lastMoving = 0
    const draw = (now: number) => {
      frame = 0
      if (disposed) return
      // Counted for the browser tests, which check that nothing draws while the view is still.
      host.dataset.frames = String(++frames)
      // Damping eases the view by a share of what is left on each frame. Scaled by the time
      // since the last frame, a slow device glides as long as a fast one, in fewer frames,
      // instead of drawing hundreds of slow frames after every drag.
      const elapsed = lastMoving ? Math.min(now - lastMoving, MAX_FRAME_GAP) : FRAME
      controls.dampingFactor = 1 - (1 - CONTROLS.dampingFactor) ** (elapsed / FRAME)
      // The orbit centre eases to a selected record by the same share as the damping.
      let gliding = false
      if (current.glide) {
        controls.target.lerp(current.glide, controls.dampingFactor)
        if (controls.target.distanceTo(current.glide) <= GLIDE_DONE) {
          controls.target.copy(current.glide)
          current.glide = null
        } else gliding = true
      }
      // update() moves the camera on while damping settles or auto-orbit turns it, and says
      // whether it did; auto-orbit turns by the time passed, so as fast on every device.
      if (!current.shift.equals(current.shiftTo)) {
        current.shift.lerp(current.shiftTo, controls.dampingFactor)
        if (current.shift.distanceTo(current.shiftTo) <= 0.5) current.shift.copy(current.shiftTo)
        else gliding = true
        applyShift(camera, host, current.shift)
      }
      const moving = controls.update(elapsed / 1000) || gliding
      lastMoving = moving ? now : 0
      current.graph?.updateView(camera.position)
      const pulsing =
        current.graph?.placeBeacon(current.selectedId, camera, now / 1000, current.reducedMotion) ??
        false
      renderer.render(world, camera)
      if (current.building !== null && current.graph) {
        performance.measure(FIRST_DRAW_MEASURE, { start: current.building })
        current.building = null
        handlers.current.onReady?.()
      }
      if (moving || pulsing || controls.autoRotate) invalidate()
    }
    const invalidate = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(draw)
    }
    const current: View = {
      renderer,
      camera,
      controls,
      world,
      invalidate,
      graph: null,
      building: null,
      selectedId: null,
      glide: null,
      shift: new Vector2(),
      shiftTo: new Vector2(),
      reducedMotion: motion.matches,
    }
    view.current = current
    controls.addEventListener('change', invalidate)

    // Followed live: turning reduced motion on stops the pulse and the glide at once.
    const motionChanged = () => {
      current.reducedMotion = motion.matches
      controls.enableDamping = !motion.matches
      if (motion.matches && current.glide) {
        controls.target.copy(current.glide)
        current.glide = null
        controls.update()
      }
      if (motion.matches) {
        current.shift.copy(current.shiftTo)
        applyShift(camera, host, current.shift)
      }
      invalidate()
    }
    motion.addEventListener('change', motionChanged)

    const resize = () => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (width === 0 || height === 0) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      // The offset is in pixels of the old size; set it again for the new one.
      applyShift(camera, host, current.shift)
      invalidate()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const lost = (event: Event) => {
      event.preventDefault()
      handlers.current.onUnavailable()
    }
    canvas.addEventListener('webglcontextlost', lost)

    // Picking: the hit proxies are hidden, so never drawn, but the raycaster still finds them.
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const pick = (event: PointerEvent): string | null => {
      const graph = current.graph
      if (!graph) return null
      const box = canvas.getBoundingClientRect()
      pointer.set(
        ((event.clientX - box.left) / box.width) * 2 - 1,
        -((event.clientY - box.top) / box.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const [hit] = raycaster.intersectObjects(graph.hitTargets, false)
      return hit ? (graph.nodeIdOf(hit.object) ?? null) : null
    }
    let hovered: string | null = null
    const hover = (id: string | null) => {
      if (id === hovered) return
      hovered = id
      canvas.style.cursor = id ? 'pointer' : ''
      handlers.current.onHover?.(id)
    }
    let pressed: { x: number; y: number } | null = null
    const down = (event: PointerEvent) => {
      pressed = { x: event.clientX, y: event.clientY }
    }
    const move = (event: PointerEvent) => {
      // Only a mouse or pen hovers; a finger dragging is turning the view.
      if (event.pointerType === 'touch' || event.buttons !== 0) return
      hover(pick(event))
    }
    const up = (event: PointerEvent) => {
      const start = pressed
      pressed = null
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) {
        return
      }
      handlers.current.onSelect?.(pick(event))
    }
    const leave = () => hover(null)
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointerleave', leave)

    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      view.current = null
      motion.removeEventListener('change', motionChanged)
      observer.disconnect()
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointerleave', leave)
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      // The scene effect has already freed the graph; this frees what the renderer holds.
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [compact])

  // The settings the scene was last given, so a rebuilt scene starts with them.
  const applied = React.useRef(settings)

  // What the camera was last fitted to, so a new theme or arrangement keeps the view.
  const framed = frame ?? layout
  const fitted = React.useRef<unknown>(null)

  // The scene: rebuilt for each new layout, fitted to it, and rebuilt for a new theme.
  React.useEffect(() => {
    const current = view.current
    if (!current) return
    current.building = performance.now()
    const graph = buildGraphScene(layout, links, canvasTextures(), applied.current, theme)
    current.world.background = graph.background
    current.world.add(graph.root)
    current.graph = graph
    if (fitted.current !== framed) {
      fitted.current = framed
      fit(current, graph)
    } else {
      roomFor(current, graph)
      graph.updateView(current.camera.position)
      current.invalidate()
    }
    return () => {
      if (current.graph === graph) current.graph = null
      graph.dispose()
      current.invalidate()
    }
  }, [layout, links, theme, framed])

  // The settings: applied to the built scene in place, never re-running the layout.
  React.useEffect(() => {
    const current = view.current
    applied.current = settings
    if (current?.graph?.applySettings(settings)) current.invalidate()
  }, [settings, layout])

  // The legend's filter: applied in place, and again to a rebuilt scene (theme, layout).
  React.useEffect(() => {
    const current = view.current
    if (current?.graph?.applyHidden(hiddenTypes)) current.invalidate()
  }, [hiddenTypes, layout, links, theme, framed])

  React.useEffect(() => {
    const current = view.current
    if (!current) return
    current.controls.autoRotate = autoOrbit
    current.invalidate()
  }, [autoOrbit])

  const neighbours = React.useMemo(() => neighbourSets(links), [links])

  // The highlight: after the scene effect, so a rebuilt scene is lit as the old one was.
  React.useEffect(() => {
    const current = view.current
    const graph = current?.graph
    if (!current || !graph) return
    graph.applyHighlight(highlightState({ hoveredId, selectedId, neighbours, hoverFirst: compact }))
    current.invalidate()
  }, [hoveredId, selectedId, neighbours, layout, compact, theme])

  // A new selection: the beacon moves to it and the orbit centres on it.
  React.useEffect(() => {
    const current = view.current
    if (!current) return
    current.selectedId = selectedId
    const objects = selectedId === null ? undefined : current.graph?.nodes.get(selectedId)
    if (objects) {
      const { x, y, z } = objects.node
      current.glide = new Vector3(x, y, z)
      if (current.reducedMotion) {
        current.controls.target.copy(current.glide)
        current.glide = null
        current.controls.update()
      }
    }
    current.invalidate()
  }, [selectedId, layout])

  // A drawer opened, closed or changed size: ease the view's centre into what still shows.
  const { right, bottom } = inset
  React.useEffect(() => {
    const current = view.current
    if (!current) return
    current.shiftTo = shiftFor({ right, bottom })
    if (current.reducedMotion) {
      current.shift.copy(current.shiftTo)
      applyShift(current.camera, current.renderer.domElement.parentElement!, current.shift)
    }
    current.invalidate()
  }, [right, bottom])

  React.useImperativeHandle(
    ref,
    () => ({
      resetCamera() {
        const current = view.current
        if (current?.graph) fit(current, current.graph)
      },
    }),
    [],
  )

  return <div ref={container} className="absolute inset-0" data-testid="graph-canvas" />
}

/** Frames the whole graph from the opening direction, and orbits its centre. */
function fit(current: View, graph: GraphScene) {
  const { camera, controls } = current
  const center = fitCameraToBounds(camera, graph.bounds)
  const distance = camera.position.distanceTo(center)
  // A big graph fits further out than the prototype's limit; leave room to zoom out past it.
  controls.maxDistance = Math.max(CONTROLS.maxDistance, distance * 1.5)
  current.glide = null
  controls.target.copy(center)
  controls.update()
  graph.updateView(camera.position)
  current.invalidate()
}

/**
 * Keeps the camera where it is for a new arrangement, but lets it zoom out far enough to
 * see all of it, and draws as far as it reaches.
 */
function roomFor(current: View, graph: GraphScene) {
  const { camera, controls } = current
  const distance = framingDistance(camera, graph.bounds)
  controls.maxDistance = Math.max(controls.maxDistance, distance * 1.5)
  camera.far = Math.max(camera.far, controls.maxDistance + graph.bounds.radius * 2)
  camera.updateProjectionMatrix()
}
