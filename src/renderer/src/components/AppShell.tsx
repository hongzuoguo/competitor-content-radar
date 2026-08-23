import { Menu, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const isMobile = useMediaQuery('(max-width: 719px)')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function closeMobileNav({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
    setMobileNavOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false)
  }, [isMobile])

  useEffect(() => {
    if (!isMobile || !mobileNavOpen) return
    document.querySelector<HTMLElement>('#primary-navigation .nav__item')?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMobileNav()
      if (event.key !== 'Tab') return
      const navLinks = [...document.querySelectorAll<HTMLElement>('#primary-navigation .nav__item')]
      const lastNavLink = navLinks.at(-1)
      if (!lastNavLink) return
      if (!event.shiftKey && document.activeElement === lastNavLink) {
        event.preventDefault()
        triggerRef.current?.focus()
      } else if (event.shiftKey && document.activeElement === triggerRef.current) {
        event.preventDefault()
        lastNavLink.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isMobile, mobileNavOpen])

  return (
    <div className="app-shell" data-mobile-nav={mobileNavOpen ? 'open' : 'closed'} data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      {isMobile ? (
        <button aria-controls="primary-navigation" aria-expanded={mobileNavOpen} aria-label={mobileNavOpen ? '关闭导航' : '打开导航'} className="mobile-nav-trigger" onClick={() => mobileNavOpen ? closeMobileNav({ restoreFocus: false }) : setMobileNavOpen(true)} ref={triggerRef} type="button">
          {mobileNavOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
        </button>
      ) : null}
      {isMobile && mobileNavOpen ? <button aria-label="关闭导航" className="mobile-nav-scrim" onClick={() => closeMobileNav()} tabIndex={-1} type="button" /> : null}
      <Sidebar collapsed={collapsed} inert={isMobile && !mobileNavOpen} mobile={isMobile} onNavigate={() => { if (isMobile) closeMobileNav() }} onToggle={() => setCollapsed((value) => !value)} />
      <div aria-hidden={isMobile && mobileNavOpen || undefined} className="workspace" inert={isMobile && mobileNavOpen}>
        <Topbar />
        <main className="page-scroll" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  )
}

function useMediaQuery(query: string): boolean {
  const getMatches = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false
  const [matches, setMatches] = useState(getMatches)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    const onChange = (): void => setMatches(media.matches)
    onChange()
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [query])

  return matches
}
