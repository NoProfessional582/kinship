'use client'
import * as React from 'react'

/**
 * The label inside a calendar event.
 *
 * Every part of it is clipped to the block. With overlapping events sharing a
 * day column between them, a block can be squeezed to a couple of dozen pixels,
 * and text that overflowed would paint across its neighbours and outside the
 * rounded shape. Showing nothing at that size is the correct outcome — the
 * tooltip is what carries the detail.
 */
export function EventChip({
  tint,
  time,
  title,
}: {
  tint: string
  time?: string | null
  title: string
}) {
  return (
    <div className="kb-ev" style={{ ['--ev' as any]: tint }}>
      {time && <span className="kb-ev-time">{time}</span>}
      <span className="kb-ev-title">{title}</span>
    </div>
  )
}
