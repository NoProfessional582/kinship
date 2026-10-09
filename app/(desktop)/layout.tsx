import { AppShell } from '@/components/shared/app-shell'

/**
 * The desktop GUI's frame. This used to live in the root layout; it moved down
 * here when the mobile GUI arrived at `app/m`, so that the two trees can carry
 * different chrome without either one branching on a device.
 *
 * A route group adds no URL segment, so every page under it keeps the path it
 * has always had: `/`, `/board`, `/contacts/ada-lovelace` and the rest.
 */
export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
