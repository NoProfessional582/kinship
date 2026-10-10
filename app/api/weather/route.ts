import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireIdentity } from '@/lib/identity'

export const dynamic = 'force-dynamic'

/**
 * Ambient weather for the dashboard, proxied through the server so the browser
 * never talks to a third party directly and the location stays server-side.
 * Disabled by default: it is the only feature that reaches outside the machine.
 */
export async function GET(req: Request) {
  const owner = requireIdentity(req).subject
  const settings = await prisma.settings.findFirst({
    where: { owner },
    select: { weatherEnabled: true, weatherLocation: true, weatherUnit: true },
  })

  if (!settings?.weatherEnabled) {
    return NextResponse.json({ enabled: false })
  }

  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(settings.weatherLocation)}&count=1`,
      { next: { revalidate: 3600 } },
    )
    const place = (await geo.json())?.results?.[0]
    if (!place) return NextResponse.json({ enabled: true, error: 'Location not found' })

    const unit = settings.weatherUnit === 'celsius' ? 'celsius' : 'fahrenheit'
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,weather_code&temperature_unit=${unit}&timezone=auto`,
      { next: { revalidate: 900 } },
    )
    const data = await res.json()

    return NextResponse.json({
      enabled: true,
      location: place.name,
      temperature: Math.round(data?.current?.temperature_2m ?? 0),
      unit: unit === 'celsius' ? 'C' : 'F',
      code: data?.current?.weather_code ?? null,
    })
  } catch {
    // A weather outage must never take the dashboard with it.
    return NextResponse.json({ enabled: true, error: 'Weather unavailable' })
  }
}
