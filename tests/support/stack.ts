/**
 * What the Playwright tests need to know about the running test stack
 * (scripts/test-stack.sh): where the app is, and the records the seed (prisma/seed.ts)
 * made, which the stack script runs before Playwright.
 *
 * Imports nothing from the app: the tests run in the Playwright image, where the app's
 * native modules (Prisma's engines, sharp) are not installed.
 */
import { expect, type APIRequestContext } from '@playwright/test'

export const BASE_URL = process.env.BASE_URL ?? 'http://web:3000'

/** Records prisma/seed.ts makes, by the names the pages show. */
export const SEEDED = {
  contact: 'Maya Okafor',
  project: 'Website redesign',
  note: 'Kickoff call — website redesign',
} as const

export type SeededIds = Record<keyof typeof SEEDED, string>

/** The seeded records' ids, read through the API, as the pages read them. */
export async function seededIds(api: APIRequestContext): Promise<SeededIds> {
  const idOf = async (path: string, field: string, value: string) => {
    const response = await api.get(path)
    expect(response.status(), `GET ${path}`).toBe(200)
    const rows = (await response.json()) as Record<string, unknown>[]
    const row = rows.find((r) => r[field] === value)
    expect(row, `GET ${path} lists ${value}`).toBeTruthy()
    return String(row!.id)
  }
  return {
    contact: await idOf('/api/contacts', 'displayName', SEEDED.contact),
    project: await idOf('/api/projects', 'name', SEEDED.project),
    note: await idOf('/api/entries', 'title', SEEDED.note),
  }
}
