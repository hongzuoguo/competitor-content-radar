import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorksPage } from '../../src/renderer/src/pages/WorksPage'

describe('work analysis library', () => {
  it('filters works by highlight reason', () => {
    render(<WorksPage />)
    fireEvent.click(screen.getByRole('button', { name: '只看高点赞' }))
    expect(screen.getByText('为什么你的内容看起来很努力，却没有增长')).toBeInTheDocument()
    expect(screen.queryByText('一个选题能不能爆，发布前看这三个信号')).not.toBeInTheDocument()
  })
})
