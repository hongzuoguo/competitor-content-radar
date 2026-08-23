import type { Work } from '../../core/domain'

export interface DouyinSingleVideoCapturePort {
  captureSingleVideo(videoId: string, url: string): Promise<{ title: string; downloadUrl: string | null } | null>
}

export async function refreshDouyinWorkSource(
  work: Work,
  capture: DouyinSingleVideoCapturePort
): Promise<Work> {
  if (!isRefreshableDouyinWork(work)) return work

  const videoId = work.platformWorkId!
  const captured = await capture.captureSingleVideo(videoId, `https://www.douyin.com/video/${videoId}`)
  if (!captured?.downloadUrl) {
    throw Object.assign(new Error('无法重新获取该作品的可下载媒体地址'), {
      code: 'DOUYIN_MEDIA_REFRESH_FAILED',
      retryable: true
    })
  }

  return {
    ...work,
    title: captured.title.trim() || work.title,
    downloadUrl: captured.downloadUrl
  }
}

function isRefreshableDouyinWork(work: Work): boolean {
  return (work.sourceType === 'douyin_monitor' || work.sourceType === 'douyin_url') &&
    Boolean(work.platformWorkId && /^\d+$/.test(work.platformWorkId))
}
