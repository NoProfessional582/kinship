import { ValidationError } from './errors'

type TaskLink = { id: string; parentTaskId?: string | null }

/** Iterative traversal: safe for deep trees and reports each stored cycle once. */
export function taskCycles(rows: TaskLink[]): string[][] {
  const parents = new Map(rows.map((r) => [r.id, r.parentTaskId]))
  const done = new Set<string>()
  const cycles: string[][] = []
  for (const row of rows) {
    const chain: string[] = []
    const indices = new Map<string, number>()
    let id: string | null | undefined = row.id
    while (id && parents.has(id) && !done.has(id)) {
      const index = indices.get(id)
      if (index !== undefined) {
        cycles.push(chain.slice(index))
        break
      }
      indices.set(id, chain.length)
      chain.push(id)
      id = parents.get(id)
    }
    for (const visited of chain) done.add(visited)
  }
  return cycles
}

export function assertTaskTree(rows: TaskLink[]): void {
  if (taskCycles(rows).length) throw new ValidationError('Task parents must not form a cycle.')
}
