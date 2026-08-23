import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(path, 'utf8')

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)]
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
}

describe('HitMuse design system', () => {
  it('keeps settings connection rows explicitly placed and responsive', () => {
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')
    const settingsPage = read('src/renderer/src/pages/SettingsPage.tsx')

    expect(workspaceCss).toMatch(/\.connection-row\s*\{[^}]*grid-template-areas:\s*'icon body actions'\s*'icon status actions'\s*'\. message message'/s)
    expect(workspaceCss).toMatch(/\.connection-row\s*>\s*\.form-help[^}]*grid-area:\s*message/s)
    expect(workspaceCss).toMatch(/\.connection-row\s*>\s*\.connection-message[^}]*grid-area:\s*message/s)
    expect(workspaceCss).toMatch(/\.connection-row\s*>\s*\.settings-error[^}]*grid-area:\s*message/s)
    expect(workspaceCss).toMatch(/\.connection-row\s*>\s*\.connection-row__status[^}]*grid-area:\s*status/s)
    expect(workspaceCss).toMatch(/\.connection-row\s*>\s*\.connection-action[^}]*grid-area:\s*actions/s)
    expect(workspaceCss).toMatch(/\.connection-row\s*>\s*\.connection-buttons[^}]*grid-area:\s*actions/s)
    expect(workspaceCss).toMatch(/\.feishu-sync-settings\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s)
    expect(workspaceCss).toContain('.settings-nav')
    const settingsRegion = workspaceCss.match(/\.settings-region\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(settingsRegion).toContain('background: var(--color-surface)')
    expect(settingsRegion).toContain('border: 1px solid var(--color-border)')
    expect(settingsRegion).toContain('border-radius: var(--radius-md)')
    expect(settingsRegion).toContain('box-shadow: none')
    expect(settingsRegion).toContain('padding: var(--space-6)')
    expect(workspaceCss).not.toMatch(/\.settings-region \+ \.settings-region[^}]*border-top:/s)
    expect(workspaceCss).toMatch(/\.settings-nav button\s*\{/)
    expect(workspaceCss).toMatch(/\.settings-nav button\s*\{[^}]*justify-content:\s*flex-start/s)
    expect(settingsPage).not.toContain('settings-nav__index')
    expect(settingsPage).not.toContain('settings-nav__eyebrow')
    expect(workspaceCss).not.toMatch(/\.settings-content\s*\{[^}]*gap:\s*(?:3[4-9]|[4-9]\d)px/s)
    expect(workspaceCss).not.toMatch(/\.settings-nav\s*\{[^}]*overflow-x:\s*(?:auto|scroll)/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 820px\)[\s\S]*?\.settings-nav\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s)
    expect(settingsPage).toContain('className="page-heading settings-page-heading"')
    expect(settingsPage).toContain('className="settings-page-heading__actions"')
    expect(workspaceCss).toMatch(/\.settings-page-heading\s*\{[^}]*grid-template-columns:\s*168px minmax\(0, 960px\)/s)
    expect(workspaceCss).toMatch(/\.settings-page-heading__actions\s*\{[^}]*grid-column:\s*2/s)
    const settingsActions = workspaceCss.match(/\.settings-page-heading__actions\s*\{[^}]*display:\s*grid[^}]*\}/s)?.[0] ?? ''
    expect(settingsActions).toContain('display: grid')
    expect(settingsActions).toContain('justify-items: end')
    expect(settingsActions).toContain('gap: 4px')
    expect(workspaceCss).toMatch(/@media \(max-width: 820px\)[\s\S]*?\.settings-page-heading__actions\s*\{[^}]*justify-items:\s*start/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 719px\)[\s\S]*?\.settings-page-heading__actions \.button\s*\{[^}]*width:\s*100%/s)
    expect(workspaceCss).toMatch(/\.settings-region#data-thresholds \.settings-grid\s*\{[^}]*column-gap:\s*var\(--space-6\);[^}]*row-gap:\s*var\(--space-5\)/s)
    expect(workspaceCss).toMatch(/\.form-label__context\s*\{[^}]*color:\s*inherit;[^}]*font-weight:\s*inherit/s)
    expect(workspaceCss).toMatch(/\.feishu-sync-settings \.form-field > label\s*\{[^}]*gap:\s*0/s)
    expect(workspaceCss).toMatch(/\.connection-list > \.feishu-sync-settings\s*\{[^}]*gap:\s*var\(--space-6\)/s)
    expect(workspaceCss).toMatch(/\.feishu-sync-settings \.form-field\s*\{[^}]*justify-items:\s*stretch;[^}]*text-align:\s*left/s)
    expect(workspaceCss).toMatch(/\.feishu-sync-settings \.form-field > label\s*\{[^}]*justify-content:\s*flex-start/s)
    expect(workspaceCss).toMatch(/\.feishu-sync-settings \.form-field > small\s*\{[^}]*max-width:\s*none;[^}]*text-align:\s*left;[^}]*text-wrap:\s*pretty/s)
    expect(workspaceCss).toMatch(/\.feishu-sync-settings \.number-field input\s*\{[^}]*text-align:\s*center/s)
    expect(workspaceCss).toMatch(/\.feishu-sync-settings input\[type='number'\]\s*\{[^}]*appearance:\s*textfield/s)
    expect(workspaceCss).toMatch(/\.feishu-sync-settings input\[type='number'\]::-webkit-inner-spin-button[^}]*appearance:\s*none/s)
    expect(workspaceCss).toMatch(/\.model-profiles \.settings-section__heading \.button\s*\{[^}]*white-space:\s*nowrap/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 719px\)[\s\S]*?\.model-profiles \.settings-section__heading\s*\{[^}]*align-items:\s*flex-start;[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*nowrap/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 719px\)[\s\S]*?\.model-profiles \.settings-section__heading \.button\s*\{[^}]*width:\s*auto;[^}]*flex:\s*0 0 auto/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 719px\)[\s\S]*?\.model-profiles \.settings-section__heading > div\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1/s)
    expect(workspaceCss).toMatch(/#local-agent\s*\{[^}]*display:\s*grid;[^}]*gap:\s*18px/s)
    expect(workspaceCss).toMatch(/\.model-profiles__message:empty\s*\{[^}]*display:\s*none/s)
    expect(workspaceCss).toMatch(/\.settings-region#storage\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*align-items:\s*center/s)
    expect(workspaceCss).toMatch(/\.settings-region#storage > \.settings-grid\s*\{[^}]*align-self:\s*center/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.connection-list > \.feishu-sync-settings\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.feishu-sync-settings \.form-field\s*\{[^}]*grid-template-columns:\s*minmax\(150px, 0\.8fr\) minmax\(110px, 0\.55fr\) minmax\(200px, 1\.2fr\)/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 820px\)[\s\S]*?\.connection-list > \.feishu-sync-settings\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
    const narrowSyncPanel = workspaceCss.match(/@media \(max-width: 820px\)[\s\S]*?\.connection-list > \.feishu-sync-settings\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(narrowSyncPanel).not.toContain('padding-left: 0')
  })

  it('keeps settings content surfaces opaque instead of turning every card into glass', () => {
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')
    const settingsRegion = workspaceCss.match(/\.settings-region\s*\{[^}]*\}/s)?.[0] ?? ''

    expect(settingsRegion).not.toContain('backdrop-filter')
    expect(settingsRegion).not.toContain('glass-panel')
  })

  it('uses one restrained inset grouping layer inside settings cards', () => {
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')
    const feishuInset = workspaceCss.match(/\.connection-list > \.feishu-sync-settings\s*\{[^}]*\}/s)?.[0] ?? ''

    expect(feishuInset).toContain('background: var(--color-surface-subtle)')
    expect(feishuInset).toContain('border-radius: var(--radius-sm)')
    expect(feishuInset).toContain('padding: var(--space-4)')
    expect(feishuInset).not.toContain('padding: 16px 0 0 44px')
    expect(feishuInset).not.toContain('border-top')
    const insetGroups = workspaceCss.match(/\.settings-region#data-thresholds > \.settings-section,[\s\S]*?\n\}/)?.[0] ?? ''
    expect(insetGroups).toContain('.settings-region#models > .engine-health')
    expect(insetGroups).toContain('.settings-region#models > .settings-disclosure')
    expect(insetGroups).toContain('background: var(--color-surface-subtle)')
    expect(insetGroups).toContain('border-radius: var(--radius-sm)')
    expect(insetGroups).toContain('padding: var(--space-4)')
    expect(workspaceCss).not.toMatch(/\.rule-list\s*\{[^}]*border:\s*1px solid/s)
  })

  it('keeps desktop connection rows compact and action buttons horizontal', () => {
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')
    const analysisScope = read('src/renderer/src/features/settings/AnalysisScopeSettings.tsx')
    const connectionList = workspaceCss.match(/\.connection-list\s*\{[^}]*\}/s)?.[0] ?? ''
    const connectionRow = workspaceCss.match(/\.connection-list > \.connection-row\s*\{[^}]*\}/s)?.[0] ?? ''
    const connectionAction = workspaceCss.match(/\.connection-list > \.connection-row > \.connection-action\s*\{[^}]*\}/s)?.[0] ?? ''

    expect(connectionList).toContain('grid-template-columns: 32px minmax(0, 1fr) auto')
    expect(connectionList).toContain('row-gap: 0')
    expect(connectionList).toContain('padding: 0')
    expect(connectionRow).toContain("grid-template-areas: 'icon body actions' 'icon status actions' '. message message'")
    expect(connectionRow).toContain('grid-template-columns: subgrid')
    expect(connectionRow).toContain('grid-column: 1 / -1')
    expect(connectionRow).toContain('align-items: center')
    expect(connectionRow).toContain('padding: 12px 0')
    expect(connectionRow).not.toMatch(/(?:min-)?height:/)
    expect(connectionAction).toContain('display: flex')
    expect(connectionAction).toContain('flex-wrap: wrap')
    expect(connectionAction).toContain('justify-content: flex-end')
    expect(workspaceCss).toMatch(/\.connection-list > \.connection-row > \.connection-buttons\s*\{[^}]*justify-content:\s*flex-end/s)
    expect(analysisScope).toContain('className="form-field analysis-scope__recent"')
    expect(workspaceCss).toMatch(/\.analysis-scope__recent\s*\{[^}]*grid-template-columns:\s*max-content;[^}]*justify-content:\s*end;[^}]*justify-items:\s*start;[^}]*text-align:\s*left/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 959px\)[\s\S]*?\.analysis-scope__recent\s*\{[^}]*grid-template-columns:\s*auto;[^}]*justify-content:\s*stretch;[^}]*justify-items:\s*start;[^}]*text-align:\s*left/s)
    expect(workspaceCss).toMatch(/\.settings-page input\[type='number'\]\s*\{[^}]*appearance:\s*textfield;[^}]*text-align:\s*center;[^}]*font-variant-numeric:\s*tabular-nums/s)
    expect(workspaceCss).toMatch(/\.settings-page input\[type='number'\]::-webkit-inner-spin-button,[\s\S]*?\.settings-page input\[type='number'\]::-webkit-outer-spin-button\s*\{[^}]*appearance:\s*none;[^}]*margin:\s*0/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.connection-list\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.connection-list > \.connection-row\s*\{[^}]*grid-template-areas:\s*'icon body'\s*'\. status'\s*'\. actions'\s*'\. message';[^}]*grid-template-columns:\s*32px minmax\(0, 1fr\)/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.connection-list > \.connection-row > \.connection-action\s*\{[^}]*justify-content:\s*flex-start/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.connection-list > \.connection-row > \.connection-buttons\s*\{[^}]*justify-content:\s*flex-start/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 620px\)[\s\S]*?\.connection-list > \.connection-row > \.connection-action\s*\{[^}]*justify-content:\s*flex-start/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 620px\)[\s\S]*?\.connection-list > \.connection-row > \.connection-buttons\s*\{[^}]*justify-content:\s*flex-start/s)
  })

  it('centers and differentiates connected Feishu actions without changing their direct access', () => {
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')

    expect(workspaceCss).toMatch(/\.connection-list > \.connection-row > \.connection-buttons\s*\{[^}]*align-self:\s*center;[^}]*gap:\s*12px/s)
    expect(workspaceCss).toMatch(/\.connection-buttons__more\s*\{[^}]*border-left:\s*1px solid var\(--color-border\);[^}]*padding-left:\s*12px/s)
    expect(workspaceCss).toMatch(/\.connection-buttons__disconnect\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--color-danger\)/s)
    expect(workspaceCss).not.toMatch(/\.connection-buttons__disconnect\s*\{[^}]*#[0-9a-f]{3,8}/i)
    expect(workspaceCss).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.connection-list > \.connection-row > \.connection-buttons\s*\{[^}]*align-self:\s*start;[^}]*justify-content:\s*flex-start/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.connection-buttons__more\s*\{[^}]*border-left:\s*0;[^}]*padding-left:\s*0/s)
  })

  it('uses a graphite creator action anchor above a flat monitoring list', () => {
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')

    const toolbar = workspaceCss.match(/\.creator-toolbar\s*\{[^}]*\}/s)?.[0] ?? ''
    const monitoring = workspaceCss.match(/\.creator-monitoring-surface\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(toolbar).toContain('border: 0')
    expect(toolbar).toContain('background: var(--color-environment)')
    expect(toolbar).toContain('box-shadow: none')
    expect(toolbar).toContain('padding: 24px')
    expect(monitoring).toContain('border: 0')
    expect(monitoring).toContain('border-top: 1px solid var(--color-border)')
    expect(monitoring).toContain('background: transparent')
    expect(monitoring).toContain('box-shadow: none')
    expect(workspaceCss).toMatch(/\.creator-form__input-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto auto/s)
    expect(workspaceCss).toMatch(/\.form-field input,[\s\S]*?\.search-field input\s*\{[^}]*background:\s*var\(--color-bg\);[^}]*color:\s*var\(--color-ink\)/s)
    expect(workspaceCss).toMatch(/\.creator-table tr\s*\{[^}]*grid-template-columns:\s*minmax\(0,/s)
    expect(workspaceCss).toMatch(/@media \(min-width: 960px\)[\s\S]*\.creator-table tbody td\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center/s)
    expect(workspaceCss).toMatch(/@media \(min-width: 960px\)[\s\S]*\.creator-table tbody td:last-child\s*\{[^}]*justify-content:\s*flex-end/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 959px\)[\s\S]*\.creator-table tr\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 959px\)[\s\S]*\.creator-table td::before\s*\{[^}]*content:\s*attr\(data-label\)/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 719px\)[\s\S]*\.creator-table td::before[\s\S]*content:\s*attr\(data-label\)/)
    expect(workspaceCss).toMatch(/@media \(max-width: 719px\)[\s\S]*\.creator-table tr\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--color-border\);[^}]*border-radius:\s*0/s)
  })

  it('frames the works decision workspace while keeping its three operating regions flat', () => {
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')
    const worksPage = read('src/renderer/src/pages/WorksPage.tsx')
    const workspace = workspaceCss.match(/\.subscription-workspace\s*\{[^}]*\}/s)?.[0] ?? ''
    const ownershipFilter = workspaceCss.match(/\.works-ownership-filter\s*\{[^}]*\}/s)?.[0] ?? ''

    expect(workspace).toContain('border: 1px solid var(--color-border)')
    expect(workspace).toContain('border-radius: var(--radius-md)')
    expect(workspace).toContain('background: var(--color-surface)')
    expect(workspace).toContain('box-shadow: none')
    expect(workspace).not.toContain('border-block')
    expect(ownershipFilter).toContain('background: var(--color-surface-subtle)')
    expect(ownershipFilter).toContain('border-radius: var(--radius-sm)')
    expect(workspaceCss).toMatch(/\.creator-rail\s*\{[^}]*background:\s*var\(--color-surface-subtle\)/s)
    expect(workspaceCss).toMatch(/\.creator-rail h2\s*\{[^}]*white-space:\s*nowrap/s)
    expect(workspaceCss).toMatch(/\.creator-rail,\s*\.subscription-work-list,\s*\.work-inspector\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto/s)
    expect(workspaceCss).toMatch(/\.subscription-work-list\s*\{[^}]*padding-bottom:\s*var\(--space-6\)/s)
    expect(workspaceCss).toMatch(/\.subscription-work-list\s*\{[^}]*overscroll-behavior-y:\s*auto/s)
    expect(workspaceCss).toMatch(/\.creator-rail header span\s*\{[^}]*white-space:\s*nowrap/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 959px\)[\s\S]*?\.subscription-workspace\s*\{[^}]*border-radius:\s*var\(--radius-md\)/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 719px\)[\s\S]*?\.works-ownership-filter button,\s*\.subscription-work-list \.segmented button\s*\{[^}]*min-height:\s*44px/s)
    expect(workspaceCss).toMatch(/@media \(max-width: 719px\)[\s\S]*?\.creator-rail__more\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s)
    expect(worksPage).toContain('className="works-ownership-filter"')
  })

  it('uses one opaque graphite anchor per operational page and shared overview columns', () => {
    const overviewCss = read('src/renderer/src/pages/overview.css')
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')

    expect(overviewCss).toMatch(/\.overview-snapshot \.daily-focus\s*\{[^}]*background:\s*var\(--color-environment\);[^}]*color:\s*var\(--color-sidebar-ink\)/s)
    expect(overviewCss).toMatch(/@media \(min-width: 1280px\)[\s\S]*?\.overview-snapshot\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) minmax\(280px, 1fr\)/s)
    expect(overviewCss).toMatch(/@media \(min-width: 1280px\)[\s\S]*?\.overview-grid--rankings\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) minmax\(280px, 1fr\)/s)
    expect(overviewCss).toMatch(/@media \(min-width: 1280px\)[\s\S]*?\.overview-snapshot \.metric-strip\s*\{[^}]*display:\s*contents/s)
    expect(overviewCss).toMatch(/@media \(min-width: 1280px\)[\s\S]*?\.overview-grid--rankings \.highlight-section\s*\{[^}]*grid-column:\s*span 3/s)

    expect(workspaceCss).toMatch(/\.creator-toolbar\s*\{[^}]*background:\s*var\(--color-environment\)/s)
    expect(workspaceCss).toMatch(/\.subscription-work-row\[data-selected='true'\]\s*\{[^}]*background:\s*var\(--color-environment\)/s)
    expect(workspaceCss).toMatch(/\.task-status-surface \.run-status\s*\{[^}]*background:\s*var\(--color-environment\)/s)
    expect(workspaceCss).toMatch(/\.settings-nav\s*\{[^}]*background:\s*var\(--color-environment\)/s)
    expect(workspaceCss).not.toMatch(/(?:\.overview-snapshot \.daily-focus|\.creator-toolbar|\.subscription-work-row\[data-selected='true'\]|\.task-status-surface \.run-status|\.settings-nav)\s*\{[^}]*backdrop-filter/s)
  })

  it('keeps the approved monochrome semantic palette and readable core color pairs', () => {
    const tokens = read('src/renderer/src/styles/tokens.css')

    expect(tokens).toMatch(/--color-canvas:\s*#f3f4f4/i)
    expect(tokens).toMatch(/--color-bg:\s*#ffffff/i)
    expect(tokens).toMatch(/--color-ink:\s*#161a1c/i)
    expect(tokens).toMatch(/--color-primary:\s*#171b1d/i)
    expect(tokens).toMatch(/--color-sidebar:\s*#111516/i)
    expect(tokens).toMatch(/--color-success:\s*#176b47/i)
    expect(tokens).toMatch(/--color-warning:\s*#925000/i)
    expect(tokens).toMatch(/--color-danger:\s*#a93636/i)
    expect(tokens).not.toContain('--color-brand-cyan')
    expect(tokens).toContain('--color-text: var(--color-ink)')
    expect(contrast('#161A1C', '#F3F4F4')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#626A6E', '#F3F4F4')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#FFFFFF', '#171B1D')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#F4F6F6', '#111516')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#A4ADAF', '#111516')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps white secondary buttons readable inside dark status surfaces', () => {
    const globalCss = read('src/renderer/src/styles/global.css')
    expect(globalCss).toMatch(/\.button--secondary\s*\{[^}]*background:\s*var\(--color-surface\);[^}]*color:\s*var\(--color-ink\)/s)
  })

  it('aligns the official sidebar brand row with the shared shell header', () => {
    const sidebar = read('src/renderer/src/components/sidebar.css')
    const topbar = read('src/renderer/src/components/topbar.css')

    expect(sidebar).toMatch(/grid-template-rows:\s*64px 1fr auto/)
    expect(sidebar).toMatch(/\.brand\s*\{[^}]*height:\s*64px/s)
    expect(sidebar).toMatch(/\.brand__logo\s*\{[^}]*width:\s*200px/s)
    expect(sidebar).toMatch(/\.brand__logo\s*\{[^}]*height:\s*60px/s)
    expect(topbar).toMatch(/\.topbar\s*\{[^}]*min-height:\s*64px/s)
  })

  it('does not leave renderer CSS consumers referencing the removed cyan token', () => {
    const sidebarCss = read('src/renderer/src/components/sidebar.css')
    const topbarCss = read('src/renderer/src/components/topbar.css')
    const overviewCss = read('src/renderer/src/pages/overview.css')
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')

    for (const css of [sidebarCss, topbarCss, overviewCss, workspaceCss]) {
      expect(css).not.toContain('--color-brand-cyan')
    }

    expect(sidebarCss).toMatch(/\.nav__item:focus-visible\s*\{[^}]*outline-color:\s*var\(--color-sidebar-ink\)/s)
    expect(contrast('#F4F6F6', '#111516')).toBeGreaterThanOrEqual(3)
  })

  it('keeps the shared shell free of retired cyan presentation literals', () => {
    const globalCss = read('src/renderer/src/styles/global.css')
    const sidebarCss = read('src/renderer/src/components/sidebar.css')
    const topbarCss = read('src/renderer/src/components/topbar.css')

    for (const css of [globalCss, sidebarCss, topbarCss]) {
      expect(css).not.toContain('#16afc1')
    }
  })

  it('adapts without a forced desktop minimum width or page-level scrolling', () => {
    const globalCss = read('src/renderer/src/styles/global.css')

    expect(globalCss).not.toMatch(/body\s*\{[^}]*min-width:\s*1120px/s)
    expect(globalCss).toContain('@media (max-width: 1279px)')
    expect(globalCss).toContain('@media (max-width: 959px)')
    expect(globalCss).toContain('@media (max-width: 719px)')
  })

  it('uses a 76px compact rail and a below-720 overlay drawer', () => {
    const globalCss = read('src/renderer/src/styles/global.css')
    const sidebarCss = read('src/renderer/src/components/sidebar.css')

    expect(globalCss).toMatch(/@media \(max-width: 1279px\)\s*\{[\s\S]*--sidebar-width:\s*76px/)
    expect(globalCss).toMatch(/@media \(max-width: 959px\)\s*\{[\s\S]*--sidebar-width:\s*64px/)
    expect(globalCss).toMatch(/@media \(max-width: 719px\)\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
    expect(sidebarCss).toMatch(/@media \(max-width: 719px\)\s*\{[\s\S]*\.app-shell\[data-mobile-nav\] > \.sidebar\s*\{[\s\S]*position:\s*fixed/)
    expect(sidebarCss).toContain('[data-mobile-nav=\'closed\'] .sidebar')
  })

  it('keeps mobile controls touchable, topic titles readable, and overlays tokenized', () => {
    const globalCss = read('src/renderer/src/styles/global.css')
    const sidebarCss = read('src/renderer/src/components/sidebar.css')
    const topbarCss = read('src/renderer/src/components/topbar.css')
    const overviewCss = read('src/renderer/src/pages/overview.css')
    const workspaceCss = read('src/renderer/src/pages/workspace-pages.css')

    expect(globalCss).toMatch(/@media \(max-width: 719px\)[\s\S]*\.button\s*\{[^}]*min-height:\s*44px/)
    expect(globalCss).toMatch(/\.mobile-nav-trigger\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s)
    expect(sidebarCss).toMatch(/@media \(max-width: 719px\)[\s\S]*\.nav__item\s*\{[^}]*min-height:\s*44px/)
    expect(topbarCss).toMatch(/@media \(max-width: 719px\)[\s\S]*\.engine-select__trigger\s*\{[^}]*min-height:\s*44px/)
    expect(topbarCss).toMatch(/@media \(max-width: 719px\)[\s\S]*\.update-status--retry\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px/s)
    expect(overviewCss).toMatch(/\.topic-ranking__title-line\s*\{[^}]*display:\s*grid/s)
    expect(overviewCss).not.toMatch(/\.topic-ranking__title-line > strong\s*\{[^}]*text-overflow:\s*ellipsis/s)
    expect(workspaceCss).toContain('z-index: var(--z-dropdown)')
    expect(workspaceCss).toContain('z-index: var(--z-modal)')
  })

  it('keeps overview ranking titles multi-line and stacks topic insight before it becomes cramped', () => {
    const overviewCss = read('src/renderer/src/pages/overview.css')

    expect(overviewCss).toMatch(/\.highlight-row__title-line strong\s*\{[^}]*overflow:\s*hidden;[^}]*-webkit-line-clamp:\s*2/s)
    expect(overviewCss).toMatch(/\.highlight-row\s*\{[^}]*min-height:\s*96px/s)
    expect(overviewCss).not.toMatch(/\.highlight-row\s*\{[^}]*(?<!-)height:\s*96px/s)
    expect(overviewCss).toMatch(/\.section-heading > span\s*\{[^}]*white-space:\s*nowrap/s)
    expect(overviewCss).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.overview-grid--rankings\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
  })

  it('limits liquid glass to the approved interaction layers', () => {
    const tokens = read('src/renderer/src/styles/tokens.css')
    const globalCss = read('src/renderer/src/styles/global.css')

    for (const token of [
      '--color-environment', '--color-glass-light', '--color-glass-dark',
      '--color-glass-border', '--shadow-glass', '--glass-blur', '--glass-saturation'
    ]) expect(tokens).toContain(token)

    expect(globalCss).toMatch(/\.glass-panel\s*\{[^}]*background:\s*var\(--color-glass-light\)/s)
    expect(globalCss).toMatch(/\.glass-panel\s*\{[^}]*color:\s*var\(--color-text\)/s)
    expect(globalCss).toMatch(/\.glass-panel\s*\{[^}]*backdrop-filter:/s)
    expect(globalCss).toMatch(/@supports not \(backdrop-filter: blur\(1px\)\)[\s\S]*?\.glass-panel\s*\{[^}]*background:\s*var\(--color-glass-light-solid\)/s)
    expect(globalCss).toMatch(/\.glass-toolbar\s*\{[^}]*backdrop-filter:/s)
    expect(globalCss).toMatch(/\.glass-button\s*\{[^}]*backdrop-filter:/s)
    expect(globalCss).toMatch(/@supports not \(backdrop-filter: blur\(1px\)\)/)
    expect(globalCss).toMatch(/@media \(prefers-reduced-transparency: reduce\)/)
    expect(globalCss).toMatch(/@media \(forced-colors: active\)/)
  })
})
