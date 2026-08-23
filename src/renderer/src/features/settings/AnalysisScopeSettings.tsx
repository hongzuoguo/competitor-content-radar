import { useState } from 'react'

interface AnalysisScopeSettingsProps {
  maxWorksPerCreator?: number
  recentDays?: number
  showErrors?: boolean
}

function validateInteger(value: string, min: number, max: number, emptyMessage: string): string {
  if (value.trim() === '') return emptyMessage
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return `请输入 ${min} 到 ${max} 之间的整数`
  }
  return ''
}

export function validateAnalysisMaxWorks(value: string): string {
  return validateInteger(value, 1, 30, '请输入每位博主拆解数量')
}

export function validateAnalysisRecentDays(value: string): string {
  return validateInteger(value, 1, 365, '请输入拆解天数')
}

export function AnalysisScopeSettings({
  maxWorksPerCreator = 10,
  recentDays = 30,
  showErrors = false
}: AnalysisScopeSettingsProps): React.JSX.Element {
  const [maxWorks, setMaxWorks] = useState(String(maxWorksPerCreator))
  const [days, setDays] = useState(String(recentDays))
  const [maxWorksTouched, setMaxWorksTouched] = useState(false)
  const [daysTouched, setDaysTouched] = useState(false)
  const maxWorksError = validateAnalysisMaxWorks(maxWorks)
  const daysError = validateAnalysisRecentDays(days)

  return (
    <section className="settings-section" aria-labelledby="analysis-scope-settings-title">
      <div className="settings-section__heading">
        <div>
          <h3 id="analysis-scope-settings-title">拆解数量与时间范围</h3>
          <p>限制每位博主每次自动拆解的作品数量和发布时间范围。</p>
        </div>
      </div>
      <div className="settings-grid">
        <div className="form-field">
          <label htmlFor="analysis-max-works">每位博主最多拆解</label>
          <span className="number-field">
            <input
              aria-describedby={maxWorksError ? 'analysis-max-works-error' : undefined}
              aria-invalid={Boolean(maxWorksError)}
              id="analysis-max-works"
              max="30"
              min="1"
              name="analysisMaxWorksPerCreator"
              onChange={(event) => {
                setMaxWorks(event.target.value)
                setMaxWorksTouched(true)
              }}
              required
              step="1"
              type="number"
              value={maxWorks}
            /> 条
          </span>
          {maxWorksError && (maxWorksTouched || showErrors) ? <span className="form-error" id="analysis-max-works-error" role="alert">{maxWorksError}</span> : null}
        </div>
        <div className="form-field analysis-scope__recent">
          <label htmlFor="analysis-recent-days">拆解最近</label>
          <span className="number-field">
            <input
              aria-describedby={daysError ? 'analysis-recent-days-error' : undefined}
              aria-invalid={Boolean(daysError)}
              id="analysis-recent-days"
              max="365"
              min="1"
              name="analysisRecentDays"
              onChange={(event) => {
                setDays(event.target.value)
                setDaysTouched(true)
              }}
              required
              step="1"
              type="number"
              value={days}
            /> 天
          </span>
          {daysError && (daysTouched || showErrors) ? <span className="form-error" id="analysis-recent-days-error" role="alert">{daysError}</span> : null}
        </div>
        <p className="form-help settings-grid__wide">最近 {days || '—'} 天内，最多拆解最新 {maxWorks || '—'} 条；已拆解作品不会重复消耗额度。</p>
      </div>
    </section>
  )
}
