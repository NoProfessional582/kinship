import {
  AdditiveBlending,
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
    scene.updateLabels(new Vector3())
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

  it('shows labels only near the camera, making each texture once', () => {
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
    const { textures, made } = fakeTextures()
    const scene = buildGraphScene(layout, [], textures)
    const label = (id: string) => scene.nodes.get(id)!.label
    expect(label(near.id).visible).toBe(false)

    expect(scene.updateLabels(new Vector3(0, 0, 50))).toBe(true)
    expect(label(near.id).visible).toBe(true)
    expect(label(far.id).visible).toBe(false)
    expect(made.filter((m) => m.kind === 'label').map((m) => m.arg)).toEqual(['Record near'])

    expect(scene.updateLabels(new Vector3(0, 0, 50))).toBe(false)
    expect(scene.updateLabels(new Vector3(190, 0, 0))).toBe(true)
    expect(label(near.id).visible).toBe(false)
    expect(label(far.id).visible).toBe(true)
    scene.updateLabels(new Vector3(0, 0, 50))
    expect(made.filter((m) => m.kind === 'label')).toHaveLength(2)
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
    scene.updateLabels(new Vector3(0, 0, 0))

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
    expect(scene.updateLabels(new Vector3())).toBe(false)
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
