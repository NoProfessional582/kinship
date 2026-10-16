import { handle, readJson } from '@/lib/api'
import { createContact, listContacts } from '@/lib/services/contacts'
import { upsertContactSchema } from '@/lib/validation'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const p = new URL(req.url).searchParams
  return handle(() =>
    listContacts(owner, {
      q: p.get('q') ?? undefined,
      draftsOnly: p.get('drafts') === '1',
      tag: p.get('tag') ?? undefined,
    }),
  )
}

export async function POST(req: Request) {
  const owner = requireIdentity(req).subject
  return handle(async () => createContact(owner, upsertContactSchema.parse(await readJson(req))))
}
