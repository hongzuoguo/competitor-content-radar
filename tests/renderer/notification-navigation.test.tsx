import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../../src/preload'

vi.mock('../../src/renderer/src/pages/OverviewPage', () => ({ OverviewPage: () => <div>Overview</div> }))
vi.mock('../../src/renderer/src/pages/CreatorsPage', () => ({ CreatorsPage: () => <div>Creators</div> }))
vi.mock('../../src/renderer/src/pages/SettingsPage', () => ({ SettingsPage: () => <div>Settings</div> }))
vi.mock('../../src/renderer/src/pages/TasksPage', () => ({ TasksPage: () => <div>Tasks</div> }))
vi.mock('../../src/renderer/src/pages/WorksPage', () => ({
  WorksPage: ({ focusRequest }: { focusRequest?: { workId: string; requestId: string } }) => (
    <div data-request-id={focusRequest?.requestId} data-work-id={focusRequest?.workId}>Works</div>
  )
}))
vi.mock('../../src/renderer/src/components/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('../../src/renderer/src/features/onboarding/SetupWizard', () => ({ SetupWizard: () => <div>Setup</div> }))

import { App } from '../../src/renderer/src/App'

describe('notification navigation', () => {
  let requestFocus: ((request: { workId: string; requestId: string }) => void) | undefined
  const unsubscribe = vi.fn()

  beforeEach(() => {
    requestFocus = undefined
    vi.clearAllMocks()
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        onWorkFocusRequested: vi.fn((listener: (request: { workId: string; requestId: string }) => void) => {
          requestFocus = listener
          return unsubscribe
        })
      } as unknown as DesktopApi
    })
  })

  it('opens works and passes only the requested work id', async () => {
    const view = render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(screen.getByText('Overview')).toBeInTheDocument()

    await act(async () => requestFocus?.({ workId: 'work-42', requestId: 'request-1' }))

    expect(screen.getByText('Works')).toHaveAttribute('data-work-id', 'work-42')
    expect(screen.getByText('Works')).toHaveAttribute('data-request-id', 'request-1')
    await act(async () => requestFocus?.({ workId: 'work-42', requestId: 'request-2' }))
    expect(screen.getByText('Works')).toHaveAttribute('data-request-id', 'request-2')
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
  })
})
