/**
 * Builds the Cosmic Nexus scene for a laid-out graph: the starfield, a jewel orb, aura,
 * label and invisible hit proxy for each record, and the hairline conduits between them.
 * No React and no DOM, apart from the default canvas textures, which are passed in so the
 * builder runs (and is tested) in Node. The canvas component (phase 02 step 02) owns the
 * renderer, camera and controls; this module only makes and frees the objects.
 *
 * The values are the approved prototype's (plan decisions 2026-10-10). Sizes are in scene
 * units, the same as the layout's: an orb's base radius is the layout's `radius`. The dark
 * theme is that look; the light one (SCENE_THEMES) changes only colours and blending.
 *
 * Costs, for 1,000 records and 3,000 links: orbs and auras are one object each per record
 * but share a geometry per radius and a material per type; hit proxies are hidden, so they
 * are never drawn yet still answer raycasts; labels make their texture only once the camera
 * comes near; orbs far from the camera use a coarser sphere, since the orbs' triangles, not
 * the number of draws, cost the most (docs/graph-layout.md, "Measured in the browser"); and
 * every conduit is one merged geometry, a single draw.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
  type Object3D,
  type Texture,
} from 'three'
import {
  GRAPH_COLORS,
  MAP_BACKGROUNDS,
  type GraphLink,
  type GraphNodeType,
  type MapTheme,
} from './constants'
import {
  LIGHT_LINK_LOOKS,
  LINK_LOOKS,
  growthOf,
  linkLook,
  nodeLook,
  nodeLookValues,
  type HighlightState,
  type LinkLook,
  type LinkLooks,
  type NodeLook,
} from './highlight'
import type { GraphLayout, PositionedNode } from './layout3d'

export type StarDensity = 'dense' | 'sparse' | 'off'

/** What the overlay's sliders change (phase 03). */
export interface SceneSettings {
  /** Every record's orb, aura, proxy and label together. */
  nodeScale: number
  /** The conduits' radius, in scene units. */
  linkWidth: number
  /** Scales the aura, orb radiance and starlight; 1 is the approved look. */
  glowIntensity: number
  starDensity: StarDensity
}

export const SCENE_DEFAULTS: Readonly<SceneSettings> = Object.freeze({
  nodeScale: 0.8,
  linkWidth: 0.1,
  glowIntensity: 1,
  starDensity: 'dense',
})

/** The approved look. The highlighted and dimmed values are in highlight.ts. */
export const SCENE_STYLE = {
  camera: { fov: 46, near: 0.1, far: 1000 },
  /** Where the camera looks from at first, as in the prototype: a little above, in front. */
  cameraDirection: { x: 0, y: 32, z: 120 },
  lights: {
    ambient: 0.65,
    directional: 0.85,
    directionalFrom: { x: 40, y: 60, z: 50 },
  },
  orb: {
    segments: 24,
    /**
     * Further than `detailDistance` from the camera, an orb is at most a few dozen pixels
     * across, and a sphere of `farSegments` looks the same there for a quarter the triangles.
     */
    farSegments: 12,
    detailDistance: 60,
    roughness: 0.15,
    metalness: 0.2,
    opacity: 0.95,
    emissive: 0.45,
  },
  /** The aura sprite's side, as a multiple of the orb's base radius. */
  aura: { scale: 4.33, opacity: 0.7 },
  /** Raised so one sphere covers both the orb and its label. */
  hitProxy: { scale: 2.8, offsetY: 1.2, segments: 16 },
  label: {
    y: 3.2,
    width: 10.5,
    height: 2.6,
    opacity: 0.9,
    /**
     * Labels further than this from the camera are hidden. At about 90 units the name
     * is some 9 pixels tall in a 1,000-pixel-high view, about the smallest that reads.
     */
    maxDistance: 90,
    /**
     * A graph this small shows every name wherever the camera is, as the prototype did
     * (user decision 2026-10-11); only bigger graphs hide the far ones.
     */
    allUpTo: 150,
  },
  conduit: { color: '#5a6372', opacity: 0.55, sides: 6 },
  /** The ring round the selected record, which faces the camera and pulses. */
  beacon: { inner: 1.6, outer: 2, segments: 32, opacity: 0.85, pulse: 0.12, speed: 4 },
  stars: {
    /** The side of the cube the stars are scattered in, centred on the graph. */
    spread: 500,
    seed: 7,
    dense: { count: 900, size: 2.15, opacity: 0.8 },
    sparse: { count: 350, size: 1.65, opacity: 0.6 },
  },
} as const

/**
 * What changes between the themes. Light is dark inverted: added light cannot darken a
 * pale page, so there the stars and glows are laid on normally, in dark ink, and the
 * auras are fainter so the colours stay clear of mud.
 */
export interface SceneTheme {
  background: string
  /** The stars' tint (the star texture is white) and how they are laid on. */
  stars: string
  glowBlending: typeof AdditiveBlending | typeof NormalBlending
  /** The auras' opacity, as a share of the approved values. */
  auraStrength: number
  /** The names' tint; the label texture is white. */
  label: string
  beacon: string
  links: LinkLooks
}

export const SCENE_THEMES: Readonly<Record<MapTheme, SceneTheme>> = {
  dark: {
    background: MAP_BACKGROUNDS.dark,
    stars: '#ffffff',
    glowBlending: AdditiveBlending,
    auraStrength: 1,
    label: '#ffffff',
    beacon: '#ffffff',
    links: LINK_LOOKS,
  },
  light: {
    background: MAP_BACKGROUNDS.light,
    stars: '#22231f',
    glowBlending: NormalBlending,
    auraStrength: 0.55,
    label: '#22231f',
    beacon: '#bd5b3f',
    links: LIGHT_LINK_LOOKS,
  },
}

/** Makes the scene's textures; canvasTextures in the browser, plain textures in tests. */
export interface SceneTextures {
  /** The round starlight disc. */
  star(): Texture
  /** A soft radial glow in a type's colour. */
  aura(color: string): Texture
  /** A record's name, white on transparent, 4:1 wide. */
  label(text: string): Texture
}

export interface NodeObjects {
  node: PositionedNode
  /**
   * At the record's position, scaled by nodeScale times its growth (bigger while hovered
   * or selected, highlight.ts `growthOf`); holds the four below.
   */
  group: Group
  orb: Mesh<SphereGeometry, MeshStandardMaterial>
  aura: Sprite
  proxy: Mesh<SphereGeometry, MeshBasicMaterial>
  label: Sprite
}

export interface GraphScene {
  /** Add this to the THREE.Scene; it holds the lights, stars, records and conduits. */
  root: Group
  /** For THREE.Scene.background. */
  background: Color
  theme: MapTheme
  nodes: Map<string, NodeObjects>
  /** The hit proxies, for the raycaster; nodeIdOf names the record a hit belongs to. */
  hitTargets: Mesh[]
  nodeIdOf(object: Object3D): string | undefined
  /** Every conduit in one mesh, or null when there are no links. */
  conduits: Mesh<BufferGeometry, MeshBasicMaterial> | null
  /** Each drawn link's vertices in the conduit mesh, for recolouring one (phase 03). */
  linkVertices: Map<string, { start: number; count: number }>
  bounds: GraphLayout['bounds']
  /**
   * Fits the scene to where the camera is: shows the labels near enough to read and hides
   * the rest (in a graph of more than `SCENE_STYLE.label.allUpTo` records), and gives near orbs the full sphere and far ones the coarse one. Call after
   * the camera moves; true when anything changed, so an on-demand renderer knows to draw.
   */
  updateView(cameraPosition: Vector3): boolean
  /**
   * Lights the active record and its direct connections and dims the rest (highlight.ts),
   * by swapping materials and rewriting the touched links' vertex colours, and grows the
   * hovered and selected records by their group's scale; the geometry is never changed.
   * True when anything changed, so an on-demand renderer knows to draw.
   */
  applyHighlight(state: HighlightState): boolean
  /**
   * Changes the overlay's settings on the built scene, never re-running the layout: node
   * size scales each record's group; glow retunes the materials, auras and starlight; link
   * width rebuilds only the conduits' geometry, lit as before; star density rebuilds only
   * the starfield's geometry, or hides it. What it replaces is freed. True when anything
   * changed.
   */
  applySettings(settings: SceneSettings): boolean
  /**
   * Puts the beacon ring round a record, facing the camera, at its size for `time` (in
   * seconds) times the record's scale, so it stays clear of a grown orb, or hides it for null. True while it pulses, so the caller keeps drawing; with
   * reduced motion it is a still ring.
   */
  placeBeacon(nodeId: string | null, camera: Camera, time: number, reducedMotion: boolean): boolean
  /** Removes the scene and frees every geometry, material and texture it made. */
  dispose(): void
}

export function buildGraphScene(
  layout: GraphLayout,
  links: readonly GraphLink[],
  textures: SceneTextures,
  settings: SceneSettings = SCENE_DEFAULTS,
  theme: MapTheme = 'dark',
): GraphScene {
  const colours = SCENE_THEMES[theme]
  const owned = new Set<{ dispose(): void }>()
  const own = <T extends { dispose(): void }>(thing: T): T => {
    owned.add(thing)
    return thing
  }

  const root = new Group()
  root.name = 'graph'
  root.add(...lights())

  let stars = starfield(settings, colours, textures, own)
  if (stars) root.add(stars)

  // Shared by every record of a size or a type.
  const orbGeometry = new Map<number, { near: SphereGeometry; far: SphereGeometry }>()
  const proxyGeometry = new Map<number, SphereGeometry>()
  const orbMaterial = new Map<GraphNodeType, MeshStandardMaterial>()
  const auraMaterial = new Map<GraphNodeType, SpriteMaterial>()
  const proxyMaterial = own(new MeshBasicMaterial({ transparent: true, opacity: 0 }))
  const glow = settings.glowIntensity
  const { orb: orbStyle, aura: auraStyle, hitProxy, label: labelStyle } = SCENE_STYLE

  const nodes = new Map<string, NodeObjects>()
  const hitTargets: Mesh[] = []
  const records = new Group()
  records.name = 'records'

  for (const node of layout.nodes) {
    const color = GRAPH_COLORS[node.type]
    const radius = node.radius

    let geometry = orbGeometry.get(radius)
    if (!geometry) {
      geometry = {
        near: own(new SphereGeometry(radius, orbStyle.segments, orbStyle.segments)),
        far: own(new SphereGeometry(radius, orbStyle.farSegments, orbStyle.farSegments)),
      }
      orbGeometry.set(radius, geometry)
    }
    let material = orbMaterial.get(node.type)
    if (!material) {
      material = own(
        new MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: orbStyle.emissive * glow,
          roughness: orbStyle.roughness,
          metalness: orbStyle.metalness,
          transparent: true,
          opacity: orbStyle.opacity,
        }),
      )
      orbMaterial.set(node.type, material)
    }
    // Full detail until updateView knows where the camera is.
    const orb = new Mesh(geometry.near, material)

    let auraLook = auraMaterial.get(node.type)
    if (!auraLook) {
      auraLook = own(
        new SpriteMaterial({
          map: own(textures.aura(color)),
          transparent: true,
          opacity: Math.min(1, auraStyle.opacity * glow) * colours.auraStrength,
          blending: colours.glowBlending,
          depthWrite: false,
        }),
      )
      auraMaterial.set(node.type, auraLook)
    }
    const aura = new Sprite(auraLook)
    const auraSide = radius * auraStyle.scale * glow
    aura.scale.set(auraSide, auraSide, 1)

    let hitGeometry = proxyGeometry.get(radius)
    if (!hitGeometry) {
      hitGeometry = own(
        new SphereGeometry(radius * hitProxy.scale, hitProxy.segments, hitProxy.segments),
      )
      proxyGeometry.set(radius, hitGeometry)
    }
    const proxy = new Mesh(hitGeometry, proxyMaterial)
    proxy.position.y = hitProxy.offsetY
    // Never drawn; the raycaster still finds it.
    proxy.visible = false
    proxy.userData.nodeId = node.id
    hitTargets.push(proxy)

    // Its texture is made the first time the camera comes near (updateView).
    const label = new Sprite(
      own(
        new SpriteMaterial({
          color: colours.label,
          transparent: true,
          opacity: labelStyle.opacity,
          depthWrite: false,
        }),
      ),
    )
    label.position.y = labelStyle.y
    label.scale.set(labelStyle.width, labelStyle.height, 1)
    label.visible = false

    const group = new Group()
    group.name = node.id
    group.position.set(node.x, node.y, node.z)
    group.scale.setScalar(settings.nodeScale)
    group.userData.nodeId = node.id
    group.add(orb, aura, proxy, label)
    records.add(group)
    nodes.set(node.id, { node, group, orb, aura, proxy, label })
  }
  root.add(records)

  const built = conduitMesh(layout, links, settings, colours.links.resting, own)
  const conduits = built.mesh
  const { linkVertices, drawn } = built
  if (conduits) root.add(conduits)

  const beaconStyle = SCENE_STYLE.beacon
  const beacon = new Mesh(
    own(new RingGeometry(beaconStyle.inner, beaconStyle.outer, beaconStyle.segments)),
    own(
      new MeshBasicMaterial({
        color: colours.beacon,
        side: DoubleSide,
        transparent: true,
        opacity: beaconStyle.opacity,
      }),
    ),
  )
  beacon.name = 'beacon'
  beacon.visible = false
  root.add(beacon)

  // Highlighting swaps each orb and aura to its type's material for the look, made the
  // first time it is needed; resting is the material built above.
  let current = settings
  let tunedGlow = glow
  const orbLooks = new Map<GraphNodeType, Map<NodeLook, MeshStandardMaterial>>()
  const auraLooks = new Map<GraphNodeType, Map<NodeLook, SpriteMaterial>>()
  for (const [type, material] of orbMaterial) orbLooks.set(type, new Map([['resting', material]]))
  for (const [type, material] of auraMaterial) auraLooks.set(type, new Map([['resting', material]]))
  const tune = (look: NodeLook, orb?: MeshStandardMaterial, aura?: SpriteMaterial) => {
    const values = nodeLookValues(look, tunedGlow)
    if (orb) {
      orb.opacity = values.orbOpacity
      orb.emissiveIntensity = values.orbEmissive
    }
    if (aura) aura.opacity = values.auraOpacity * colours.auraStrength
  }
  const variant = <M extends MeshStandardMaterial | SpriteMaterial>(
    looks: Map<GraphNodeType, Map<NodeLook, M>>,
    type: GraphNodeType,
    look: NodeLook,
  ): M => {
    const byLook = looks.get(type)!
    let material = byLook.get(look)
    if (!material) {
      // A clone shares the resting material's texture, which stays owned once.
      material = own(byLook.get('resting')!.clone() as M)
      byLook.set(look, material)
      if (material instanceof MeshStandardMaterial) tune(look, material)
      else tune(look, undefined, material as SpriteMaterial)
    }
    return material
  }
  const nodeLooks = new Map<string, NodeLook>()
  const growths = new Map<string, number>()
  const linkLooks: LinkLook[] = drawn.map(() => 'resting')
  const linkColor = new Color()

  let lastState: HighlightState | null = null

  const free = (thing: { dispose(): void } | null | undefined) => {
    if (thing && owned.delete(thing)) thing.dispose()
  }
  /**
   * Gives `target` the geometry of `fresh`, a stand-in that was never drawn, and frees
   * target's old geometry and fresh's material and texture.
   */
  const swapGeometry = (target: Mesh | Points, fresh: Mesh | Points) => {
    free(target.geometry)
    target.geometry = fresh.geometry
    const material = fresh.material as MeshBasicMaterial | PointsMaterial
    free(material.map)
    free(material)
  }

  let disposed = false
  const position = new Vector3()

  const scene: GraphScene = {
    root,
    background: new Color(colours.background),
    theme,
    nodes,
    hitTargets,
    nodeIdOf: (object) => object.userData.nodeId as string | undefined,
    conduits,
    linkVertices,
    bounds: layout.bounds,
    updateView(cameraPosition) {
      if (disposed) return false
      let changed = false
      const everyLabel = nodes.size <= labelStyle.allUpTo
      for (const { node, group, orb, label } of nodes.values()) {
        position.set(node.x, node.y, node.z)
        const sphere = orbGeometry.get(node.radius)!
        const detail =
          position.distanceTo(cameraPosition) <= orbStyle.detailDistance ? sphere.near : sphere.far
        if (orb.geometry !== detail) {
          orb.geometry = detail
          changed = true
        }

        position.y += labelStyle.y * group.scale.y
        const near = everyLabel || position.distanceTo(cameraPosition) <= labelStyle.maxDistance
        if (near && !label.material.map) {
          label.material.map = own(textures.label(node.name))
          label.material.needsUpdate = true
        }
        if (label.visible !== near) {
          label.visible = near
          changed = true
        }
      }
      return changed
    },
    applyHighlight(state) {
      if (disposed) return false
      let changed = false
      lastState = state
      for (const { node, group, orb, aura, label } of nodes.values()) {
        const growth = growthOf(state, node.id)
        if ((growths.get(node.id) ?? 1) !== growth) {
          growths.set(node.id, growth)
          group.scale.setScalar(current.nodeScale * growth)
          changed = true
        }
        const look = nodeLook(state, node.id)
        if ((nodeLooks.get(node.id) ?? 'resting') === look) continue
        nodeLooks.set(node.id, look)
        orb.material = variant(orbLooks, node.type, look)
        aura.material = variant(auraLooks, node.type, look)
        label.material.opacity = nodeLookValues(look, tunedGlow).labelOpacity
        changed = true
      }

      if (conduits) {
        const colors = conduits.geometry.getAttribute('color') as BufferAttribute
        let first = Infinity
        let last = -1
        drawn.forEach((link, i) => {
          const look = linkLook(state, link)
          if (linkLooks[i] === look) return
          linkLooks[i] = look
          const { color, opacity } = colours.links[look]
          linkColor.set(color)
          const { start, count } = linkVertices.get(link.id)!
          for (let k = start; k < start + count; k++) {
            colors.setXYZW(k, linkColor.r, linkColor.g, linkColor.b, opacity)
          }
          first = Math.min(first, start)
          last = Math.max(last, start + count)
        })
        if (last >= 0) {
          // Upload only the span that changed.
          colors.clearUpdateRanges()
          colors.addUpdateRange(first * 4, (last - first) * 4)
          colors.needsUpdate = true
          changed = true
        }
      }
      return changed
    },
    applySettings(next) {
      if (disposed) return false
      const previous = current
      current = next
      let changed = false

      if (next.nodeScale !== previous.nodeScale) {
        // Grown records keep their growth; the beacon reads the scale on its next placing.
        for (const { node, group } of nodes.values()) {
          group.scale.setScalar(next.nodeScale * (growths.get(node.id) ?? 1))
        }
        changed = true
      }

      if (next.glowIntensity !== previous.glowIntensity) {
        tunedGlow = next.glowIntensity
        for (const byLook of orbLooks.values()) for (const [l, m] of byLook) tune(l, m)
        for (const byLook of auraLooks.values()) for (const [l, m] of byLook) tune(l, undefined, m)
        for (const { node, aura } of nodes.values()) {
          const side = node.radius * auraStyle.scale * next.glowIntensity
          aura.scale.set(side, side, 1)
        }
        changed = true
      }

      // The stars and conduits keep their objects, materials and textures and change only
      // their geometry.
      if (next.starDensity !== previous.starDensity) {
        if (!stars) {
          stars = starfield(next, colours, textures, own)
          // Where the build put it, straight after the lights.
          if (stars) insertAt(root, stars, 2)
        } else if (next.starDensity !== 'off') {
          // A new star texture would draw on a new 2D canvas, which takes about a second
          // in a browser drawing in software; only the positions change.
          free(stars.geometry)
          stars.geometry = own(starGeometry(next.starDensity))
          stars.visible = true
        } else stars.visible = false
        changed = true
      }
      if (
        stars &&
        next.starDensity !== 'off' &&
        (next.starDensity !== previous.starDensity || next.glowIntensity !== previous.glowIntensity)
      ) {
        const density = SCENE_STYLE.stars[next.starDensity]
        const material = stars.material as PointsMaterial
        material.size = density.size * next.glowIntensity
        material.opacity = Math.min(1, density.opacity * next.glowIntensity)
      }

      if (next.linkWidth !== previous.linkWidth && conduits) {
        const rebuilt = conduitMesh(layout, links, next, colours.links.resting, own)
        swapGeometry(conduits, rebuilt.mesh!)
        linkVertices.clear()
        for (const [id, range] of rebuilt.linkVertices) linkVertices.set(id, range)
        // The new mesh is built at rest; light it as the old one was.
        linkLooks.fill('resting')
        if (lastState) scene.applyHighlight(lastState)
        changed = true
      }
      return changed
    },
    placeBeacon(nodeId, camera, time, reducedMotion) {
      const objects = nodeId === null || disposed ? undefined : nodes.get(nodeId)
      if (!objects) {
        beacon.visible = false
        return false
      }
      const { node, group } = objects
      beacon.visible = true
      beacon.position.set(node.x, node.y, node.z)
      beacon.quaternion.copy(camera.quaternion)
      const pulse = reducedMotion ? 1 : 1 + beaconStyle.pulse * Math.sin(beaconStyle.speed * time)
      const side = pulse * group.scale.x
      beacon.scale.set(side, side, 1)
      return !reducedMotion
    },
    dispose() {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      for (const thing of owned) thing.dispose()
      owned.clear()
      nodes.clear()
      hitTargets.length = 0
      linkVertices.clear()
    },
  }
  return scene
}

/** Adds a child at a place in the parent's list, so the drawing order stays as built. */
function insertAt(parent: Group, child: Object3D, index: number) {
  parent.add(child)
  parent.children.pop()
  parent.children.splice(index, 0, child)
}

/**
 * Points the camera at the graph's bounds from the opening direction, close enough that
 * the whole sphere fits the narrower side of the view. Returns the point to orbit.
 */
export function fitCameraToBounds(
  camera: PerspectiveCamera,
  bounds: GraphLayout['bounds'],
  margin = 1.15,
): Vector3 {
  const center = new Vector3(bounds.center.x, bounds.center.y, bounds.center.z)
  const distance = framingDistance(camera, bounds, margin)
  const { x, y, z } = SCENE_STYLE.cameraDirection
  camera.position.copy(center).addScaledVector(new Vector3(x, y, z).normalize(), distance)
  camera.far = Math.max(SCENE_STYLE.camera.far, distance + bounds.radius * 2)
  camera.updateProjectionMatrix()
  camera.lookAt(center)
  return center
}

/** How far from the bounds' centre the camera must be for the whole sphere to fit the view. */
export function framingDistance(
  camera: PerspectiveCamera,
  bounds: GraphLayout['bounds'],
  margin = 1.15,
): number {
  const halfHeight = MathUtils.degToRad(camera.fov) / 2
  const halfWidth = Math.atan(Math.tan(halfHeight) * camera.aspect)
  return (bounds.radius * margin) / Math.sin(Math.min(halfHeight, halfWidth))
}

/** Canvas-drawn textures, as in the prototype; the browser only. */
export function canvasTextures(doc: Document = document): SceneTextures {
  const draw = (width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) => {
    const canvas = doc.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) paint(ctx)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return texture
  }
  const radial = (size: number, stops: [number, string][]) =>
    draw(size, size, (ctx) => {
      const half = size / 2
      const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
      for (const [at, color] of stops) gradient.addColorStop(at, color)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
    })

  return {
    star: () =>
      radial(64, [
        [0, '#ffffff'],
        [0.2, '#ffffff'],
        [0.45, 'rgba(165, 215, 255, 0.75)'],
        [0.75, 'rgba(130, 190, 255, 0.25)'],
        [1, 'rgba(0, 0, 0, 0)'],
      ]),
    aura: (color) =>
      radial(256, [
        [0, rgba(color, 1)],
        [0.22, rgba(color, 0.9)],
        [0.5, rgba(color, 0.5)],
        [0.78, rgba(color, 0.18)],
        [1, 'rgba(0, 0, 0, 0)'],
      ]),
    label: (text) =>
      draw(256, 64, (ctx) => {
        ctx.fillStyle = '#ffffff'
        ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(fitText(ctx, text, 244), 128, 40)
      }),
  }
}

/** Shortens text with an ellipsis until it is at most `width` pixels wide. */
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  const chars = [...text]
  while (chars.length > 1 && ctx.measureText(`${chars.join('').trimEnd()}…`).width > width) {
    chars.pop()
  }
  return `${chars.join('').trimEnd()}…`
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function lights() {
  const { ambient, directional, directionalFrom } = SCENE_STYLE.lights
  const sun = new DirectionalLight(0xffffff, directional)
  sun.position.set(directionalFrom.x, directionalFrom.y, directionalFrom.z)
  return [new AmbientLight(0xffffff, ambient), sun]
}

function starfield(
  settings: SceneSettings,
  theme: SceneTheme,
  textures: SceneTextures,
  own: <T extends { dispose(): void }>(thing: T) => T,
): Points | null {
  if (settings.starDensity === 'off') return null
  const look = SCENE_STYLE.stars[settings.starDensity]
  const geometry = own(starGeometry(settings.starDensity))
  const material = own(
    new PointsMaterial({
      color: theme.stars,
      size: look.size * settings.glowIntensity,
      map: own(textures.star()),
      transparent: true,
      opacity: Math.min(1, look.opacity * settings.glowIntensity),
      blending: theme.glowBlending,
      depthWrite: false,
    }),
  )
  const points = new Points(geometry, material)
  points.name = 'stars'
  return points
}

/** The stars' positions for a density. */
function starGeometry(density: Exclude<StarDensity, 'off'>): BufferGeometry {
  const { spread, seed } = SCENE_STYLE.stars
  // Seeded, so the sky is the same on every visit.
  const random = mulberry32(seed)
  const positions = new Float32Array(SCENE_STYLE.stars[density].count * 3)
  for (let i = 0; i < positions.length; i++) positions[i] = (random() - 0.5) * spread
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  return geometry
}

/**
 * Every link as a thin open tube, centre to centre, in one geometry. Colour and opacity
 * are per vertex (RGBA), so highlighting can light up one link by rewriting its range.
 */
function conduitMesh(
  layout: GraphLayout,
  links: readonly GraphLink[],
  settings: SceneSettings,
  resting: { color: string; opacity: number },
  own: <T extends { dispose(): void }>(thing: T) => T,
) {
  const linkVertices = new Map<string, { start: number; count: number }>()
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  const drawn = links.filter((link) => byId.has(link.source) && byId.has(link.target))
  if (drawn.length === 0) return { mesh: null, linkVertices, drawn }

  const { sides } = SCENE_STYLE.conduit
  const { opacity } = resting
  const color = new Color(resting.color)
  const perLink = sides * 2
  const positions = new Float32Array(drawn.length * perLink * 3)
  const colors = new Float32Array(drawn.length * perLink * 4)
  const index = new Uint32Array(drawn.length * sides * 6)

  const a = new Vector3()
  const b = new Vector3()
  const along = new Vector3()
  const u = new Vector3()
  const v = new Vector3()
  const offset = new Vector3()

  drawn.forEach((link, i) => {
    const source = byId.get(link.source)!
    const target = byId.get(link.target)!
    a.set(source.x, source.y, source.z)
    b.set(target.x, target.y, target.z)
    along.subVectors(b, a)
    if (along.lengthSq() === 0) along.set(0, 1, 0)
    along.normalize()
    // Any two directions square to the link and to each other span the tube's ring.
    u.set(0, 1, 0)
    if (Math.abs(along.y) > 0.99) u.set(1, 0, 0)
    u.cross(along).normalize()
    v.crossVectors(along, u)

    const first = i * perLink
    for (let k = 0; k < sides; k++) {
      const angle = (k / sides) * Math.PI * 2
      offset
        .copy(u)
        .multiplyScalar(Math.cos(angle) * settings.linkWidth)
        .addScaledVector(v, Math.sin(angle) * settings.linkWidth)
      const near = first + k * 2
      positions.set([a.x + offset.x, a.y + offset.y, a.z + offset.z], near * 3)
      positions.set([b.x + offset.x, b.y + offset.y, b.z + offset.z], (near + 1) * 3)

      const next = first + ((k + 1) % sides) * 2
      index.set([near, near + 1, next, next, near + 1, next + 1], (i * sides + k) * 6)
    }
    for (let k = first; k < first + perLink; k++) {
      colors.set([color.r, color.g, color.b, opacity], k * 4)
    }
    linkVertices.set(link.id, { start: first, count: perLink })
  })

  const geometry = own(new BufferGeometry())
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 4))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  const material = own(new MeshBasicMaterial({ vertexColors: true, transparent: true }))
  const mesh = new Mesh(geometry, material)
  mesh.name = 'conduits'
  return { mesh, linkVertices, drawn }
}

/** A small seeded random number generator: the same seed, the same numbers. */
function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
