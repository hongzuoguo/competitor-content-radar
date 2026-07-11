import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/Button'

export function CreatorForm({
  disabled,
  onAdd
}: {
  disabled: boolean
  onAdd(url: string): void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    if (!/^https:\/\/(www\.)?douyin\.com\/user\/[^/?]+/.test(url.trim())) {
      setError('请粘贴完整的抖音博主主页地址')
      return
    }
    onAdd(url.trim())
    setUrl('')
    setError('')
  }

  return (
    <form className="creator-form" onSubmit={submit}>
      <div className="form-field creator-form__field">
        <label htmlFor="creator-url">抖音博主主页</label>
        <div className="creator-form__input-row">
          <input
            aria-describedby={error ? 'creator-url-error' : 'creator-url-help'}
            disabled={disabled}
            id="creator-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.douyin.com/user/..."
            type="url"
            value={url}
          />
          <Button disabled={disabled} icon={<Plus size={16} />} type="submit">添加博主</Button>
        </div>
        {error ? <span className="form-error" id="creator-url-error">{error}</span> : <span className="form-help" id="creator-url-help">首次添加会采集最近 30 条公开作品作为数据基线。</span>}
      </div>
    </form>
  )
}
