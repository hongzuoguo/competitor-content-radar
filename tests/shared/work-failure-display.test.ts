import { describe, expect, it } from 'vitest'
import { safeWorkFailure } from '../../src/shared/work-failure-display'

describe('safe work failure display', () => {
  it.each([
    ['AI_ANALYSIS_INVALID', 'AI 返回的拆解格式仍不完整'],
    ['AGENT_CLI_NOT_FOUND', '未检测到 Codex CLI'],
    ['MEDIA_DOWNLOAD_HTTP_403', '视频下载被抖音拒绝'],
    ['FFMPEG_BINARY_MISSING', '安装包缺少音频处理组件'],
    ['TRANSCRIPTION_FAILED', '文字转写失败']
  ])('preserves the existing fixed copy for %s', (code, message) => {
    expect(safeWorkFailure(code, 'analyzed').message).toContain(message)
  })

  it('uses a fixed stage fallback for unknown codes', () => {
    expect(safeWorkFailure('Bearer secret-token', 'transcribed')).toEqual({
      code: 'WORK_PROCESSING_FAILED', message: 'AI 服务暂时不可用，请稍后重试。'
    })
  })
})
