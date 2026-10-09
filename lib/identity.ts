import { ConfigurationError } from './errors'

/**
 * Kinship is single-user: every request and every CLI command acts as the one
 * owner named by `KINSHIP_OWNER`. No request header is read for identity, so a
 * client cannot claim to be someone else by sending one.
 *
 * The owner string is stored on every row (the `owner` column), so changing it
 * later hides existing data rather than moving it.
 */
export type Identity = Readonly<{ subject: string }>

export const OWNER_MISSING_MESSAGE =
  'KINSHIP_OWNER is not set. Set it to any fixed name for the single owner (for example "me") and restart.'

/** The configured owner. Missing or blank refuses with a clear message. */
export function ownerSubject(): string {
  const subject = process.env.KINSHIP_OWNER?.trim()
  if (!subject) throw new ConfigurationError(OWNER_MISSING_MESSAGE)
  return subject
}

/** Identity for a route handler. The request is accepted for the call shape only; it is never read. */
export function requireIdentity(_request: Request): Identity {
  return { subject: ownerSubject() }
}

/** Identity for maintenance CLIs that have no HTTP request (seed, import, export). */
export function requireConfiguredOwner(): string {
  return ownerSubject()
}
