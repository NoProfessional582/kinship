/**
 * The vocabulary of `EntityEdge.relation`. Deliberately free of any Prisma or
 * node import — the same reason `calendar-categories` exists — so a client
 * component can name or label a relation without pulling the database driver
 * into the browser bundle.
 */

/**
 * "This entry continues that one", written as an edge from the follow-up back
 * to the conversation that promised it.
 *
 * A follow-up used to be a bare `Entry.followUpAt` timestamp, which could not
 * hold the agenda you agreed on, could not carry a different set of people
 * than the original, and had no way to say the conversation had happened. It
 * is an entry now — dated forward, empty until you write it up — and this is
 * the only thing tying the two together.
 */
export const FOLLOWS_UP = 'follows-up'

/**
 * How a relation reads from the far end. Edges are returned in both
 * directions, and "follows-up" on the row of the note *being* followed up says
 * the opposite of what happened.
 */
const INVERSE: Record<string, string> = {
  [FOLLOWS_UP]: 'followed up by',
}

/**
 * Free-text relations keep the arrow they always had: "mentor" read backwards
 * is anyone's guess, and pretending otherwise would be worse than admitting the
 * direction.
 */
export const relationLabel = (relation: string, direction: 'in' | 'out') =>
  direction === 'out' ? relation : INVERSE[relation] ?? `← ${relation}`
