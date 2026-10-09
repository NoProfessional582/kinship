'use client'
import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  LayoutDashboard, NotebookPen, Users, KanbanSquare,
  CalendarDays, Search, Moon, Sun, FolderKanban, Settings, Trash2,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUi } from '@/lib/store'
import { CommandPalette } from './command-palette'
import { EnrichmentQueue } from '@/components/entity-modal/enrichment-queue'
import { useFontScale, useSettings } from '@/lib/hooks/settings'
import { useModifierKey } from '@/lib/hooks/platform'

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, hue: 'var(--hue-1)' },
  { href: '/notes', label: 'Notes', icon: NotebookPen, hue: 'var(--hue-6)' },
  { href: '/contacts', label: 'Contacts', icon: Users, hue: 'var(--hue-2)' },
  { href: '/board', label: 'Board', icon: KanbanSquare, hue: 'var(--hue-3)' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, hue: 'var(--hue-5)' },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, hue: 'var(--hue-4)' },
  { href: '/trash', label: 'Trash', icon: Trash2, hue: 'var(--muted-foreground)' },
]

const STORE_KEY = 'kb.sidebar.collapsed'
/** Below this the rail costs more than it gives, so it starts collapsed. */
const NARROW = '(max-width: 1024px)'

/**
 * `null` until the effect resolves the stored preference. Rendering a boolean
 * during SSR would mean guessing the viewport, so the first paint keeps the
 * pure-CSS behaviour (icons under `sm`, labels above) and the resolved state
 * takes over on mount.
 */
type Collapsed = boolean | null

/**
 * Anything that handles its own typing: form fields and the rich-text composer.
 * A window-level shortcut must stand aside for these rather than preventDefault
 * a keystroke the focused element has already acted on.
 */
function ownsKeystrokes(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const settings = useSettings()
  const mod = useModifierKey()
  useFontScale()

  const [collapsed, setCollapsed] = React.useState<Collapsed>(null)

  React.useEffect(() => {
    let stored: string | null = null
    try { stored = window.localStorage.getItem(STORE_KEY) } catch { /* private mode */ }
    // The window wins on load. A stored "expanded" is a preference formed on a
    // wide screen, and honouring it here is how an 820px window ends up
    // spending a quarter of its width on navigation. It can still be expanded
    // by hand once you are here.
    setCollapsed(window.matchMedia(NARROW).matches || stored === 'true')
  }, [])

  // Narrowing the window collapses the rail; widening it does not force it back
  // open, because by then the last explicit choice is the better guess.
  React.useEffect(() => {
    const mq = window.matchMedia(NARROW)
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setCollapsed(true) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !(prev ?? false)
      try { window.localStorage.setItem(STORE_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') { e.preventDefault(); setPaletteOpen(true) }
      // Cmd+B is the composer's own bold shortcut. ProseMirror handles it on the
      // editor element and lets it bubble, so an unguarded window listener
      // collapsed the sidebar on every bold keystroke — and persisted it.
      if (key === 'b' && !ownsKeystrokes(e.target)) { e.preventDefault(); toggle() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen, toggle])

  // Three states, not two: `null` keeps the responsive classes it rendered with.
  const wide = collapsed === false
  const narrow = collapsed === true
  // Two variants of the same rule: some labels sit in a block, one in a flex row.
  const label = cn(narrow && 'hidden', wide && 'block', collapsed === null && 'hidden sm:block')
  const labelFlex = cn(narrow && 'hidden', wide && 'flex', collapsed === null && 'hidden sm:flex')

  return (
    <div className="flex h-screen justify-center overflow-hidden">
      {/* Rail and page are one block, centred together. Pinning the rail to the
          window instead left an ultrawide monitor showing navigation hard
          against the left bezel and the content adrift somewhere right of
          centre; the shell is sized to page + rail so the pair stays put. */}
      <div
        className="kb-shell flex h-full w-full max-w-[calc(var(--page-max)+var(--rail-w))]"
        data-collapsed={narrow ? 'true' : wide ? 'false' : undefined}
      >
        <aside
          className={cn(
            'flex shrink-0 flex-col gap-1 border-r border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_75%,transparent)] py-3 backdrop-blur-sm transition-[width] duration-200',
            narrow && 'w-14 items-center',
            wide && 'w-52 items-stretch px-3',
            collapsed === null && 'w-14 items-center sm:w-52 sm:items-stretch sm:px-3',
          )}
        >
          <div className={cn('mb-3 flex items-center gap-2', narrow ? 'px-1' : 'px-1 sm:px-2')}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-sm font-bold text-white [background:linear-gradient(135deg,var(--hue-1),var(--hue-6))]">
              {settings.appTitle.slice(0, 1).toUpperCase()}
            </div>
            <span className={cn('display truncate text-[15px] font-semibold', label)}>
              {settings.appTitle}
            </span>
            {!narrow && (
              <button
                onClick={toggle}
                title={`Collapse sidebar (${mod}B)`}
                aria-label="Collapse sidebar"
                className={cn(
                  'ml-auto shrink-0 rounded-[var(--radius-sm)] p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
                  label,
                )}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )}
          </div>

          {narrow && (
            <button
              onClick={toggle}
              title={`Expand sidebar (${mod}B)`}
              aria-label="Expand sidebar"
              className="mb-1 flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={() => setPaletteOpen(true)}
            title={`Search (${mod}K)`}
            className={cn(
              'mb-2 flex items-center gap-2 rounded-lg border border-[var(--border)] text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]',
              narrow ? 'h-8 w-8 justify-center' : 'px-2 py-1.5',
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className={cn('flex-1 text-left', label)}>Search…</span>
            <kbd className={cn('rounded border border-[var(--border)] px-1 text-[10px]', label)}>{mod}K</kbd>
          </button>

          <nav className={cn('flex flex-1 flex-col gap-0.5', narrow && 'items-center')}>
            {NAV.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  style={active ? { background: `color-mix(in oklch, ${item.hue} 14%, transparent)`, color: item.hue } : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-[var(--radius-md)] text-sm transition-colors',
                    narrow ? 'h-9 w-9 justify-center' : 'px-2.5 py-2',
                    active ? 'font-semibold'
                           : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className={label}>{item.label}</span>
                </Link>
              )
            })}
          </nav>

          <Link
            href="/settings"
            title="Settings"
            className={cn(
              'flex items-center gap-2.5 rounded-[var(--radius-md)] text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]',
              narrow ? 'h-9 w-9 justify-center' : 'px-2.5 py-2',
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className={cn('min-w-0 flex-1 truncate text-left', label)}>Settings</span>
          </Link>

          <ThemeToggle compact={narrow} labelClass={label} />

          <div
            className={cn(
              'items-center gap-1.5 pt-1 text-[11px] text-[var(--muted-foreground)]',
              narrow ? 'flex justify-center' : cn('px-2.5', labelFlex),
            )}
            title={settings.userName}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" />
            <span className={cn('truncate', label)}>{settings.userName}</span>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <CommandPalette />
      <EnrichmentQueue />
    </div>
  )
}

function ThemeToggle({ compact, labelClass }: { compact: boolean; labelClass: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className={cn(
        'flex items-center gap-2.5 rounded-lg text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]',
        compact ? 'h-9 w-9 justify-center' : 'px-2 py-2',
      )}
      title="Toggle theme"
    >
      {mounted && resolvedTheme === 'dark'
        ? <Sun className="h-4 w-4 shrink-0" />
        : <Moon className="h-4 w-4 shrink-0" />}
      <span className={labelClass}>Theme</span>
    </button>
  )
}
