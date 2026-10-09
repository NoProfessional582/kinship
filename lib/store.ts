'use client'
import { create } from 'zustand'
import type { CreatedEntity } from './services/entries'

interface EnrichmentState {
  queue: CreatedEntity[]
  index: number
  /** Drains the queue one entity at a time, as specified. */
  enqueue: (entities: CreatedEntity[]) => void
  advance: () => void
  dismiss: () => void
}

export const useEnrichmentQueue = create<EnrichmentState>((set) => ({
  queue: [],
  index: 0,
  enqueue: (entities) =>
    set(entities.length ? { queue: entities, index: 0 } : { queue: [], index: 0 }),
  advance: () =>
    set((s) => (s.index + 1 >= s.queue.length ? { queue: [], index: 0 } : { index: s.index + 1 })),
  dismiss: () => set({ queue: [], index: 0 }),
}))

interface UiState {
  paletteOpen: boolean
  setPaletteOpen: (v: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}))
