import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { agentShape, forAgents } from '@/lib/mcp/agent-schema'
import { createEntrySchema, upsertContactSchema } from '@/lib/validation'

const json = (shape: Record<string, z.ZodType>) =>
  z.toJSONSchema(z.object(shape), { io: 'input' }) as {
    properties: Record<string, Record<string, unknown>>
    required?: string[]
  }

describe('a REST schema as a tool input schema', () => {
  it('turns dates into strings, at any depth, and keeps descriptions', () => {
    const shape = agentShape(upsertContactSchema.shape)
    const schema = json(shape)
    expect(schema.properties.birthday.anyOf).toContainEqual(
      expect.objectContaining({ type: 'string' }),
    )
    const position = (schema.properties.positions.items as { properties: Record<string, unknown> })
      .properties
    expect(JSON.stringify(position.startDate)).toContain('"string"')
    expect(forAgents(z.date().meta({ description: 'When' })).meta()?.description).toBe('When')
  })

  it('drops defaults, so only truly required fields are required', () => {
    expect(json(agentShape(upsertContactSchema.shape)).required).toEqual(['displayName'])
    const entry = json(agentShape(createEntrySchema.shape, { omit: ['bodyJson'] }))
    expect(entry.required ?? []).toEqual([])
    expect(entry.properties.occurredAt).not.toHaveProperty('default')
  })

  it('makes every field optional for an update', () => {
    expect(json(agentShape(upsertContactSchema.shape, { partial: true })).required).toBeUndefined()
  })

  it('leaves a link as the string the agent sends', () => {
    const links = json(agentShape(upsertContactSchema.shape)).properties.links
    expect(JSON.stringify(links)).toContain('"url":{"type":"string"')
  })
})
