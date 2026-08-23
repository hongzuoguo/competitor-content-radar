import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../../src/renderer/src/components/Button'
import { EmptyState } from '../../src/renderer/src/components/EmptyState'
import { StatusBadge } from '../../src/renderer/src/components/StatusBadge'

describe('core interface components', () => {
  it('keeps disabled buttons discoverable but non-interactive', () => {
    render(<Button disabled>立即运行</Button>)
    expect(screen.getByRole('button', { name: '立即运行' })).toBeDisabled()
  })

  it('pairs status color with readable text', () => {
    render(<StatusBadge tone="success">运行正常</StatusBadge>)
    expect(screen.getByText('运行正常')).toHaveAttribute('data-tone', 'success')
  })

  it('teaches the next action in an empty state', () => {
    render(<EmptyState title="还没有监控博主" description="添加第一个博主后，应用会采集近 30 条作品作为基线。" />)
    expect(screen.getByRole('heading', { name: '还没有监控博主' })).toBeInTheDocument()
    expect(screen.getByText(/近 30 条作品/)).toBeInTheDocument()
  })
})
