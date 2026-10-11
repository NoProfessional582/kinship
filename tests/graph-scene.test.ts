import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Sprite,
  Texture,
  Vector2,
  Vector3,
  type Object3D,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { GRAPH_COLORS, type GraphLink, type GraphNode } from '@/lib/graph/constants'
import { highlightState, neighbourSets } from '@/lib/graph/highlight'
import { NODE_RADIUS, compute3DLayout, type GraphLayout } from '@/lib/graph/layout3d'
import {
  SCENE_DEFAULTS,
  SCENE_STYLE,
  buildGraphScene,
  fitCameraToBounds,
  type SceneTextures,
} from '@/lib/graph/scene'

const node = (id: string, type: GraphNode['type']): GraphNode => ({
  id: `${type}:${id}`,
  entityId: id,
  type,
  name: `Record ${id}`,
  color: GRAPH_COLORS[type],
  url: type === 'tag' ? null : `/${type}s/${id}`,
})

const link = (source: GraphNode, target: GraphNode, relation = 'mentions'): GraphLink => ({
  id: `${source.id}>${target.id}>${relation}`,
  source: source.id,
  target: target.id,
  relation,
  origins: ['Mention'],
})

/** One record of every type, a few links between them, and one lone tag. */
function sample() {
  const nodes = [
    node('c', 'contact'),
    node('p', 'project'),
    node('e', 'entry'),
    node('t', 'task'),
    node('g', 'tag'),
    node('lone', 'tag'),
  ]
  const [c, p, e, t, g] = nodes
  const links = [link(e, c), link(e, p, 'references'), link(t, c, 'assigned to'), link(c, g)]
  return { nodes, links, layout: compute3DLayout(nodes, links) }
}

/** Plain textures that record what was asked for. */
function fakeTextures() {
  const made: { kind: string; arg?: string; texture: Texture }[] = []
  const make = (kind: string, arg?: string) => {
    const texture = new Texture()
    made.push({ kind, arg, texture })
    return texture
  }
  const textures: SceneTextures = {
    star: () => make('star'),
    aura: (color) => make('aura', color),
    label: (text) => make('label', text),
  }
  return { textures, made }
}

/** Every geometry, material and texture reachable from the scene, except three's shared sprite quad. */
function resources(root: Object3D) {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    const drawable = object as Partial<Mesh>
    if (drawable.geometry && !(object instanceof Sprite)) geometries.add(drawable.geometry)
    const material = drawable.material
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      materials.add(m)
      const map = (m as Material & { map?: Texture | null }).map
      if (map) textures.add(map)
    }
  })
  return { geometries, materials, textures }
}

describe('buildGraphScene', () => {
  it('makes one orb, aura, hit proxy and label per record, one conduit per link', () => {
    const { links, layout } = sample()
    const scene = buildGraphScene(layout, links, fakeTextures().textures)

    expect([...scene.nodes.keys()]).toEqual(layout.nodes.map((n) => n.id))
    for (const { node, group, orb, aura, proxy, label } of scene.nodes.values()) {
      expect(group.children).toEqual([orb, aura, proxy, label])
      expect(group.position.toArray()).toEqual([node.x, node.y, node.z])
    }
    expect(scene.hitTargets).toHaveLength(layout.nodes.length)
    expect(scene.hitTargets.map((p) => scene.nodeIdOf(p))).toEqual(layout.nodes.map((n) => n.id))

    const perLink = SCENE_STYLE.conduit.sides * 2
    expect([...scene.linkVertices]).toEqual(
      links.map((l, i) => [l.id, { start: i * perLink, count: perLink }]),
    )
    const geometry = scene.conduits!.geometry
    expect(geometry.getAttribute('position').count).toBe(links.length * perLink)
    expect(geometry.getIndex()!.count).toBe(links.length * SCENE_STYLE.conduit.sides * 6)
  })

  it('carries the approved values', () => {
    const { links, layout } = sample()
    const scene = buildGraphScene(layout, links, fakeTextures().textures)
    expect(SCENE_DEFAULTS).toEqual({
      nodeScale: 0.8,
      linkWidth: 0.1,
      glowIntensity: 1,
      starDensity: 'dense',
    })
    expect(scene.background.getHexString()).toBe('080a0e')

    for (const { node, group, orb, aura, proxy, label } of scene.nodes.values()) {
      const radius = NODE_RADIUS[node.type]
      expect(group.scale.toArray()).toEqual([0.8, 0.8, 0.8])

      expect(orb.geometry.parameters.radius).toBe(radius)
      const look = orb.material
      expect(look).toBeInstanceOf(MeshStandardMaterial)
      expect(look.color.getHexString()).toBe(GRAPH_COLORS[node.type].slice(1))
      expect(look.emissive.getHexString()).toBe(GRAPH_COLORS[node.type].slice(1))
      expect(look.emissiveIntensity).toBe(0.45)
      expect(look.opacity).toBe(0.95)
      expect(look.transparent).toBe(true)

      expect(aura.scale.x).toBeCloseTo(radius * 4.33)
      expect(aura.scale.y).toBeCloseTo(radius * 4.33)
      expect(aura.material.opacity).toBe(0.7)
      expect(aura.material.blending).toBe(AdditiveBlending)
      expect(aura.material.depthWrite).toBe(false)

      expect(proxy.geometry.parameters.radius).toBeCloseTo(radius * 2.8)
      expect(proxy.position.y).toBe(1.2)
      expect(proxy.visible).toBe(false)

      expect(label.position.y).toBe(3.2)
      expect(label.scale.toArray()).toEqual([10.5, 2.6, 1])
      expect(label.material.opacity).toBe(0.9)
    }

    // Conduits: 0.10 thin, slate at 0.55, every vertex.
    const positions = scene.conduits!.geometry.getAttribute('position')
    const colors = scene.conduits!.geometry.getAttribute('color')
    const slate = new Color(SCENE_STYLE.conduit.color)
    expect(SCENE_STYLE.conduit.color).toBe('#5a6372')
    for (let i = 0; i < colors.count; i++) {
      expect(colors.getX(i)).toBeCloseTo(slate.r)
      expect(colors.getW(i)).toBeCloseTo(0.55)
    }
    const [first] = links
    const a = scene.nodes.get(first.source)!.node
    const b = scene.nodes.get(first.target)!.node
    const axis = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize()
    for (let i = 0; i < SCENE_STYLE.conduit.sides * 2; i += 2) {
      const vertex = new Vector3().fromBufferAttribute(positions, i)
      const fromA = vertex.sub(new Vector3(a.x, a.y, a.z))
      // Square to the link, 0.10 out from its line.
      expect(fromA.dot(axis)).toBeCloseTo(0, 4)
      expect(fromA.length()).toBeCloseTo(0.1, 4)
    }

    const stars = scene.root.getObjectByName('stars') as Points<BufferGeometry, PointsMaterial>
    expect(stars.geometry.getAttribute('position').count).toBe(900)
    expect(stars.material.size).toBe(2.15)
    expect(stars.material.opacity).toBe(0.8)
    expect(stars.material.blending).toBe(AdditiveBlending)
  })

  it('applies other settings and sparse or no stars', () => {
    const { links, layout } = sample()
    const settings = {
      nodeScale: 1.2,
      linkWidth: 0.3,
      glowIntensity: 2,
      starDensity: 'sparse' as const,
    }
    const scene = buildGraphScene(layout, links, fakeTextures().textures, settings)
    const { node, group, orb, aura } = scene.nodes.values().next().value!
    expect(group.scale.x).toBe(1.2)
    expect(orb.material.emissiveIntensity).toBe(0.9)
    expect(aura.material.opacity).toBe(1)
    expect(aura.scale.x).toBeCloseTo(node.radius * 4.33 * 2)
    const stars = scene.root.getObjectByName('stars') as Points<BufferGeometry, PointsMaterial>
    expect(stars.geometry.getAttribute('position').count).toBe(350)
    expect(stars.material.size).toBe(3.3)
    expect(stars.material.opacity).toBe(1)

    const off = buildGraphScene(layout, links, fakeTextures().textures, {
      ...settings,
      starDensity: 'off',
    })
    expect(off.root.getObjectByName('stars')).toBeUndefined()
  })

  it('shares geometries and materials by size and type', () => {
    const { links, layout } = sample()
    const { textures, made } = fakeTextures()
    const scene = buildGraphScene(layout, links, textures)
    const all = [...scene.nodes.values()]
    expect(new Set(all.map((n) => n.orb.geometry)).size).toBe(2)
    expect(new Set(all.map((n) => n.proxy.geometry)).size).toBe(2)
    expect(new Set(all.map((n) => n.orb.material)).size).toBe(5)
    expect(new Set(all.map((n) => n.aura.material)).size).toBe(5)
    expect(made.filter((m) => m.kind === 'aura').map((m) => m.arg)).toEqual(
      Object.values(GRAPH_COLORS),
    )
    expect(made.filter((m) => m.kind === 'star')).toHaveLength(1)
  })

  it('does not change the layout or the links', () => {
    const { links, layout } = sample()
    const before = structuredClone({ layout, links })
    const scene = buildGraphScene(layout, links, fakeTextures().textures)
    scene.updateView(new Vector3())
    scene.dispose()
    expect({ layout, links }).toEqual(before)
  })

  it('handles a graph with no links and skips a link to a record it does not have', () => {
    const { layout } = sample()
    const none = buildGraphScene(layout, [], fakeTextures().textures)
    expect(none.conduits).toBeNull()
    const ghost = link(layout.nodes[0], node('gone', 'entry'))
    const one = buildGraphScene(
      layout,
      [ghost, link(layout.nodes[0], layout.nodes[1])],
      fakeTextures().textures,
    )
    expect([...one.linkVertices.keys()]).toEqual([
      `${layout.nodes[0].id}>${layout.nodes[1].id}>mentions`,
    ])
  })

  it('shows every label in a small graph, wherever the camera is', () => {
    const { layout } = sample()
    const scene = buildGraphScene(layout, [], fakeTextures().textures)
    expect(scene.updateView(new Vector3(5000, 0, 0))).toBe(true)
    for (const { label } of scene.nodes.values()) expect(label.visible).toBe(true)
    scene.dispose()
  })

  it('in a big graph, shows labels only near the camera, making each texture once', () => {
    const near = node('near', 'contact')
    const far = node('far', 'contact')
    // Enough records, far from both cameras below, that the graph counts as big.
    const crowd = Array.from({ length: SCENE_STYLE.label.allUpTo }, (_, i) => ({
      ...node(`crowd${i}`, 'tag'),
      x: 100,
      y: 1000 + i * 5,
      z: 0,
      radius: 1.25,
    }))
    const layout: GraphLayout = {
      nodes: [
        { ...near, x: 0, y: 0, z: 0, radius: 1.6 },
        { ...far, x: 200, y: 0, z: 0, radius: 1.6 },
        ...crowd,
      ],
      bounds: { center: { x: 0, y: 0, z: 0 }, radius: 202 },
      scale: 1,
      iterations: 0,
    }
    const { textures, made } = fakeTextures()
    const scene = buildGraphScene(layout, [], textures)
    const label = (id: string) => scene.nodes.get(id)!.label
    expect(label(near.id).visible).toBe(false)

    expect(scene.updateView(new Vector3(0, 0, 50))).toBe(true)
    expect(label(near.id).visible).toBe(true)
    expect(label(far.id).visible).toBe(false)
    expect(made.filter((m) => m.kind === 'label').map((m) => m.arg)).toEqual(['Record near'])

    expect(scene.updateView(new Vector3(0, 0, 50))).toBe(false)
    expect(scene.updateView(new Vector3(190, 0, 0))).toBe(true)
    expect(label(near.id).visible).toBe(false)
    expect(label(far.id).visible).toBe(true)
    scene.updateView(new Vector3(0, 0, 50))
    expect(made.filter((m) => m.kind === 'label')).toHaveLength(2)
  })

  it('gives near orbs the full sphere and far ones the coarse one', () => {
    const near = node('near', 'contact')
    const far = node('far', 'contact')
    const layout: GraphLayout = {
      nodes: [
        { ...near, x: 0, y: 0, z: 0, radius: 1.6 },
        { ...far, x: 200, y: 0, z: 0, radius: 1.6 },
      ],
      bounds: { center: { x: 0, y: 0, z: 0 }, radius: 202 },
      scale: 1,
      iterations: 0,
    }
    const scene = buildGraphScene(layout, [], fakeTextures().textures)
    const segments = (id: string) => scene.nodes.get(id)!.orb.geometry.parameters.widthSegments
    const { segments: full, farSegments: coarse, detailDistance } = SCENE_STYLE.orb
    expect([segments(near.id), segments(far.id)]).toEqual([full, full])

    expect(scene.updateView(new Vector3(0, 0, detailDistance - 1))).toBe(true)
    expect([segments(near.id), segments(far.id)]).toEqual([full, coarse])
    expect(scene.nodes.get(far.id)!.orb.geometry.parameters.radius).toBe(1.6)
    expect(scene.updateView(new Vector3(200, 0, 10))).toBe(true)
    expect([segments(near.id), segments(far.id)]).toEqual([coarse, full])
    expect(scene.updateView(new Vector3(200, 0, 10))).toBe(false)
    scene.dispose()
  })

  it('lets a raycast find a record by its hit proxy, though the proxy is never drawn', () => {
    const { links, layout } = sample()
    const scene = buildGraphScene(layout, links, fakeTextures().textures)
    const world = new Scene()
    world.add(scene.root)
    world.updateMatrixWorld()
    const target = layout.nodes[0]
    const camera = new PerspectiveCamera(46, 1, 0.1, 1000)
    camera.position.set(target.x, target.y + 1, target.z + 30)
    camera.lookAt(target.x, target.y + 1, target.z)
    camera.updateMatrixWorld()
    const ray = new Raycaster()
    ray.setFromCamera(new Vector2(0, 0), camera)
    const [hit] = ray.intersectObjects(scene.hitTargets, false)
    expect(scene.nodeIdOf(hit.object)).toBe(target.id)
  })

  it('dispose frees every geometry, material and texture it made, once', () => {
    const { links, layout } = sample()
    const { textures, made } = fakeTextures()
    const scene = buildGraphScene(layout, links, textures)
    const parent = new Scene()
    parent.add(scene.root)
    scene.updateView(new Vector3(0, 0, 0))

    const found = resources(scene.root)
    // Every texture the factory made is reachable, labels included.
    expect(found.textures).toEqual(new Set(made.map((m) => m.texture)))
    const spies = [...found.geometries, ...found.materials, ...found.textures].map((thing) =>
      vi.spyOn(thing, 'dispose'),
    )
    expect(spies.length).toBeGreaterThan(20)

    scene.dispose()
    scene.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(scene.root.parent).toBeNull()
    expect(scene.nodes.size).toBe(0)
    expect(scene.hitTargets).toHaveLength(0)
    expect(scene.updateView(new Vector3())).toBe(false)
  })
})

describe('applyHighlight', () => {
  /** The sample's scene, and its state for a hovered and a selected record. */
  function lit() {
    const { nodes, links, layout } = sample()
    const scene = buildGraphScene(layout, links, fakeTextures().textures)
    const neighbours = neighbourSets(links)
    const state = (hoveredId: string | null, selectedId: string | null = null) =>
      highlightState({ hoveredId, selectedId, neighbours })
    const [c, p, e, t, g, lone] = nodes.map((n) => scene.nodes.get(n.id)!)
    const colors = () => Array.from(scene.conduits!.geometry.getAttribute('color').array)
    return { scene, links, state, c, p, e, t, g, lone, colors }
  }
  const perLink = SCENE_STYLE.conduit.sides * 2
  /** A link's colour and opacity, read from its first vertex. */
  const linkRgba = (colors: number[], index: number) =>
    colors.slice(index * perLink * 4, index * perLink * 4 + 4)
  const rgba = (hex: string, opacity: number) => {
    const { r, g, b } = new Color(hex)
    return [r, g, b, opacity].map((n) => Math.fround(n))
  }

  it('changes nothing at rest: the scene stays exactly as built', () => {
    const { scene, state, c, colors } = lit()
    const before = colors()
    const material = c.orb.material
    expect(scene.applyHighlight(state(null))).toBe(false)
    expect(c.orb.material).toBe(material)
    expect(colors()).toEqual(before)
  })

  it('lights a hovered record and its connections and dims the rest', () => {
    const { scene, state, c, p, e, t, g, lone, colors } = lit()
    expect(scene.applyHighlight(state(e.node.id))).toBe(true)

    expect(e.orb.material.opacity).toBe(1)
    expect(e.orb.material.emissiveIntensity).toBe(0.7)
    expect(e.label.material.opacity).toBe(1)
    expect(e.aura.material.opacity).toBe(0.9)
    for (const near of [c, p]) {
      expect(near.orb.material.opacity).toBe(0.95)
      expect(near.orb.material.emissiveIntensity).toBe(0.45)
      expect(near.label.material.opacity).toBe(0.95)
      expect(near.aura.material.opacity).toBe(0.7)
    }
    for (const far of [t, g, lone]) {
      expect(far.orb.material.opacity).toBe(0.35)
      expect(far.orb.material.emissiveIntensity).toBe(0.08)
      expect(far.label.material.opacity).toBe(0.3)
      expect(far.aura.material.opacity).toBe(0.15)
    }
    // Each kept its type's colour; only the look changed.
    expect(e.orb.material.color.getHexString()).toBe(GRAPH_COLORS.entry.slice(1))

    // Links e-c and e-p touch the hovered record; t-c and c-g do not.
    const now = colors()
    expect(linkRgba(now, 0)).toEqual(rgba('#a5b4fc', 1))
    expect(linkRgba(now, 1)).toEqual(rgba('#a5b4fc', 1))
    expect(linkRgba(now, 2)).toEqual(rgba('#404854', 0.2))
    expect(linkRgba(now, 3)).toEqual(rgba('#404854', 0.2))
  })

  it('dims harder for a selection, rewriting only the links whose look changed', () => {
    const { scene, state, e, t, colors } = lit()
    scene.applyHighlight(state(e.node.id))
    const attribute = scene.conduits!.geometry.getAttribute('color') as BufferAttribute
    const version = attribute.version
    expect(scene.applyHighlight(state(t.node.id, e.node.id))).toBe(true)

    expect(t.orb.material.opacity).toBe(0.12)
    expect(t.label.material.opacity).toBe(0.1)
    expect(t.aura.material.opacity).toBe(0.05)
    expect(e.orb.material.opacity).toBe(1)
    expect(linkRgba(colors(), 2)).toEqual(rgba('#404854', 0.04))
    // The two lit links stayed lit, so only links 2 and 3 were sent to the GPU again.
    expect(attribute.version).toBeGreaterThan(version)
    expect(attribute.updateRanges).toEqual([{ start: 2 * perLink * 4, count: 2 * perLink * 4 }])

    // Nothing changed, nothing to draw. (Dropping the hover on t would shrink it back.)
    expect(scene.applyHighlight(state(t.node.id, e.node.id))).toBe(false)
  })

  it('goes back to the built materials and colours at rest, and reuses its looks', () => {
    const { scene, state, c, e, colors } = lit()
    const before = colors()
    const resting = c.orb.material
    const restingAura = c.aura.material
    scene.applyHighlight(state(e.node.id))
    const neighbourLook = c.orb.material
    expect(neighbourLook).not.toBe(resting)

    scene.applyHighlight(state(null))
    expect(c.orb.material).toBe(resting)
    expect(c.aura.material).toBe(restingAura)
    expect(c.label.material.opacity).toBe(0.9)
    expect(colors()).toEqual(before)

    scene.applyHighlight(state(e.node.id))
    expect(c.orb.material).toBe(neighbourLook)
  })

  it('shares each look by type, so a big graph makes a handful of materials', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => node(`${i}`, 'contact'))
    const links = nodes.slice(1).map((n) => link(nodes[0], n))
    const scene = buildGraphScene(compute3DLayout(nodes, links), links, fakeTextures().textures)
    scene.applyHighlight(
      highlightState({
        hoveredId: nodes[1].id,
        selectedId: null,
        neighbours: neighbourSets(links),
      }),
    )
    const looks = new Set([...scene.nodes.values()].map((o) => o.orb.material))
    // The hovered record, its one connection (the hub), and everyone else.
    expect(looks.size).toBe(3)
  })

  it('scales the lit looks with glow', () => {
    const { scene, state, c, e } = lit()
    scene.applyHighlight(state(e.node.id))
    scene.applySettings({ ...SCENE_DEFAULTS, glowIntensity: 2 })
    expect(e.orb.material.emissiveIntensity).toBe(1.4)
    expect(e.aura.material.opacity).toBe(1)
    expect(c.orb.material.emissiveIntensity).toBe(0.9)
    scene.applyHighlight(state(null))
    scene.applySettings({ ...SCENE_DEFAULTS, glowIntensity: 0.5 })
    expect(c.orb.material.emissiveIntensity).toBe(0.225)
    expect(c.aura.material.opacity).toBe(0.35)
  })

  it('dispose frees the look materials too, but not the textures they share', () => {
    const { scene, state, e } = lit()
    scene.applyHighlight(state(e.node.id))
    const inUse = resources(scene.root)
    const spies = [...inUse.materials, ...inUse.textures].map((m) => vi.spyOn(m, 'dispose'))
    scene.applyHighlight(state(null))
    scene.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(scene.applyHighlight(state(e.node.id))).toBe(false)
  })
})

describe('growth', () => {
  function grown() {
    const { nodes, links, layout } = sample()
    const scene = buildGraphScene(layout, links, fakeTextures().textures)
    const neighbours = neighbourSets(links)
    const state = (hoveredId: string | null, selectedId: string | null = null) =>
      highlightState({ hoveredId, selectedId, neighbours })
    const [c, p, e] = nodes.map((n) => scene.nodes.get(n.id)!)
    const sizes = () => [...scene.nodes.values()].map(({ group }) => group.scale.x)
    return { scene, state, c, p, e, sizes }
  }
  const s = SCENE_DEFAULTS.nodeScale

  it('grows a hovered record 1.2x and a selected one 1.35x, in all three directions', () => {
    const { scene, state, c, e } = grown()
    expect(scene.applyHighlight(state(e.node.id))).toBe(true)
    expect(e.group.scale.toArray()).toEqual([s * 1.2, s * 1.2, s * 1.2])
    expect(c.group.scale.x).toBe(s)
    scene.applyHighlight(state(c.node.id, e.node.id))
    expect(e.group.scale.x).toBe(s * 1.35)
    expect(c.group.scale.x).toBe(s * 1.2)
  })

  it('returns every record to its size at rest, and moves none of them', () => {
    const { scene, state, e, sizes } = grown()
    const places = [...scene.nodes.values()].map(({ group }) => group.position.toArray())
    scene.applyHighlight(state(null, e.node.id))
    expect(scene.applyHighlight(state(null))).toBe(true)
    expect(sizes().every((size) => size === s)).toBe(true)
    expect([...scene.nodes.values()].map(({ group }) => group.position.toArray())).toEqual(places)
  })

  it('reports a change when only the growth changes', () => {
    const { scene, state, c, e } = grown()
    // Selected e; hovering c changes no look (c stays dimmed) but grows c.
    scene.applyHighlight(state(null, e.node.id))
    expect(scene.applyHighlight(state(c.node.id, e.node.id))).toBe(true)
    expect(scene.applyHighlight(state(c.node.id, e.node.id))).toBe(false)
  })

  it('keeps its growth through a node size change', () => {
    const { scene, state, c, e } = grown()
    scene.applyHighlight(state(c.node.id, e.node.id))
    scene.applySettings({ ...SCENE_DEFAULTS, nodeScale: 2 })
    expect(e.group.scale.x).toBe(2 * 1.35)
    expect(c.group.scale.x).toBe(2 * 1.2)
    scene.applyHighlight(state(null))
    expect(e.group.scale.x).toBe(2)
  })

  it('grows the beacon with the selected record, so the ring stays outside its orb', () => {
    const { scene, state, c } = grown()
    scene.applyHighlight(state(null, c.node.id))
    scene.placeBeacon(c.node.id, new PerspectiveCamera(), 0, true)
    const beacon = scene.root.getObjectByName('beacon')!
    expect(beacon.scale.x).toBeCloseTo(s * 1.35)
    // The ring's inner edge is at least the orb's radius.
    expect(SCENE_STYLE.beacon.inner * beacon.scale.x).toBeGreaterThanOrEqual(
      c.node.radius * c.group.scale.x,
    )
  })
})

describe('applySettings', () => {
  function built() {
    const { nodes, links, layout } = sample()
    const scene = buildGraphScene(layout, links, fakeTextures().textures)
    new Scene().add(scene.root)
    const stars = () =>
      scene.root.getObjectByName('stars') as Points<BufferGeometry, PointsMaterial> | undefined
    return { nodes, links, layout, scene, stars }
  }
  /** How far a link's first vertex is from its line: the conduit's radius. */
  function conduitRadius(scene: ReturnType<typeof built>['scene'], links: GraphLink[]) {
    const [first] = links
    const a = scene.nodes.get(first.source)!.node
    const at = scene.linkVertices.get(first.id)!.start
    const vertex = new Vector3().fromBufferAttribute(
      scene.conduits!.geometry.getAttribute('position'),
      at,
    )
    return vertex.distanceTo(new Vector3(a.x, a.y, a.z))
  }

  it('changes nothing for the settings it already has', () => {
    const { scene } = built()
    const conduits = scene.conduits
    expect(scene.applySettings({ ...SCENE_DEFAULTS })).toBe(false)
    expect(scene.conduits).toBe(conduits)
  })

  it('scales every record and the beacon by node size, without moving them', () => {
    const { scene } = built()
    const before = [...scene.nodes.values()].map(({ group }) => group.position.toArray())
    expect(scene.applySettings({ ...SCENE_DEFAULTS, nodeScale: 1.5 })).toBe(true)
    const after = [...scene.nodes.values()]
    for (const { group } of after) expect(group.scale.toArray()).toEqual([1.5, 1.5, 1.5])
    expect(after.map(({ group }) => group.position.toArray())).toEqual(before)

    const camera = new PerspectiveCamera()
    scene.placeBeacon(after[0].node.id, camera, 0, true)
    expect(scene.root.getObjectByName('beacon')!.scale.x).toBe(1.5)
  })

  it('retunes radiance, auras and starlight with glow, in place', () => {
    const { scene, stars } = built()
    const points = stars()!
    expect(scene.applySettings({ ...SCENE_DEFAULTS, glowIntensity: 2 })).toBe(true)
    for (const { node, orb, aura } of scene.nodes.values()) {
      expect(orb.material.emissiveIntensity).toBe(0.9)
      expect(aura.material.opacity).toBe(1)
      expect(aura.scale.x).toBeCloseTo(node.radius * 4.33 * 2)
    }
    expect(stars()).toBe(points)
    expect(points.material.size).toBe(4.3)
    expect(points.material.opacity).toBe(1)

    // Back to the approved look exactly.
    scene.applySettings({ ...SCENE_DEFAULTS })
    for (const { node, orb, aura } of scene.nodes.values()) {
      expect(orb.material.emissiveIntensity).toBe(0.45)
      expect(aura.material.opacity).toBe(0.7)
      expect(aura.scale.x).toBeCloseTo(node.radius * 4.33)
    }
    expect(points.material.size).toBe(2.15)
    expect(points.material.opacity).toBe(0.8)
  })

  it('rebuilds only the starfield geometry for a new density, freeing the old one', () => {
    const { scene, stars } = built()
    const records = scene.root.getObjectByName('records')
    const points = stars()!
    const { geometry, material } = points
    const texture = material.map!
    const spies = [geometry, material, texture].map((thing) => vi.spyOn(thing, 'dispose'))
    scene.applySettings({ ...SCENE_DEFAULTS, starDensity: 'sparse' })
    // The same points, material and texture, so the renderer compiles nothing new.
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual([1, 0, 0])
    expect(stars()).toBe(points)
    expect(points.material).toBe(material)
    expect(material.map).toBe(texture)
    expect(points.geometry.getAttribute('position').count).toBe(350)
    expect(material.size).toBe(1.65)
    expect(material.opacity).toBe(0.6)
    expect(scene.root.getObjectByName('records')).toBe(records)

    scene.applySettings({ ...SCENE_DEFAULTS, starDensity: 'off' })
    expect(points.visible).toBe(false)
    scene.applySettings({ ...SCENE_DEFAULTS, starDensity: 'dense', glowIntensity: 2 })
    expect(points.visible).toBe(true)
    expect(points.geometry.getAttribute('position').count).toBe(900)
    expect(material.size).toBe(4.3)
  })

  it('adds a starfield to a scene built without one', () => {
    const { links, layout } = sample()
    const scene = buildGraphScene(layout, links, fakeTextures().textures, {
      ...SCENE_DEFAULTS,
      starDensity: 'off',
    })
    scene.applySettings({ ...SCENE_DEFAULTS, starDensity: 'sparse' })
    const stars = scene.root.getObjectByName('stars') as Points<BufferGeometry, PointsMaterial>
    expect(stars.geometry.getAttribute('position').count).toBe(350)
    // Straight after the two lights, where a build puts it.
    expect(scene.root.children.indexOf(stars)).toBe(2)
  })

  it('rebuilds only the conduits geometry for a new link width, lit as before', () => {
    const { nodes, links, scene } = built()
    const neighbours = neighbourSets(links)
    scene.applyHighlight(highlightState({ hoveredId: null, selectedId: nodes[2].id, neighbours }))
    const old = scene.conduits!
    const colors = Array.from(old.geometry.getAttribute('color').array)
    const ranges = scene.linkVertices
    const { geometry, material } = old
    const spies = [geometry, material].map((thing) => vi.spyOn(thing, 'dispose'))
    const orbs = [...scene.nodes.values()].map(({ orb }) => orb.material)

    expect(scene.applySettings({ ...SCENE_DEFAULTS, linkWidth: 0.3 })).toBe(true)
    // A new geometry in the same mesh, with the same material.
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual([1, 0])
    expect(scene.conduits).toBe(old)
    expect(old.geometry).not.toBe(geometry)
    expect(old.material).toBe(material)
    expect(conduitRadius(scene, links)).toBeCloseTo(0.3, 4)
    // The same map, the same ranges, and the selection's colours carried over.
    expect(scene.linkVertices).toBe(ranges)
    expect([...ranges.keys()].sort()).toEqual(links.map((l) => l.id).sort())
    expect(Array.from(scene.conduits!.geometry.getAttribute('color').array)).toEqual(colors)
    expect([...scene.nodes.values()].map(({ orb }) => orb.material)).toEqual(orbs)

    // Back at rest, the new mesh's links go back to the resting colour.
    scene.applyHighlight(highlightState({ hoveredId: null, selectedId: null, neighbours }))
    const slate = new Color(SCENE_STYLE.conduit.color)
    const rest = scene.conduits!.geometry.getAttribute('color')
    for (let i = 0; i < rest.count; i++) {
      expect(rest.getX(i)).toBeCloseTo(slate.r)
      expect(rest.getW(i)).toBeCloseTo(0.55)
    }
  })

  it('frees everything it replaces, so repeated changes leak nothing', () => {
    const { scene } = built()
    const seen = new Map<{ dispose(): void }, ReturnType<typeof vi.spyOn>>()
    const watch = () => {
      const { geometries, materials, textures } = resources(scene.root)
      for (const thing of [...geometries, ...materials, ...textures]) {
        if (!seen.has(thing)) seen.set(thing, vi.spyOn(thing, 'dispose'))
      }
      return geometries.size + materials.size + textures.size
    }
    const start = watch()
    const densities = ['sparse', 'off', 'dense'] as const
    for (let i = 0; i < 12; i++) {
      scene.applySettings({
        nodeScale: 0.8 + i * 0.1,
        linkWidth: 0.05 + (i % 4) * 0.02,
        glowIntensity: 0.6 + (i % 5) * 0.3,
        starDensity: densities[i % 3],
      })
      expect(watch()).toBe(start)
    }
    scene.dispose()
    // Every geometry, material and texture the scene ever showed, freed exactly once.
    for (const spy of seen.values()) expect(spy).toHaveBeenCalledTimes(1)
    expect(scene.applySettings({ ...SCENE_DEFAULTS })).toBe(false)
  })

  it('leaves a graph with no links without conduits', () => {
    const one = [node('solo', 'contact')]
    const scene = buildGraphScene(compute3DLayout(one, []), [], fakeTextures().textures)
    expect(scene.applySettings({ ...SCENE_DEFAULTS, linkWidth: 0.3 })).toBe(false)
    expect(scene.conduits).toBeNull()
  })
})

describe('placeBeacon', () => {
  function withBeacon() {
    const { links, layout } = sample()
    const scene = buildGraphScene(layout, links, fakeTextures().textures)
    const beacon = scene.root.getObjectByName('beacon') as Mesh
    const camera = new PerspectiveCamera()
    camera.position.set(10, 20, 30)
    camera.lookAt(0, 0, 0)
    return { scene, beacon, camera, id: layout.nodes[0].id, node: layout.nodes[0] }
  }

  it('is a hidden white ring until a record is selected', () => {
    const { beacon } = withBeacon()
    expect(beacon.visible).toBe(false)
    const ring = beacon.geometry as BufferGeometry & {
      parameters: { innerRadius: number; outerRadius: number; thetaSegments: number }
    }
    expect(ring.parameters).toMatchObject({ innerRadius: 1.6, outerRadius: 2, thetaSegments: 32 })
    const look = beacon.material as Material & { color: Color; opacity: number }
    expect(look.color.getHexString()).toBe('ffffff')
    expect(look.opacity).toBe(0.85)
    expect(look.side).toBe(2)
  })

  it('sits on the record, faces the camera, and pulses', () => {
    const { scene, beacon, camera, id, node } = withBeacon()
    const time = Math.PI / 8
    expect(scene.placeBeacon(id, camera, time, false)).toBe(true)
    expect(beacon.visible).toBe(true)
    expect(beacon.position.toArray()).toEqual([node.x, node.y, node.z])
    expect(beacon.quaternion.equals(camera.quaternion)).toBe(true)
    const side = 0.8 * (1 + 0.12 * Math.sin(4 * time))
    expect(beacon.scale.x).toBeCloseTo(side)
    expect(beacon.scale.y).toBeCloseTo(side)
    expect(beacon.scale.z).toBe(1)
  })

  it('holds still with reduced motion, and asks for no more frames', () => {
    const { scene, beacon, camera, id } = withBeacon()
    expect(scene.placeBeacon(id, camera, 1.234, true)).toBe(false)
    expect(beacon.visible).toBe(true)
    expect(beacon.scale.toArray()).toEqual([0.8, 0.8, 1])
  })

  it('hides for no selection or a record the scene does not have', () => {
    const { scene, beacon, camera, id } = withBeacon()
    scene.placeBeacon(id, camera, 0, false)
    expect(scene.placeBeacon(null, camera, 0, false)).toBe(false)
    expect(beacon.visible).toBe(false)
    scene.placeBeacon(id, camera, 0, false)
    expect(scene.placeBeacon('contact:gone', camera, 0, false)).toBe(false)
    expect(beacon.visible).toBe(false)
  })
})

describe('fitCameraToBounds', () => {
  it('frames the whole bounds from the opening direction', () => {
    const camera = new PerspectiveCamera(46, 16 / 9, 0.1, 1000)
    const bounds = { center: { x: 0, y: 0, z: 0 }, radius: 50 }
    const target = fitCameraToBounds(camera, bounds)
    expect(target.toArray()).toEqual([0, 0, 0])

    const distance = camera.position.length()
    // The sphere's edge is inside the vertical half-angle (the narrower one here).
    expect(Math.asin(50 / distance)).toBeLessThan((46 / 2) * (Math.PI / 180))
    const dir = camera.position.clone().normalize()
    expect(dir.x).toBeCloseTo(0)
    expect(dir.y / dir.z).toBeCloseTo(32 / 120)
    expect(camera.far).toBeGreaterThanOrEqual(distance + 50)
  })

  it('backs further off on a narrow, tall view', () => {
    const bounds = { center: { x: 0, y: 0, z: 0 }, radius: 50 }
    const wide = new PerspectiveCamera(46, 2, 0.1, 1000)
    const tall = new PerspectiveCamera(46, 0.5, 0.1, 1000)
    fitCameraToBounds(wide, bounds)
    fitCameraToBounds(tall, bounds)
    expect(tall.position.length()).toBeGreaterThan(wide.position.length())
  })
})

describe('three stays out of server code', () => {
  it('is imported by no API route, service or server module', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return files(full)
        return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
      })
    const server = [
      ...files('app/api'),
      ...files('lib/services'),
      'lib/graph/normalize.ts',
      'lib/graph/focus.ts',
    ]
    const importsThree = server.filter((file) =>
      /from ['"]three(\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8')),
    )
    expect(server.length).toBeGreaterThan(10)
    expect(importsThree).toEqual([])
  })
})
