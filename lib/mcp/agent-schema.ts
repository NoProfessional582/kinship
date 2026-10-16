import { z } from 'zod'

/**
 * A REST schema, reshaped as a tool's input schema. MCP clients are told a tool's input as
 * JSON Schema, and a zod date has none, so dates become strings here. Defaults go too
 * (a default can be a date, or a function), leaving the field optional. Transforms and
 * refinements on the whole object stay behind as well.
 *
 * Nothing is lost by it: every write tool parses its arguments again with the REST
 * route's own schema before calling the service, which coerces the dates, fills the
 * defaults and applies every check, exactly as the route does.
 */

/** Keeps a schema's description (and other metadata) on its reshaped copy. */
function keepMeta<S extends z.ZodType>(from: z.ZodType, to: S): S {
  const meta = from.meta()
  return meta ? to.meta(meta) : to
}

/** One schema, reshaped (see above). */
export function forAgents(schema: z.ZodType): z.ZodType {
  let out: z.ZodType
  if (schema instanceof z.ZodDate) {
    out = z.string().min(1).meta({ description: 'An ISO 8601 date (2026-03-10) or date-time.' })
  } else if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    out = forAgents(schema.unwrap() as z.ZodType).optional()
  } else if (schema instanceof z.ZodNullable) {
    out = forAgents(schema.unwrap() as z.ZodType).nullable()
  } else if (schema instanceof z.ZodPipe) {
    // A date is `string | number | Date` piped into a coerced date; a link is a string
    // piped into a transform. Either way the input side is what the agent sends.
    out = forAgents((schema.out instanceof z.ZodDate ? schema.out : schema.in) as z.ZodType)
  } else if (schema instanceof z.ZodArray) {
    out = z.array(forAgents(schema.element as z.ZodType))
  } else if (schema instanceof z.ZodObject) {
    out = z.object(agentShape(schema.shape))
  } else {
    return schema
  }
  return keepMeta(schema, out)
}

/**
 * A tool's input shape from a REST object schema's shape, without `omit`. With
 * `partial`, every field is optional: an update tool's "leave this as it is".
 */
export function agentShape(
  shape: Record<string, z.ZodType>,
  { omit = [], partial = false }: { omit?: string[]; partial?: boolean } = {},
): Record<string, z.ZodType> {
  return Object.fromEntries(
    Object.entries(shape)
      .filter(([key]) => !omit.includes(key))
      .map(([key, field]) => {
        const reshaped = forAgents(field)
        return [key, partial && !reshaped.isOptional() ? reshaped.optional() : reshaped]
      }),
  )
}
