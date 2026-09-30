import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Ellipsis, PanelLeftClose, PanelLeftOpen, Plus, X, type LucideIcon } from 'lucide-react'
import { AppFooter } from '../components/AppFooter'
import HeaderUserMenu from '../components/HeaderUserMenu'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { BrandMark } from '../components/BrandMark'
import { InstallAppButton, InstallAppHint } from '../components/InstallApp'
import { useInstallState } from '../lib/install'

export interface ShellNavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Match the path exactly (index routes) instead of as a prefix. */
  end?: boolean
}

export interface ShellNavSection {
  title?: string
  items: ShellNavItem[]
}

export interface ShellQuickAction {
  label: string
  icon: LucideIcon
  onSelect: () => void
}

interface AppShellProps {
  /** Header content after the logo: household switcher, back link, section name. */
  context?: ReactNode
  /** Header actions shown before the user menu. */
  actions?: ReactNode
  /** Main navigation. Rendered as sidebar (lg+), icon rail (sm–lg) and the phone "More" drawer. */
  sections?: ShellNavSection[]
  /** Navigation pinned to the bottom of the sidebar. */
  footerItems?: ShellNavItem[]
  /** Phone tab bar links (up to 3). A "More" tab is added when there is navigation. */
  tabs?: ShellNavItem[]
  /** Phone tab bar centre button. More than one action opens a sheet to pick from. */
  quickActions?: ShellQuickAction[]
  /** Remounts the page when it changes, e.g. the household id. */
  outletKey?: string
}

const COLLAPSED_KEY = 'budgeteer.sidebarCollapsed'

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
}

function writeCollapsed(value: boolean) {
  try { localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0') } catch { /* preference only */ }
}

/**
 * Responsive application frame shared by the household, personal and admin areas.
 *
 * - Compact (< 640): header, bottom tab bar with an optional centre action, "More" drawer.
 * - Medium (640–1023): 64px icon rail.
 * - Expanded and up (1024+): 224px sidebar (248px from 2200), collapsible to the rail.
 */
export function AppShell({ context, actions, sections = [], footerItems = [], tabs = [], quickActions = [], outletKey }: AppShellProps) {
  const { pathname } = useLocation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const isLarge = useMediaQuery('(min-width: 1024px)')
  const canInstall = useInstallState().canPrompt
  const sideMode: NavMode = collapsed ? 'rail' : 'responsive'
  // Labels are hidden in the rail, so links get a tooltip there
  const railTooltips = !isLarge || collapsed

  const hasNav = sections.length > 0 || footerItems.length > 0
  const hasTabBar = tabs.length > 0 || quickActions.length > 0 || hasNav

  // Each route starts at the top of the scroll area, and phone overlays close on navigation
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
    setDrawerOpen(false)
    setSheetOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!drawerOpen && !sheetOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setDrawerOpen(false); setSheetOpen(false) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, sheetOpen])

  function toggleCollapsed() {
    setCollapsed((c) => { writeCollapsed(!c); return !c })
  }

  function runQuickAction() {
    if (quickActions.length === 1) quickActions[0].onSelect()
    else setSheetOpen(true)
  }

  return (
    <div className="h-dvh bg-gray-950 text-white flex flex-col overflow-hidden">
      <header className="bg-gray-900 border-b border-gray-800 pt-[env(safe-area-inset-top)] flex-shrink-0">
        <div className="min-h-14 px-4 sm:px-6 flex items-center gap-3">
          <Link to="/" aria-label="Budgeteer home" className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg hover:opacity-90 transition-opacity">
            <BrandMark size={26} />
            <span className="hidden sm:inline font-display text-xl leading-none text-gray-100">Budgeteer</span>
          </Link>
          {context && (
            <div className="min-w-0 flex items-center gap-3">
              <span className="hidden sm:inline text-gray-600">/</span>
              {context}
            </div>
          )}
          <div className="ml-auto flex items-center gap-3 sm:gap-5">
            {actions}
            <HeaderUserMenu />
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {hasNav && (
          <nav
            aria-label="Main"
            className={`hidden sm:flex flex-col flex-shrink-0 w-16 ${collapsed ? '' : 'lg:w-56 ultra:w-[248px]'} bg-gray-900 border-r border-gray-800 overflow-y-auto py-3`}
          >
            <div className="flex-1 px-2 lg:px-3">
              <NavSections sections={sections} mode={sideMode} showTitles={railTooltips} />
            </div>
            {footerItems.length > 0 && (
              <div className="px-2 lg:px-3 pt-3 mt-3 border-t border-gray-800 space-y-0.5">
                {footerItems.map((item) => (
                  <ShellNavLink key={item.to} item={item} mode={sideMode} showTitle={railTooltips} />
                ))}
              </div>
            )}
            {canInstall && (
              <div className="px-2 lg:px-3 pt-3 mt-3 border-t border-gray-800">
                <InstallAppButton
                  showTitle={railTooltips}
                  className={`${NAV_BUTTON} ${LINK_ALIGN[sideMode]}`}
                  labelClassName={LINK_LABEL[sideMode]}
                />
              </div>
            )}
            <div className="hidden lg:block px-3 pt-3 mt-3 border-t border-gray-800">
              <button
                type="button"
                onClick={toggleCollapsed}
                title={collapsed ? 'Expand sidebar' : undefined}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-500 hover:text-white hover:bg-gray-800/50 transition-colors ${collapsed ? 'justify-center' : ''}`}
              >
                {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                {!collapsed && <span>Collapse</span>}
              </button>
            </div>
          </nav>
        )}

        {/* Scroll container for the page. Leaves room for the phone tab bar. `relative` makes it the
            containing block for absolutely positioned content (e.g. `sr-only` table headers), which
            would otherwise widen the whole document on phones. */}
        <div
          ref={scrollRef}
          className={`relative flex-1 min-w-0 overflow-y-auto flex flex-col ${hasTabBar ? 'pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))] sm:pb-0' : ''}`}
        >
          <InstallAppHint />
          <div className="flex-1">
            <Outlet key={outletKey} />
          </div>
          <AppFooter />
        </div>
      </div>

      {hasTabBar && (
        <TabBar
          tabs={tabs}
          quickAction={quickActions.length > 0 ? { label: quickActions.length === 1 ? quickActions[0].label : 'Add', icon: quickActions.length === 1 ? quickActions[0].icon : Plus } : undefined}
          onQuickAction={runQuickAction}
          onMore={hasNav ? () => setDrawerOpen(true) : undefined}
          moreActive={drawerOpen}
        />
      )}

      {drawerOpen && (
        <div className="sm:hidden">
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setDrawerOpen(false)} />
          <nav
            aria-label="Menu"
            className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-gray-900 border-r border-gray-800 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <span className="text-sm font-medium text-gray-300">Menu</span>
              <button onClick={() => setDrawerOpen(false)} className="text-gray-400 hover:text-white transition-colors p-1" aria-label="Close menu">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <NavSections sections={sections} mode="drawer" showTitles={false} />
            </div>
            {footerItems.length > 0 && (
              <div className="px-3 py-3 border-t border-gray-800 space-y-0.5">
                {footerItems.map((item) => (
                  <ShellNavLink key={item.to} item={item} mode="drawer" showTitle={false} />
                ))}
              </div>
            )}
            {canInstall && (
              <div className="px-3 py-3 border-t border-gray-800">
                <InstallAppButton showTitle={false} className={`${NAV_BUTTON} ${LINK_ALIGN.drawer}`} />
              </div>
            )}
          </nav>
        </div>
      )}

      {sheetOpen && (
        <div className="sm:hidden">
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setSheetOpen(false)} />
          <div
            role="dialog"
            aria-label="Add"
            className="fixed inset-x-0 bottom-0 z-50 bg-gray-900 border-t border-gray-800 rounded-t-2xl px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-700" />
            <div className="space-y-1">
              {quickActions.map(({ label, icon: Icon, onSelect }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setSheetOpen(false); onSelect() }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm text-gray-200 hover:bg-gray-800 transition-colors"
                >
                  <Icon size={18} className="text-amber-400" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * `drawer`: the phone menu, always labelled.
 * `rail`: icons only (sm–lg, or a collapsed sidebar); section titles become dividers.
 * `responsive`: rail below lg, labelled sidebar from lg.
 */
type NavMode = 'drawer' | 'rail' | 'responsive'

const SECTION_TITLE: Record<NavMode, string> = { drawer: 'block', rail: 'hidden', responsive: 'hidden lg:block' }
const SECTION_DIVIDER: Record<NavMode, string> = { drawer: 'hidden', rail: 'block', responsive: 'lg:hidden' }
const LINK_ALIGN: Record<NavMode, string> = { drawer: 'justify-start', rail: 'justify-center', responsive: 'justify-center lg:justify-start' }
const LINK_LABEL: Record<NavMode, string> = { drawer: '', rail: 'sr-only', responsive: 'sr-only lg:not-sr-only' }
/** Nav-link look for buttons in the navigation (Install app) */
const NAV_BUTTON = 'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800/50 transition-colors'

function NavSections({ sections, mode, showTitles }: { sections: ShellNavSection[]; mode: NavMode; showTitles: boolean }) {
  return (
    <div className="space-y-4">
      {sections.map((section, i) => (
        <div key={section.title ?? i} className="space-y-0.5">
          {section.title && (
            <p className={`${SECTION_TITLE[mode]} px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-gray-500`}>
              {section.title}
            </p>
          )}
          {i > 0 && <div className={`${SECTION_DIVIDER[mode]} mx-2 mb-2 border-t border-gray-800`} />}
          {section.items.map((item) => (
            <ShellNavLink key={item.to} item={item} mode={mode} showTitle={showTitles} />
          ))}
        </div>
      ))}
    </div>
  )
}

function ShellNavLink({ item, mode, showTitle }: { item: ShellNavItem; mode: NavMode; showTitle: boolean }) {
  const { label, to, icon: Icon, end } = item
  return (
    <NavLink
      to={to}
      end={end}
      // Tooltip only when the label isn't visible
      title={showTitle ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${LINK_ALIGN[mode]} ${
          isActive ? 'bg-gray-800 text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={16} className={`flex-shrink-0 ${isActive ? 'text-amber-400' : 'text-gray-500'}`} />
          <span className={`${LINK_LABEL[mode]} truncate`}>{label}</span>
        </>
      )}
    </NavLink>
  )
}

function TabBar({ tabs, quickAction, onQuickAction, onMore, moreActive }: {
  tabs: ShellNavItem[]
  quickAction?: { label: string; icon: LucideIcon }
  onQuickAction: () => void
  onMore?: () => void
  moreActive: boolean
}) {
  const cells: ReactNode[] = tabs.map((item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => `flex flex-col items-center justify-center gap-1 min-h-14 text-[11px] ${isActive ? 'text-white font-medium' : 'text-gray-500'}`}
    >
      {({ isActive }) => (
        <>
          <item.icon size={20} className={isActive ? 'text-amber-400' : undefined} />
          <span className="truncate max-w-full px-1">{item.label}</span>
        </>
      )}
    </NavLink>
  ))
  if (onMore) {
    cells.push(
      <button key="more" type="button" onClick={onMore} className={`flex flex-col items-center justify-center gap-1 min-h-14 text-[11px] ${moreActive ? 'text-white font-medium' : 'text-gray-500'}`}>
        <Ellipsis size={20} />
        <span>More</span>
      </button>,
    )
  }
  if (quickAction) {
    const QuickIcon = quickAction.icon
    cells.splice(Math.floor(cells.length / 2), 0,
      <div key="quick" className="flex items-center justify-center">
        <button
          type="button"
          onClick={onQuickAction}
          aria-label={quickAction.label}
          className="-mt-5 w-12 h-12 rounded-full bg-amber-400 text-gray-950 flex items-center justify-center shadow-lg shadow-black/40 hover:bg-amber-300 transition-colors"
        >
          <QuickIcon size={22} />
        </button>
      </div>,
    )
  }

  return (
    <nav
      aria-label="Tabs"
      className="sm:hidden fixed inset-x-0 bottom-0 z-30 bg-gray-900 border-t border-gray-800 grid pb-[env(safe-area-inset-bottom)]"
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
    >
      {cells}
    </nav>
  )
}
