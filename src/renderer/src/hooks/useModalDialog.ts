import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export function useModalDialog({ containerRef, initialFocusRef, onClose }: {
  containerRef: RefObject<HTMLElement | null>
  initialFocusRef: RefObject<HTMLElement | null>
  onClose(): void
}): void {
  useEffect(() => {
    const appShell = document.querySelector<HTMLElement>('.app-shell')
    const wasInert = appShell?.inert ?? false
    if (appShell) appShell.inert = true
    initialFocusRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const controls = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      if (controls.length === 0) {
        event.preventDefault()
        return
      }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (appShell) appShell.inert = wasInert
    }
  }, [containerRef, initialFocusRef, onClose])
}
