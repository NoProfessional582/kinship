export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || 'untitled'
}

type SlugModel = 'contact' | 'task' | 'project'

interface SlugDelegate {
  findFirst(args: { where: { owner: string; slug: string }; select: { id: true } }): Promise<{ id: string } | null>
}

export type SlugClient = Record<SlugModel, SlugDelegate>

/**
 * Returns a slug guaranteed unique for the model: `sarah-chen`, `sarah-chen-2`, …
 *
 * The client is an explicit parameter rather than a default import so this
 * module never pulls in a database connection — callers are always inside a
 * transaction anyway, and passing `tx` is what keeps the check and the insert
 * in the same one.
 *
 * `taken` lets a single transaction reserve several slugs before any of them
 * have been written, which is what stops two new contacts in one note from
 * both claiming `sarah-chen`.
 */
export async function uniqueSlug(
  model: SlugModel,
  owner: string,
  input: string,
  client: SlugClient,
  taken: Set<string> = new Set(),
): Promise<string> {
  const base = slugify(input)
  const delegate = client[model]

  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    if (taken.has(candidate)) continue
    const existing = await delegate.findFirst({ where: { owner, slug: candidate }, select: { id: true } })
    if (!existing) {
      taken.add(candidate)
      return candidate
    }
  }

  const fallback = `${base}-${Date.now()}`
  taken.add(fallback)
  return fallback
}
