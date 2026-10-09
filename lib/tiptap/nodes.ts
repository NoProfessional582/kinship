/** Shared node-name and attribute contract between the editor and the server. */

export const CONTACT_MENTION = 'contactMention'
export const ENTITY_REF = 'entityRef'

export const PENDING_PREFIX = 'new:'

export type EntityKind = 'task' | 'project'

export function isPendingId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(PENDING_PREFIX)
}

export function makePendingId(): string {
  return `${PENDING_PREFIX}${crypto.randomUUID()}`
}
