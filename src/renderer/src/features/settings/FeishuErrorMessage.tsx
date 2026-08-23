import type { FeishuUserError } from '../../../../shared/ipc-contract'

interface FeishuErrorMessageProps {
  error: FeishuUserError
  id: string
}

export function FeishuErrorMessage({ error, id }: FeishuErrorMessageProps): React.JSX.Element {
  return (
    <div className="settings-error" id={id} role="alert">
      <strong>{error.title}</strong>
      <p>可能原因：{error.reason}</p>
      <p>处理方法：{error.action}</p>
      <small>错误代码：{error.code}</small>
    </div>
  )
}
