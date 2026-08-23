export const FEISHU_TEMPLATE_APP_TOKEN = 'UhZ6bYe6aafexms9WGXcomHInic'
export const FEISHU_TEMPLATE_URL = `https://my.feishu.cn/base/${FEISHU_TEMPLATE_APP_TOKEN}`

export function isFeishuTemplateUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const templateUrl = new URL(FEISHU_TEMPLATE_URL)
    return (
      url.origin === templateUrl.origin &&
      (url.pathname === templateUrl.pathname ||
        url.pathname === `${templateUrl.pathname}/`)
    )
  } catch {
    return false
  }
}
