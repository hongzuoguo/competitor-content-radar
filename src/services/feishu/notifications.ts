export interface NotificationContent {
  title: string
  summary: string
}

export async function sendWebhookNotification(
  webhookUrl: string,
  content: NotificationContent,
  fetchImplementation: typeof fetch = fetch
): Promise<void> {
  const url = new URL(webhookUrl)
  if (url.protocol !== 'https:' || url.hostname !== 'open.feishu.cn') {
    throw new Error('INVALID_FEISHU_WEBHOOK_URL')
  }
  const response = await fetchImplementation(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: content.title }, template: 'turquoise' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: content.summary } }]
      }
    })
  })
  if (!response.ok) throw new Error(`FEISHU_WEBHOOK_HTTP_${response.status}`)
}
