import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../../src/renderer/src/pages/SettingsPage'

describe('application settings', () => {
  it('opts only the named save action into the glass button material', () => {
    const settingsSource = readFileSync('src/renderer/src/pages/SettingsPage.tsx', 'utf8')

    expect(settingsSource).toContain('className="settings-save-action glass-button"')
  })

  it('uses one refresh action for both persisted engine states and prevents a duplicate request', async () => {
    let resolveRefresh: ((value: unknown) => void) | undefined
    const refreshEngineHealth = vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve }))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getEngineHealth: vi.fn()
          .mockResolvedValueOnce({
            cloud: { status: 'unknown', checkedAt: null, fingerprint: 'cloud', code: null, message: null },
            codex: { status: 'unknown', checkedAt: null, fingerprint: 'codex', code: null, message: null },
            checking: false
          })
          .mockResolvedValue({
            cloud: { status: 'healthy', checkedAt: '2026-08-09T09:00:00.000Z', fingerprint: 'cloud', code: null, message: null },
            codex: { status: 'unhealthy', checkedAt: '2026-08-09T09:00:00.000Z', fingerprint: 'codex', code: 'CODEX_LOGIN_REQUIRED', message: '请先登录' },
            checking: false
          }),
        refreshEngineHealth
      }
    })

    render(<SettingsPage />)

    const refresh = await screen.findByTestId('engine-health-refresh')
    expect(screen.getAllByTestId('engine-health-refresh')).toHaveLength(1)
    fireEvent.click(refresh)
    await waitFor(() => expect(screen.getByTestId('engine-health-cloud')).toHaveAttribute('data-status', 'checking'))
    expect(screen.getByTestId('engine-health-codex')).toHaveAttribute('data-status', 'checking')
    expect(refresh).toBeDisabled()
    fireEvent.click(refresh)
    expect(refreshEngineHealth).toHaveBeenCalledTimes(1)

    resolveRefresh?.({
      cloud: { status: 'healthy', checkedAt: '2026-08-09T09:00:00.000Z', fingerprint: 'cloud', code: null, message: null },
      codex: { status: 'unhealthy', checkedAt: '2026-08-09T09:00:00.000Z', fingerprint: 'codex', code: 'CODEX_LOGIN_REQUIRED', message: '请先登录' },
      checking: false
    })

    await waitFor(() => expect(screen.getByTestId('engine-health-cloud')).toHaveAttribute('data-status', 'healthy'))
    expect(screen.getByTestId('engine-health-codex')).toHaveAttribute('data-status', 'unhealthy')
    expect(screen.getByText(/每个引擎都只会发送一次最小请求/)).toBeInTheDocument()
  })

  it('does not let a stale initial health read overwrite an active refresh', async () => {
    let resolveInitial: ((value: unknown) => void) | undefined
    let resolveRefresh: ((value: unknown) => void) | undefined
    const getEngineHealth = vi.fn(() => new Promise((resolve) => { resolveInitial = resolve }))
    const refreshEngineHealth = vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve }))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getEngineHealth,
        refreshEngineHealth
      }
    })

    render(<SettingsPage />)
    await waitFor(() => expect(getEngineHealth).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByTestId('engine-health-refresh'))
    await waitFor(() => expect(screen.getByTestId('engine-health-cloud')).toHaveAttribute('data-status', 'checking'))

    resolveInitial?.({
      cloud: { status: 'unknown', checkedAt: null, fingerprint: 'stale-cloud', code: null, message: null },
      codex: { status: 'unknown', checkedAt: null, fingerprint: 'stale-codex', code: null, message: null },
      checking: false
    })

    await waitFor(() => expect(getEngineHealth).toHaveBeenCalledOnce())
    expect(screen.getByTestId('engine-health-cloud')).toHaveAttribute('data-status', 'checking')
    expect(screen.getByTestId('engine-health-codex')).toHaveAttribute('data-status', 'checking')

    resolveRefresh?.({
      cloud: { status: 'healthy', checkedAt: '2026-08-09T09:00:00.000Z', fingerprint: 'cloud', code: null, message: null },
      codex: { status: 'healthy', checkedAt: '2026-08-09T09:00:00.000Z', fingerprint: 'codex', code: null, message: null },
      checking: false
    })
    await waitFor(() => expect(screen.getByTestId('engine-health-cloud')).toHaveAttribute('data-status', 'healthy'))
  })

  it('does not leave either engine in checking state when refresh rejects', async () => {
    let rejectRefresh: ((reason?: unknown) => void) | undefined
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getEngineHealth: vi.fn().mockResolvedValue({
          cloud: { status: 'unknown', checkedAt: null, fingerprint: 'cloud', code: null, message: null },
          codex: { status: 'unknown', checkedAt: null, fingerprint: 'codex', code: null, message: null },
          checking: false
        }),
        refreshEngineHealth: vi.fn(() => new Promise((_resolve, reject) => { rejectRefresh = reject }))
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByTestId('engine-health-refresh'))
    await waitFor(() => expect(screen.getByTestId('engine-health-cloud')).toHaveAttribute('data-status', 'checking'))
    rejectRefresh?.(new Error('transport failed'))

    await waitFor(() => expect(screen.getByTestId('engine-health-cloud')).toHaveAttribute('data-status', 'unknown'))
    expect(screen.getByTestId('engine-health-codex')).toHaveAttribute('data-status', 'unknown')
    expect(screen.getByRole('alert')).toHaveTextContent('模型状态刷新失败')
  })

  it('keeps the health section and its only refresh action available when the initial read fails', async () => {
    const refreshEngineHealth = vi.fn().mockResolvedValue({
      cloud: { status: 'healthy', checkedAt: '2026-08-09T09:00:00.000Z', fingerprint: 'cloud', code: null, message: null },
      codex: { status: 'unknown', checkedAt: null, fingerprint: 'codex', code: null, message: null },
      checking: false
    })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getEngineHealth: vi.fn().mockRejectedValue(new Error('raw provider response with secret')),
        refreshEngineHealth
      }
    })

    render(<SettingsPage />)

    expect(await screen.findByTestId('engine-health-cloud')).toBeVisible()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('无法读取已保存的模型状态')
    expect(alert).not.toHaveTextContent('raw provider response')
    const refresh = screen.getAllByTestId('engine-health-refresh')
    expect(refresh).toHaveLength(1)
    expect(refresh[0]).toBeEnabled()
    fireEvent.click(refresh[0])
    await waitFor(() => expect(refreshEngineHealth).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByTestId('engine-health-cloud')).toHaveAttribute('data-status', 'healthy'))
  })

  it('loads Feishu connection state and exposes connected actions', async () => {
    const syncFeishu = vi.fn().mockResolvedValue(undefined)
    const openFeishuBase = vi.fn().mockResolvedValue(undefined)
    const disconnectFeishu = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'connected',
          baseName: '对标内容雷达',
          baseUrl: 'https://example.feishu.cn/base/abc',
          lastSyncedAt: '2026-07-25T08:30:00.000Z',
          message: '',
          customAppConfigured: true,
          maskedAppId: 'cli_***mple'
        }),
        syncFeishu,
        openFeishuBase,
        disconnectFeishu
      }
    })

    render(<SettingsPage />)

    expect(await screen.findByText('已连接“对标内容雷达”')).toHaveClass('connection-row__status')
    expect(screen.getByRole('button', { name: '立即同步' })).toHaveClass('button--primary')
    expect(screen.getByRole('button', { name: '打开表格' })).toHaveClass('button--secondary')
    const moreFeishuActions = screen.getByRole('group', { name: '更多飞书操作' })
    expect(moreFeishuActions).toContainElement(screen.getByRole('button', { name: '重新配置' }))
    expect(moreFeishuActions).toContainElement(screen.getByRole('button', { name: '断开连接' }))
    expect(screen.getByRole('button', { name: '断开连接' })).toHaveClass('connection-buttons__disconnect')
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }))
    await waitFor(() => expect(syncFeishu).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: '打开表格' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '打开表格' }))
    expect(openFeishuBase).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByRole('button', { name: '断开连接' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }))
    await waitFor(() => expect(disconnectFeishu).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByRole('button', { name: '立即同步' })).toBeEnabled())
  })

  it('shows the saved Feishu failure reason after a sync error', async () => {
    const getFeishuConnection = vi.fn()
      .mockResolvedValueOnce({
        status: 'connected', baseName: '对标内容雷达', baseUrl: 'https://example.feishu.cn/base/abc',
        lastSyncedAt: null, message: '', customAppConfigured: true, maskedAppId: 'cli_***mple'
      })
      .mockResolvedValue({
        status: 'sync_error', baseName: '对标内容雷达', baseUrl: 'https://example.feishu.cn/base/abc',
        lastSyncedAt: null, message: '每日指标快照存在重复数据',
        customAppConfigured: true, maskedAppId: 'cli_***mple'
      })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection,
        syncFeishu: vi.fn().mockRejectedValue(new Error('FEISHU_DUPLICATE_LOCAL_IDENTITY'))
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '立即同步' }))

    expect(await screen.findByText('每日指标快照存在重复数据')).toBeInTheDocument()
    expect(getFeishuConnection).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      code: 'FEISHU_PERMISSION_DENIED',
      title: '飞书拒绝了访问',
      reason: '应用权限未发布，或目标 Base 未授权该应用管理',
      action: '请开通多维表格读写权限；/wiki/ 链接还需“查看知识空间节点信息”；发布应用版本后，在目标 Base 中添加该应用为文档应用并授予可管理权限'
    },
    {
      code: 'FEISHU_NETWORK_ERROR',
      title: '暂时无法连接飞书',
      reason: '网络、代理或飞书服务异常',
      action: '请检查网络后重试'
    }
  ])('shows safe structured guidance when sync fails with $code', async ({ code, title, reason, action }) => {
    const secret = 'fake-app-secret'
    const rawMessage = `Error invoking remote method 'feishu:sync': ${secret}`
    const syncFeishu = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error(rawMessage), {
        code,
        title: 'untrusted remote title',
        reason: 'untrusted remote reason',
        action: 'untrusted remote action'
      }))
      .mockResolvedValue(undefined)
    const connected = {
      status: 'connected', baseName: '对标内容雷达', baseUrl: 'https://example.feishu.cn/base/abc',
      lastSyncedAt: null, message: '', customAppConfigured: true, maskedAppId: 'cli_***mple'
    }
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn()
          .mockResolvedValueOnce(connected)
          .mockResolvedValueOnce({ ...connected, status: 'sync_error', message: '持久同步错误' })
          .mockResolvedValue(connected),
        syncFeishu
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '立即同步' }))

    await screen.findByText(title)
    const alert = screen.getByRole('alert')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(alert).toHaveTextContent(title)
    expect(alert).toHaveTextContent(`可能原因：${reason}`)
    expect(alert).toHaveTextContent(`处理方法：${action}`)
    expect(alert).toHaveTextContent(`错误代码：${code}`)
    expect(document.body).not.toHaveTextContent('Error invoking remote method')
    expect(document.body).not.toHaveTextContent(secret)
    expect(document.body).not.toHaveTextContent('untrusted remote')
    expect(document.body).not.toHaveTextContent('持久同步错误')

    fireEvent.click(screen.getByRole('button', { name: '立即同步' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(syncFeishu).toHaveBeenCalledTimes(2))
  })

  it('clears a structured sync failure after reconnecting successfully', async () => {
    const initialConnection = {
      status: 'connected', baseName: '旧表格', baseUrl: 'https://example.feishu.cn/base/old',
      lastSyncedAt: null, message: '', customAppConfigured: true, maskedAppId: 'cli_***_old'
    }
    const reconnected = {
      ...initialConnection,
      baseName: '新连接表格',
      baseUrl: 'https://example.feishu.cn/base/new',
      message: '已连接新表格',
      maskedAppId: 'cli_***_new'
    }
    const connectFeishuCustomApp = vi.fn().mockResolvedValue(reconnected)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue(initialConnection),
        syncFeishu: vi.fn().mockRejectedValue(Object.assign(new Error('raw sync failure'), {
          code: 'FEISHU_NETWORK_ERROR'
        })),
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '立即同步' }))
    await screen.findByText('暂时无法连接飞书')

    fireEvent.click(screen.getByRole('button', { name: '重新配置' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_new' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'new-app-secret' } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), {
      target: { value: 'https://example.feishu.cn/base/new' }
    })
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))

    await waitFor(() => expect(connectFeishuCustomApp).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByText('已连接“新连接表格”')).toBeInTheDocument()
    expect(screen.getByText('已连接新表格')).toBeInTheDocument()
  })

  it('shows manual pending-sync guidance without hiding a saved Feishu sync error', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({ feishuSyncMode: 'manual' }),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'sync_error', baseName: '对标内容雷达', baseUrl: 'https://example.feishu.cn/base/abc',
          lastSyncedAt: null, message: '飞书服务暂时不可用', customAppConfigured: true, maskedAppId: 'cli_***mple',
          hasPendingChanges: true
        })
      }
    })

    render(<SettingsPage />)

    await waitFor(() => {
      const messages = document.querySelector('.connection-row--feishu .connection-row__messages')
      expect(messages).toBeInTheDocument()
      expect(messages?.children).toHaveLength(2)
    })

    expect(await screen.findByText('本地更新待同步，请点击“立即同步”。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即同步' })).toBeEnabled()
    expect(screen.getByText('飞书服务暂时不可用')).toBeInTheDocument()
  })

  it('shows automatic pending-sync guidance when local Feishu changes are waiting', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ feishuSyncMode: 'manual' })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({ feishuSyncMode: 'auto' }),
        saveSettings,
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'connected', baseName: '对标内容雷达', baseUrl: 'https://example.feishu.cn/base/abc',
          lastSyncedAt: null, message: '', customAppConfigured: true, maskedAppId: 'cli_***mple',
          hasPendingChanges: true
        })
      }
    })

    render(<SettingsPage />)

    expect(await screen.findByText('本地更新将在当前任务结束时同步到飞书。')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('同步方式'), { target: { value: 'manual' } })
    expect(screen.getByText('本地更新将在当前任务结束时同步到飞书。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledOnce())
    expect(await screen.findByText('本地更新待同步，请点击“立即同步”。')).toBeInTheDocument()
  })

  it('configures a user-owned Feishu app from an inline panel', async () => {
    const connected = {
      status: 'connected',
      baseName: '对标内容雷达',
      baseUrl: 'https://example.feishu.cn/base/base-1',
      lastSyncedAt: null,
      message: '已连接',
      customAppConfigured: true,
      maskedAppId: 'cli_***mple'
    }
    const connectFeishuCustomApp = vi.fn().mockResolvedValue(connected)
    const getFeishuConnection = vi.fn()
      .mockResolvedValueOnce({
        status: 'disconnected',
        baseName: null,
        baseUrl: null,
        lastSyncedAt: null,
        message: '',
        customAppConfigured: false,
        maskedAppId: null
      })
      .mockResolvedValue(connected)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection,
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)

    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: ' cli_example ' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: ' app-secret ' } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), {
      target: { value: ' https://example.feishu.cn/base/base-1 ' }
    })
    expect(screen.getByLabelText('App Secret')).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))

    await waitFor(() => expect(connectFeishuCustomApp).toHaveBeenCalledWith({
      appId: 'cli_example',
      appSecret: 'app-secret',
      baseUrl: 'https://example.feishu.cn/base/base-1'
    }))
    expect(await screen.findByText('cli_***mple')).toBeInTheDocument()
    expect(screen.queryByText('app-secret')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新配置' })).toBeInTheDocument()
  })

  it('explains a Wiki type mismatch without exposing the remote error or App Secret', async () => {
    const appSecret = 'fake-app-secret'
    const connectFeishuCustomApp = vi.fn().mockRejectedValue(Object.assign(
      new Error(`Error invoking remote method 'feishu:connect-custom-app': Wiki is not Bitable; ${appSecret}`),
      { code: 'FEISHU_WIKI_NOT_BITABLE', title: 'untrusted', reason: 'untrusted', action: 'untrusted' }
    ))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_example' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: appSecret } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), { target: { value: 'https://example.feishu.cn/wiki/wiki-1' } })
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))

    await screen.findByText('该知识库页面不是多维表格')
    const alert = screen.getByRole('alert')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(alert).toHaveTextContent('该知识库页面不是多维表格')
    expect(alert).toHaveTextContent('可能原因：页面实际类型不受支持')
    expect(alert).toHaveTextContent('处理方法：请打开多维表格页面后重新复制链接')
    expect(alert).toHaveTextContent('错误代码：FEISHU_WIKI_NOT_BITABLE')
    expect(alert).not.toHaveTextContent('Error invoking remote method')
    expect(alert).not.toHaveTextContent(appSecret)
    expect(screen.getByLabelText('App ID')).toHaveValue('cli_example')
    expect(screen.getByLabelText('App ID')).toHaveAttribute('aria-describedby', 'feishu-connect-error')
    expect(screen.getByLabelText('App Secret')).toHaveValue(appSecret)
    expect(screen.getByLabelText('App Secret')).toHaveAttribute('aria-describedby', 'feishu-connect-error')
    expect(screen.getByLabelText('App Secret')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('多维表格链接')).toHaveValue('https://example.feishu.cn/wiki/wiki-1')
  })

  it('explains a Feishu permission failure from its trusted code', async () => {
    const connectFeishuCustomApp = vi.fn().mockRejectedValue(Object.assign(
      new Error("Error invoking remote method 'feishu:connect-custom-app': forbidden"),
      { code: 'FEISHU_PERMISSION_DENIED', title: 'untrusted', reason: 'untrusted', action: 'untrusted' }
    ))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_example' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'fake-app-secret' } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), { target: { value: 'https://example.feishu.cn/base/base-1' } })
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))

    await screen.findByText('飞书拒绝了访问')
    const alert = screen.getByRole('alert')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(alert).toHaveTextContent('飞书拒绝了访问')
    expect(alert).toHaveTextContent('可能原因：应用权限未发布，或目标 Base 未授权该应用管理')
    expect(alert).toHaveTextContent('处理方法：请开通多维表格读写权限；/wiki/ 链接还需“查看知识空间节点信息”；发布应用版本后，在目标 Base 中添加该应用为文档应用并授予可管理权限')
    expect(alert).toHaveTextContent('错误代码：FEISHU_PERMISSION_DENIED')
    expect(alert).not.toHaveTextContent('Error invoking remote method')
  })

  it('recovers a safe Feishu code when contextBridge preserves only the Error message', async () => {
    const connectFeishuCustomApp = vi.fn().mockRejectedValue(new Error('FEISHU_PERMISSION_DENIED'))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    expect(screen.getByText('在刚复制的 Base 中添加该应用为文档应用，并授予可管理权限。')).toBeVisible()
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_example' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'fake-app-secret' } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), { target: { value: 'https://example.feishu.cn/wiki/wiki-1' } })
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('飞书拒绝了访问'))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('查看知识空间节点信息')
    expect(alert).toHaveTextContent('添加该应用为文档应用')
    expect(alert).toHaveTextContent('错误代码：FEISHU_PERMISSION_DENIED')
  })

  it('clears a structured connection error when canceling while preserving the entered credentials', async () => {
    const connectFeishuCustomApp = vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), {
      code: 'FEISHU_PERMISSION_DENIED'
    }))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_example' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'fake-app-secret' } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), { target: { value: 'https://example.feishu.cn/base/base-1' } })
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))
    await screen.findByText('飞书拒绝了访问')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '配置飞书同步' }))

    expect(screen.queryByText('飞书拒绝了访问')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('App ID')).toHaveValue('cli_example')
    expect(screen.getByLabelText('App Secret')).toHaveValue('fake-app-secret')
    expect(screen.getByLabelText('多维表格链接')).toHaveValue('https://example.feishu.cn/base/base-1')
  })

  it('clears a structured connection error when reconfiguration closes the connected panel', async () => {
    const connectFeishuCustomApp = vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), {
      code: 'FEISHU_PERMISSION_DENIED'
    }))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'connected', baseName: '对标内容雷达', baseUrl: 'https://example.feishu.cn/base/base-1', lastSyncedAt: null,
          message: '已连接的状态说明', customAppConfigured: true, maskedAppId: 'cli_***mple'
        }),
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '重新配置' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_example' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'fake-app-secret' } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), { target: { value: 'https://example.feishu.cn/base/base-1' } })
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))
    await screen.findByText('飞书拒绝了访问')

    fireEvent.click(screen.getByRole('button', { name: '重新配置' }))
    fireEvent.click(screen.getByRole('button', { name: '重新配置' }))

    expect(screen.queryByText('飞书拒绝了访问')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('已连接的状态说明')).toBeInTheDocument()
    expect(screen.getByLabelText('App Secret')).toHaveValue('fake-app-secret')
  })

  it('falls back to generic guidance when a rejected error has a hostile code getter', async () => {
    const connectFeishuCustomApp = vi.fn().mockRejectedValue(new Proxy({}, {
      get(_target, property) {
        if (property === 'code') throw new Error('hostile getter text')
        return undefined
      }
    }))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_example' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'fake-app-secret' } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), { target: { value: 'https://example.feishu.cn/base/base-1' } })
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))

    await screen.findByText('连接失败，请检查应用权限和表格链接后重试。')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('连接失败，请检查应用权限和表格链接后重试。')
    expect(alert).not.toHaveTextContent('hostile getter text')
  })

  it('opens the complete Feishu template from the inline panel', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        openExternal
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.click(screen.getByRole('button', { name: '使用完整模板' }))

    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://my.feishu.cn/base/UhZ6bYe6aafexms9WGXcomHInic')
  })

  it('preserves the template button Enter behavior without submitting the connection form', async () => {
    const connectFeishuCustomApp = vi.fn()
    const openExternal = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        connectFeishuCustomApp,
        openExternal
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_example' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'app-secret' } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), { target: { value: 'https://example.feishu.cn/base/base-1' } })
    fireEvent.keyDown(screen.getByRole('button', { name: '使用完整模板' }), { key: 'Enter' })

    expect(connectFeishuCustomApp).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an error when opening the complete Feishu template fails', async () => {
    const openExternal = vi.fn().mockRejectedValue(new Error('failed'))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        openExternal
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.click(screen.getByRole('button', { name: '使用完整模板' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法打开飞书模板，请稍后重试。')
  })

  it.each([
    'https://my.feishu.cn/base/UhZ6bYe6aafexms9WGXcomHInic',
    'https://my.feishu.cn/base/UhZ6bYe6aafexms9WGXcomHInic?table=tbl123&view=vew456'
  ])('rejects the public Feishu template URL as a sync target: %s', async (baseUrl) => {
    const connectFeishuCustomApp = vi.fn()
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_example' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'app-secret' } })
    fireEvent.change(screen.getByLabelText('多维表格链接'), { target: { value: baseUrl } })
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))

    expect(screen.getByRole('alert')).toHaveTextContent('这是公共模板链接。请先点击“使用完整模板”创建自己的副本，再粘贴副本链接。')
    expect(connectFeishuCustomApp).not.toHaveBeenCalled()
  })

  it('validates custom-app fields before invoking the main process', async () => {
    const connectFeishuCustomApp = vi.fn()
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        connectFeishuCustomApp
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.click(screen.getByRole('button', { name: '测试并连接' }))

    expect(screen.getByRole('alert')).toHaveTextContent('请填写 App ID、App Secret 和多维表格链接')
    expect(connectFeishuCustomApp).not.toHaveBeenCalled()
  })

  it('opens the official Feishu developer console through the desktop API', async () => {
    const openFeishuDeveloperConsole = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        openFeishuDeveloperConsole
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '配置飞书同步' }))
    fireEvent.click(screen.getByRole('button', { name: '打开飞书开放平台' }))

    expect(openFeishuDeveloperConsole).toHaveBeenCalledOnce()
  })

  it('lets the user choose an existing Base when duplicate names require repair', async () => {
    const repairFeishu = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'needs_repair',
          baseName: null,
          baseUrl: null,
          lastSyncedAt: null,
          message: '发现多个同名多维表格，请选择继续使用的表格。',
          candidates: [
            { appToken: 'app-a', url: 'https://example.feishu.cn/base/a' },
            { appToken: 'app-b', url: 'https://example.feishu.cn/base/b' }
          ]
        }),
        repairFeishu
      }
    })

    render(<SettingsPage />)

    expect(await screen.findByText('发现多个同名多维表格，请选择继续使用的表格。')).toBeInTheDocument()
    const candidates = screen.getAllByRole('button', { name: /使用候选表格/ })
    expect(candidates).toHaveLength(2)
    fireEvent.click(candidates[1])
    await waitFor(() => expect(repairFeishu).toHaveBeenCalledWith('app-b'))
  })

  it('requires an explicit recreate action after the connected Base is deleted', async () => {
    const recreateFeishu = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'needs_repair',
          baseName: '对标内容雷达',
          baseUrl: 'https://example.feishu.cn/base/deleted',
          lastSyncedAt: null,
          message: '已连接的飞书多维表格不存在（FEISHU_BASE_MISSING）'
        }),
        recreateFeishu
      }
    })

    render(<SettingsPage />)

    fireEvent.click(await screen.findByRole('button', { name: '重新创建表格' }))
    await waitFor(() => expect(recreateFeishu).toHaveBeenCalledOnce())
  })

  it('mentions field types as well as permissions when table repair fails', async () => {
    const repairFeishu = vi.fn().mockRejectedValue(new Error('field type mismatch'))
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'needs_repair',
          baseName: '对标内容雷达',
          baseUrl: 'https://example.feishu.cn/base/base-1',
          lastSyncedAt: null,
          message: '表结构需要修复'
        }),
        repairFeishu
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '修复表结构' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请根据上方错误检查字段类型或应用权限后重试')
  })

  it('creates profiles with arbitrary model IDs without sending stored keys back to the page', async () => {
    const createModelProfile = vi.fn().mockResolvedValue({
      id: 'profile-a', name: 'DeepSeek 新模型', providerTemplate: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-v5', requiresApiKey: true,
      enabled: true, active: true, createdAt: '', updatedAt: '', apiKeyConfigured: true
    })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        listModelProfiles: vi.fn().mockResolvedValue([]),
        createModelProfile
      }
    })

    render(<SettingsPage />)
    const configureModel = await screen.findByRole('button', { name: '新建模型配置' })
    expect(configureModel).toHaveTextContent('模型配置')
    fireEvent.click(configureModel)
    fireEvent.change(screen.getByLabelText('配置名称'), { target: { value: 'DeepSeek 新模型' } })
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: ' deepseek-v5 ' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'secret-never-rendered' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(createModelProfile).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'deepseek-v5', apiKey: 'secret-never-rendered'
    })))
    expect(screen.queryByText('secret-never-rendered')).not.toBeInTheDocument()
  })

  it('shows profile status, allows activation, and prevents deleting the active profile', async () => {
    const activateModelProfile = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        listModelProfiles: vi.fn().mockResolvedValue([
          { id: 'active', name: '当前配置', providerTemplate: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-any', requiresApiKey: true, enabled: true, active: true, createdAt: '', updatedAt: '', apiKeyConfigured: true },
          { id: 'other', name: '备用配置', providerTemplate: 'custom', baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'local-any', requiresApiKey: false, enabled: true, active: false, createdAt: '', updatedAt: '', apiKeyConfigured: false }
        ]),
        activateModelProfile
      }
    })

    render(<SettingsPage />)
    expect(await screen.findByText('已安全保存')).toBeInTheDocument()
    expect(screen.getByText('无需 API Key')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除当前配置' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '设为当前' }))

    await waitFor(() => expect(activateModelProfile).toHaveBeenCalledWith('other'))
  })

  it('tests an edited profile with its stored key without exposing the key', async () => {
    const testModelProfile = vi.fn().mockResolvedValue({ executed: true, ok: true })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        listModelProfiles: vi.fn().mockResolvedValue([
          { id: 'active', name: 'DeepSeek', providerTemplate: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-v4-flash', requiresApiKey: true, enabled: true, active: true, createdAt: '', updatedAt: '', apiKeyConfigured: true }
        ]),
        testModelProfile
      }
    })

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))

    await waitFor(() => expect(testModelProfile).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'active', modelId: 'deepseek-v4-flash'
    })))
    expect(testModelProfile.mock.calls[0][0]).not.toHaveProperty('apiKey')
    expect(await screen.findByText('连接成功，可以保存使用。')).toBeInTheDocument()
  })

  it('keeps the internal transcription engine out of normal settings', () => {
    render(<SettingsPage />)
    expect(screen.queryByText(/SenseVoice|FFmpeg/i)).not.toBeInTheDocument()
  })

  it('does not show weekly reports or scheduled monitoring', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { getSettings: vi.fn().mockResolvedValue({ dailyTime: '09:00' }) }
    })

    render(<SettingsPage />)

    await screen.findByRole('heading', { name: '设置' })
    expect(screen.queryByText('每周报告')).not.toBeInTheDocument()
    expect(screen.queryByText(/周一 09:30/)).not.toBeInTheDocument()
    expect(document.querySelector('#weekly-time')).toBeNull()
    expect(document.querySelector('#daily-time')).toBeNull()
    expect(screen.queryByText(/自动运行|补跑/)).not.toBeInTheDocument()
  })

  it('loads and saves the per-creator analysis scope', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ analysisMaxWorksPerCreator: 6, analysisRecentDays: 45 })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({ analysisMaxWorksPerCreator: 10, analysisRecentDays: 30 }),
        saveSettings
      }
    })

    render(<SettingsPage />)

    expect(await screen.findByLabelText('每位博主最多拆解')).toHaveValue(10)
    expect(screen.getByLabelText('拆解最近')).toHaveValue(30)
    expect(screen.getByText(/最近 30 天内，最多拆解最新 10 条/)).toBeInTheDocument()
    expect(screen.getByText(/已拆解作品不会重复消耗额度/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('每位博主最多拆解'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('拆解最近'), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      analysisMaxWorksPerCreator: 6,
      analysisRecentDays: 45
    })))
    expect(saveSettings.mock.calls[0][0]).not.toHaveProperty('providerId')
    expect(saveSettings.mock.calls[0][0]).not.toHaveProperty('modelId')
    expect(saveSettings.mock.calls[0][0]).not.toHaveProperty('apiKey')
  })

  it('loads and saves the Feishu publication range and retention time independently', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ feishuSyncRecentDays: 7, feishuRetentionDays: 60 })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({ feishuSyncRecentDays: 30, feishuRetentionDays: 30 }),
        saveSettings
      }
    })

    render(<SettingsPage />)

    const syncRecentDays = await screen.findByLabelText('同步作品发布时间范围')
    const retentionDays = screen.getByLabelText('飞书作品保留时间')
    expect(syncRecentDays).toHaveValue(30)
    expect(retentionDays).toHaveValue(30)
    expect(syncRecentDays).toHaveAttribute('min', '1')
    expect(syncRecentDays).toHaveAttribute('max', '365')
    expect(retentionDays).toHaveAttribute('min', '1')
    expect(retentionDays).toHaveAttribute('max', '365')
    expect(syncRecentDays.closest('.form-field')?.querySelector('label')).toHaveTextContent('同步作品发布时间范围最近')
    expect(syncRecentDays.closest('.number-field')).not.toHaveTextContent('最近')
    expect(syncRecentDays).toHaveAttribute('aria-describedby', 'feishu-sync-recent-days-help')
    expect(retentionDays).toHaveAttribute('aria-describedby', 'feishu-retention-days-help')
    expect(screen.getByText('仅同步最近 N 天发布的新作品。')).toBeInTheDocument()
    expect(screen.getByText('从首次同步起算，满期后移入「归档作品」。')).toBeInTheDocument()
    fireEvent.change(syncRecentDays, { target: { value: '7' } })
    fireEvent.change(retentionDays, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      feishuSyncRecentDays: 7,
      feishuRetentionDays: 60
    })))
  })

  it('lets the user save the Feishu sync mode with its automatic timing help', async () => {
    const saveSettings = vi.fn().mockResolvedValue({
      feishuSyncMode: 'auto', feishuSyncRecentDays: 30, feishuRetentionDays: 30
    })
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({
          feishuSyncMode: 'manual', feishuSyncRecentDays: 30, feishuRetentionDays: 30
        }),
        saveSettings
      }
    })

    render(<SettingsPage />)

    const syncMode = await screen.findByLabelText('同步方式')
    expect(syncMode).toHaveValue('manual')
    expect(syncMode).toHaveAttribute('aria-describedby', 'feishu-sync-mode-help')
    expect(screen.getByRole('option', { name: '自动同步（推荐）' })).toHaveValue('auto')
    fireEvent.change(syncMode, { target: { value: 'auto' } })
    expect(screen.getByText('任务结束后，自动同步本地变更。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      feishuSyncMode: 'auto'
    })))
  })

  it('preserves unsaved Feishu drafts across an unrelated login-state refresh', async () => {
    const initialSettings = {
      feishuSyncMode: 'manual' as const, feishuSyncRecentDays: 30, feishuRetentionDays: 30
    }
    const getSettings = vi.fn()
      .mockResolvedValueOnce(initialSettings)
      .mockResolvedValue({ ...initialSettings })
    const saveSettings = vi.fn().mockImplementation(async (settings) => settings)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings,
        saveSettings,
        checkDouyinLogin: vi.fn().mockResolvedValue({ loggedIn: false })
      }
    })

    render(<SettingsPage />)

    const syncMode = await screen.findByLabelText('同步方式')
    const syncRecentDays = screen.getByLabelText('同步作品发布时间范围')
    const retentionDays = screen.getByLabelText('飞书作品保留时间')
    fireEvent.change(syncMode, { target: { value: 'auto' } })
    fireEvent.change(syncRecentDays, { target: { value: '7' } })
    fireEvent.change(retentionDays, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: '刷新登录状态' }))
    await waitFor(() => expect(getSettings).toHaveBeenCalledTimes(2))

    expect(syncMode).toHaveValue('auto')
    expect(syncRecentDays).toHaveValue(7)
    expect(retentionDays).toHaveValue(60)
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      feishuSyncMode: 'auto', feishuSyncRecentDays: 7, feishuRetentionDays: 60
    })))
  })

  it('uses three Feishu setting columns only when the settings surface is wide enough', () => {
    const css = readFileSync('src/renderer/src/pages/workspace-pages.css', 'utf8')

    expect(css).toMatch(/\.connection-list > \.feishu-sync-settings\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s)
    expect(css).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.connection-list > \.feishu-sync-settings\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
    expect(css).toMatch(/@media \(max-width: 820px\)[\s\S]*?\.connection-list > \.feishu-sync-settings\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
  })

  it('shows a field error and does not save an invalid Feishu publication range', async () => {
    const saveSettings = vi.fn()
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        saveSettings
      }
    })

    render(<SettingsPage />)

    const syncRecentDays = await screen.findByLabelText('同步作品发布时间范围')
    fireEvent.change(syncRecentDays, { target: { value: '0' } })
    expect(syncRecentDays).toHaveAttribute('aria-describedby', 'feishu-sync-recent-days-help feishu-sync-recent-days-error')
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 1 到 365 之间的整数')
    fireEvent.submit(screen.getByRole('button', { name: '保存设置' }).closest('form')!)
    expect(screen.getByText('请先修正设置。')).toBeInTheDocument()
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('shows a field error and does not save an invalid Feishu retention window', async () => {
    const saveSettings = vi.fn()
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        saveSettings
      }
    })

    render(<SettingsPage />)

    const retentionDays = await screen.findByLabelText('飞书作品保留时间')
    fireEvent.change(retentionDays, { target: { value: '366' } })
    expect(retentionDays).toHaveAttribute('aria-describedby', 'feishu-retention-days-help feishu-retention-days-error')
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 1 到 365 之间的整数')
    fireEvent.submit(screen.getByRole('button', { name: '保存设置' }).closest('form')!)
    expect(screen.getByText('请先修正设置。')).toBeInTheDocument()
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('references persisted-value errors only while their messages are rendered', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({ feishuSyncRecentDays: 0, feishuRetentionDays: 366 }),
        saveSettings: vi.fn()
      }
    })

    render(<SettingsPage />)

    const syncRecentDays = await screen.findByLabelText('同步作品发布时间范围')
    const retentionDays = screen.getByLabelText('飞书作品保留时间')
    expect(syncRecentDays).toHaveAttribute('aria-describedby', 'feishu-sync-recent-days-help')
    expect(retentionDays).toHaveAttribute('aria-describedby', 'feishu-retention-days-help')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.submit(screen.getByRole('button', { name: '保存设置' }).closest('form')!)
    expect(syncRecentDays).toHaveAttribute('aria-describedby', 'feishu-sync-recent-days-help feishu-sync-recent-days-error')
    expect(retentionDays).toHaveAttribute('aria-describedby', 'feishu-retention-days-help feishu-retention-days-error')
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })

  it('shows field errors and does not save invalid analysis scope values', async () => {
    const saveSettings = vi.fn()
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({ analysisMaxWorksPerCreator: 10, analysisRecentDays: 30 }),
        saveSettings
      }
    })

    render(<SettingsPage />)

    const maxWorks = await screen.findByLabelText('每位博主最多拆解')
    const recentDays = screen.getByLabelText('拆解最近')
    expect(maxWorks).toBeRequired()
    expect(recentDays).toBeRequired()

    fireEvent.change(maxWorks, { target: { value: '' } })
    expect(screen.getByRole('alert')).toHaveTextContent('请输入每位博主拆解数量')
    fireEvent.submit(screen.getByRole('button', { name: '保存设置' }).closest('form')!)
    expect(saveSettings).not.toHaveBeenCalled()

    fireEvent.change(maxWorks, { target: { value: '1.5' } })
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 1 到 30 之间的整数')
    fireEvent.change(maxWorks, { target: { value: '10' } })
    fireEvent.change(recentDays, { target: { value: '366' } })
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 1 到 365 之间的整数')
    fireEvent.submit(screen.getByRole('button', { name: '保存设置' }).closest('form')!)
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('organizes settings into the approved four groups without losing their content', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        getEngineHealth: vi.fn().mockResolvedValue({
          cloud: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
          codex: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
          checking: false
        }),
        refreshEngineHealth: vi.fn(),
        getAgentStatus: vi.fn()
      }
    })

    render(<SettingsPage />)

    const account = await screen.findByRole('heading', { name: '账号配置', level: 2 })
    const thresholds = screen.getByRole('heading', { name: '数据阈值', level: 2 })
    const models = screen.getByRole('heading', { name: '模型配置', level: 2 })
    const storage = screen.getByRole('heading', { name: '媒体清理', level: 2 })
    expect(account).toBeVisible()
    expect(thresholds).toBeVisible()
    expect(models).toBeVisible()
    expect(storage).toBeVisible()
    expect(screen.queryByRole('heading', { name: '拆解范围' })).not.toBeInTheDocument()
    expect(screen.queryByText('高级阈值')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '模型健康' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '拆解数量与时间范围', level: 3 })).toBeVisible()
    expect(screen.getByRole('heading', { name: '数据特征', level: 3 })).toBeVisible()
    expect(screen.getByRole('heading', { name: '验证状态', level: 3 })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'AI 拆解模型', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '本地 Codex', level: 3 })).toBeInTheDocument()
    expect(account.compareDocumentPosition(thresholds)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(thresholds.compareDocumentPosition(models)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(models.compareDocumentPosition(storage)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByText('抖音账号').closest('[id="accounts"]')).not.toBeNull()
    expect(screen.getByText('飞书多维表格').closest('[id="accounts"]')).not.toBeNull()
    expect(screen.getByTestId('engine-health-cloud').closest('[id="models"]')).not.toBeNull()
    expect(screen.getByLabelText('同步方式')).toBeVisible()
    expect(screen.getByLabelText('拆解最近')).toBeVisible()
    const maxWorks = screen.getByLabelText('每位博主最多拆解')
    expect(maxWorks).toBeVisible()
    expect(maxWorks.closest('[id="data-thresholds"]')).toContainElement(screen.getByRole('button', { name: '恢复推荐设置' }))

    expect(screen.getByRole('navigation', { name: '设置分区' })).toHaveTextContent('账号配置数据阈值模型配置媒体清理')
  })

  it('navigates settings sections without changing the HashRouter route', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { getSettings: vi.fn().mockResolvedValue({}) }
    })
    window.history.replaceState(null, '', '#/settings')
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })

    render(<SettingsPage />)

    const accounts = await screen.findByRole('button', { name: '账号配置' })
    const thresholds = screen.getByRole('button', { name: '数据阈值' })
    expect(accounts).toHaveAttribute('aria-current', 'location')
    fireEvent.click(thresholds)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(thresholds).toHaveAttribute('aria-current', 'location')
    expect(accounts).not.toHaveAttribute('aria-current')
    expect(window.location.hash).toBe('#/settings')
  })

  it('shows a quiet four-item section rail and local-save helper before saving', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { getSettings: vi.fn().mockResolvedValue({}) }
    })

    render(<SettingsPage />)

    const nav = await screen.findByRole('navigation', { name: '设置分区' })
    expect(screen.queryByText('设置分区')).not.toBeInTheDocument()
    expect(['01', '02', '03', '04'].every((index) => screen.queryByText(index) === null)).toBe(true)
    expect(Array.from(nav.querySelectorAll('button'), (button) => button.textContent)).toEqual(['账号配置', '数据阈值', '模型配置', '媒体清理'])
    expect(screen.getByText('所有更改保存在本地')).toBeVisible()
  })

  it('replaces the local-save helper with live save feedback', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: { getSettings: vi.fn().mockResolvedValue({}), saveSettings: vi.fn().mockResolvedValue({}) }
    })

    render(<SettingsPage />)

    fireEvent.submit((await screen.findByRole('button', { name: '保存设置' })).closest('form')!)
    expect(await screen.findByText('设置已保存')).toBeVisible()
    expect(screen.queryByText('所有更改保存在本地')).not.toBeInTheDocument()
  })

  it('keeps coherent threshold and model groups inside their top-level surfaces', async () => {
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getEngineHealth: vi.fn().mockResolvedValue({
          cloud: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
          codex: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
          checking: false
        }),
        refreshEngineHealth: vi.fn()
      }
    })

    render(<SettingsPage />)

    const thresholds = await screen.findByRole('heading', { name: '数据阈值', level: 2 })
    const thresholdSurface = thresholds.closest('[id="data-thresholds"]')!
    expect(thresholdSurface.querySelectorAll(':scope > .settings-section')).toHaveLength(2)
    expect(thresholdSurface).toContainElement(screen.getByRole('button', { name: '恢复推荐设置' }))

    const models = screen.getByRole('heading', { name: '模型配置', level: 2 }).closest('[id="models"]')!
    expect(models.querySelector(':scope > .engine-health')).not.toBeNull()
    expect(models.querySelector(':scope > .settings-disclosure')).not.toBeNull()
  })

  it('stacks the recommended reset action at narrow widths', () => {
    const css = readFileSync('src/renderer/src/pages/workspace-pages.css', 'utf8')

    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.settings-recommended-reset\s*{[^}]*flex-direction:\s*column/s)
  })

  it('asks before restoring recommended settings and leaves state unchanged when cancelled', async () => {
    const restoreRecommendedBehaviorSettings = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        restoreRecommendedBehaviorSettings
      }
    })

    render(<SettingsPage />)

    fireEvent.click(await screen.findByRole('button', { name: '恢复推荐设置' }))

    expect(confirm).toHaveBeenCalledWith('仅恢复采集、分析、同步和保留策略；不会清除账号凭证、飞书连接或已有数据。本地 Codex 的模型与推理强度将恢复默认。')
    expect(restoreRecommendedBehaviorSettings).not.toHaveBeenCalled()
    expect(screen.getByText('仅恢复采集、分析、同步和保留策略；不会清除账号凭证、飞书连接或已有数据。本地 Codex 的模型与推理强度将恢复默认。')).toBeInTheDocument()
  })

  it('restores settings once, refreshes persisted views, and hides raw failures', async () => {
    const rawFailure = 'provider failure with sk-secret-value'
    const restored = {
      analysisRecentDays: 30, analysisMaxWorksPerCreator: 10, feishuSyncMode: 'auto',
      absoluteLikes: 10_000, highCollects: 3_000, highComments: 500, highShares: 500,
      relativePerformanceMultiplier: 3, relativePerformanceSurgeMultiplier: 80
    }
    const restoreRecommendedBehaviorSettings = vi.fn()
      .mockResolvedValueOnce(restored)
      .mockRejectedValueOnce(new Error(rawFailure))
    const getSettings = vi.fn().mockResolvedValue({
      analysisRecentDays: 14, analysisMaxWorksPerCreator: 4, feishuSyncMode: 'manual',
      absoluteLikes: 1, highCollects: 2, highComments: 3, highShares: 4,
      relativePerformanceMultiplier: 5, relativePerformanceSurgeMultiplier: 6
    })
    const getFeishuConnection = vi.fn().mockResolvedValue({
      status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
      message: '', customAppConfigured: false, maskedAppId: null
    })
    const getEngineHealth = vi.fn().mockResolvedValue({
      cloud: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
      codex: { status: 'unknown', checkedAt: null, fingerprint: null, code: null, message: null },
      checking: false
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings,
        getFeishuConnection,
        getEngineHealth,
        refreshEngineHealth: vi.fn(),
        restoreRecommendedBehaviorSettings,
        saveSettings: vi.fn(),
        deleteModelProfileKey: vi.fn(),
        deleteModelProfile: vi.fn()
      }
    })

    render(<SettingsPage />)

    const reset = await screen.findByRole('button', { name: '恢复推荐设置' })
    fireEvent.click(reset)
    await waitFor(() => expect(restoreRecommendedBehaviorSettings).toHaveBeenCalledTimes(1))
    expect(getFeishuConnection).toHaveBeenCalledTimes(2)
    expect(getSettings).toHaveBeenCalled()
    expect(getEngineHealth).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('拆解最近')).toHaveValue(30)
    expect(screen.getByLabelText('每位博主最多拆解')).toHaveValue(10)
    expect(screen.getByLabelText('同步方式')).toHaveValue('auto')
    expect(document.querySelector<HTMLInputElement>('input[name="absoluteLikes"]')).toHaveValue(10_000)
    expect(document.querySelector<HTMLInputElement>('input[name="highCollects"]')).toHaveValue(3_000)
    expect(document.querySelector<HTMLInputElement>('input[name="highComments"]')).toHaveValue(500)
    expect(document.querySelector<HTMLInputElement>('input[name="highShares"]')).toHaveValue(500)
    expect(document.querySelector<HTMLInputElement>('input[name="relativePerformanceMultiplier"]')).toHaveValue(3)
    expect(document.querySelector<HTMLInputElement>('input[name="relativePerformanceSurgeMultiplier"]')).toHaveValue(80)
    expect(window.desktopApi.saveSettings).not.toHaveBeenCalled()
    fireEvent.submit(reset.closest('form')!)
    await waitFor(() => expect(window.desktopApi.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      absoluteLikes: 10_000, highCollects: 3_000, highComments: 500, highShares: 500,
      relativePerformanceMultiplier: 3, relativePerformanceSurgeMultiplier: 80
    })))
    expect(window.desktopApi.deleteModelProfileKey).not.toHaveBeenCalled()
    expect(window.desktopApi.deleteModelProfile).not.toHaveBeenCalled()

    fireEvent.click(reset)
    await waitFor(() => expect(restoreRecommendedBehaviorSettings).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('alert')).toHaveTextContent('恢复推荐设置失败，请稍后重试。')
    expect(document.body).not.toHaveTextContent(rawFailure)
    expect(document.body).not.toHaveTextContent('sk-secret-value')
  })

  it('prevents concurrent restores and clears a previous success message before a later failure', async () => {
    let resolveFirstRestore: ((settings: object) => void) | undefined
    const restoreRecommendedBehaviorSettings = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstRestore = resolve }))
      .mockRejectedValueOnce(new Error('raw failure'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    Object.defineProperty(window, 'desktopApi', {
      configurable: true,
      value: {
        getSettings: vi.fn().mockResolvedValue({}),
        getFeishuConnection: vi.fn().mockResolvedValue({
          status: 'disconnected', baseName: null, baseUrl: null, lastSyncedAt: null,
          message: '', customAppConfigured: false, maskedAppId: null
        }),
        restoreRecommendedBehaviorSettings
      }
    })

    render(<SettingsPage />)

    const reset = await screen.findByRole('button', { name: '恢复推荐设置' })
    fireEvent.click(reset)
    fireEvent.click(reset)
    expect(restoreRecommendedBehaviorSettings).toHaveBeenCalledTimes(1)
    expect(reset).toBeDisabled()

    resolveFirstRestore?.({ analysisRecentDays: 30, analysisMaxWorksPerCreator: 10, feishuSyncMode: 'auto' })
    await screen.findByText('已恢复推荐设置')
    fireEvent.click(screen.getByRole('button', { name: '恢复推荐设置' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('恢复推荐设置失败，请稍后重试。')
    expect(screen.queryByText('已恢复推荐设置')).not.toBeInTheDocument()
  })

})
