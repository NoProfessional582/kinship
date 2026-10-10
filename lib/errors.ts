/**
 * Domain errors the API layer knows how to translate. Deliberately free of any
 * `next/server` import: the services that throw these are also loaded by the
 * seed script and by the node-environment test suite, neither of which should
 * have to pull the HTTP layer in behind them.
 */

/**
 * A refusal the caller can act on — "move the cards out of this column first" —
 * rather than a fault. `handle` renders it as a 409 with the message intact,
 * instead of the 500 every unrecognised throw becomes.
 */
export class ConflictError extends Error {
  readonly status = 409

  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

/**
 * The record the caller named does not exist, or belongs to someone else.
 * `handle` renders it as a 404, the same answer Prisma's own "record not
 * found" (P2025) gets, so a missing record reads the same however it was looked up.
 */
export class NotFoundError extends Error {
  readonly status = 404

  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

/**
 * A request the caller got wrong in a way Zod cannot express — "an entity
 * cannot relate to itself", a field that is only required for one action.
 * `handle` renders it as a 400. Thrown as a bare Error these came back as 500s:
 * the message reached the toast either way, but a client mistake was logged as
 * a server fault and would trip any 5xx alerting.
 */
export class ValidationError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * The request body is bigger than this route is willing to hold.
 *
 * Distinct from ValidationError because the caller's remedy is different — send
 * less, rather than send something else — and because a 400 is what a
 * *truncated* body already produced ("That file is not JSON"), which read as
 * "your archive is corrupt" when the real answer was "it was too big and we
 * threw the end of it away". See lib/body-limit.ts.
 */
export class PayloadTooLargeError extends Error {
  readonly status = 413

  constructor(maxBytes: number) {
    super(`Request body too large. The maximum is ${Math.floor(maxBytes / (1024 * 1024))} MB.`)
    this.name = 'PayloadTooLargeError'
  }
}

/**
 * The server is missing a setting it cannot run without (e.g. `KINSHIP_OWNER`).
 * `handle` renders it as a 500 with the message intact, so the operator sees
 * what to fix.
 */
export class ConfigurationError extends Error {
  readonly status = 500

  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}
