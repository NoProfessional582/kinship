// Copies the packages the command-line jobs need, and nothing else, from a full
// install of the lockfile into the image's /app/cli/node_modules (Dockerfile, cli
// stage). The npm scripts would otherwise carry every package the web app has.
//
//   node docker/cli-modules.mjs FROM TO
//
// FROM holds the sources and the full node_modules; TO/node_modules is created.
// The packages are what esbuild finds the CLI's entry points import, plus the
// Prisma CLI and tsx the npm scripts call, with every dependency of each, as
// installed. scripts/test-stack.sh runs every command against the result.
import { build } from 'esbuild'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
} from 'node:fs'
import path from 'node:path'

const [from, to] = process.argv.slice(2).map((dir) => path.resolve(dir))
if (!from || !to) {
  console.error('usage: node docker/cli-modules.mjs FROM TO')
  process.exit(2)
}

const entryPoints = [
  'prisma/seed.ts',
  'prisma/archive.ts',
  'prisma/import-linkedin.ts',
  'prisma.config.ts',
]
const { metafile } = await build({
  absWorkingDir: from,
  entryPoints,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'unused', // nothing is written
  write: false,
  metafile: true,
  logLevel: 'error',
})

const roots = new Set(['prisma', 'tsx'])
for (const input of Object.keys(metafile.inputs)) {
  const match = input.match(/^node_modules\/((?:[@.][^/]+\/)?[^/]+)\//)
  // .prisma/client, the generated client, counts as a package like @scope/name.
  if (match) roots.add(match[1])
}

// resolve: where Node finds package NAME from directory DIR, as it does at run time.
const resolve = (name, dir) => {
  for (let at = dir; ; at = path.dirname(at)) {
    const candidate = path.join(at, 'node_modules', name)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
    if (at === from) return null
  }
}

const keep = new Set()
const visit = (dir) => {
  if (keep.has(dir)) return
  keep.add(dir)
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const optional = { ...manifest.optionalDependencies, ...manifest.peerDependencies }
  for (const name of Object.keys({ ...manifest.dependencies, ...optional })) {
    const found = resolve(name, dir)
    if (found) visit(found)
    else if (!(name in optional)) throw new Error(`${dir}: dependency ${name} is not installed`)
  }
}
for (const root of roots) {
  const found = resolve(root, from)
  if (!found) throw new Error(`${root} is not installed`)
  visit(found)
}

// A package inside one already kept (its own node_modules) comes along with it.
const dirs = [...keep].sort()
const top = dirs.filter((dir) => !dirs.some((other) => dir.startsWith(other + path.sep)))
for (const dir of top) {
  cpSync(dir, path.join(to, path.relative(from, dir)), { recursive: true, verbatimSymlinks: true })
}

// The commands npm scripts call (prisma, tsx) are links in node_modules/.bin.
const bin = path.join(from, 'node_modules', '.bin')
mkdirSync(path.join(to, 'node_modules', '.bin'), { recursive: true })
for (const name of readdirSync(bin)) {
  const target = readlinkSync(path.join(bin, name))
  if (existsSync(path.resolve(to, 'node_modules', '.bin', target))) {
    symlinkSync(target, path.join(to, 'node_modules', '.bin', name))
  }
}

console.log(`cli-modules: ${top.length} packages for ${[...roots].sort().join(', ')}`)
