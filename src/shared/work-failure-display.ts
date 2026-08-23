import type { WorkListItem } from './ipc-contract'

export const SAFE_WORK_FAILURES = {
  IMPORT_DUPLICATE: '已存在相同作品。',
  DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE: '无法从该抖音作品获取可下载视频，请改为上传本地视频。',
  DOUYIN_MEDIA_URL_MISSING: '无法从该抖音作品获取可下载视频，请改为上传本地视频。',
  APP_INTERRUPTED: '应用上次在处理期间退出，请重试此任务。',
  SOURCE_INPUT_REQUIRED: '导入来源未准备完成，请重新导入。',
  IMPORT_PREPARATION_MISSING: '导入来源未准备完成，请重新导入。',
  FILE_NOT_FOUND: '无法读取视频文件，请确认文件仍在原位置。',
  UNSUPPORTED_VIDEO_FORMAT: '暂不支持这个视频格式，请选择 MP4、MOV、MKV 或 WebM 文件。',
  INSUFFICIENT_DISK_SPACE: '磁盘空间不足，请清理空间后重新导入。',
  MEDIA_COPY_FAILED: '视频准备失败，请确认文件仍可读取并检查磁盘空间。',
  MEDIA_MISSING: '视频文件不可用，请重新导入。',
  DOUYIN_DOWNLOAD_FAILED: '抖音视频下载失败，请稍后重试或改为上传本地视频。',
  AUDIO_EXTRACTION_FAILED: '音频提取失败，请确认视频可以正常播放后重试。',
  FFMPEG_BINARY_MISSING: '安装包缺少音频处理组件，请重新安装最新版 HitMuse。',
  FFMPEG_FAILED: '音频提取失败，请确认视频可以正常播放后重试。',
  AUDIO_MISSING: '音频文件不可用，请重试此任务。',
  ASR_FAILED: '文字转写失败，请稍后重试。',
  TRANSCRIPTION_FAILED: '文字转写失败，请稍后重试。',
  TRANSCRIPT_MISSING: '文字稿不可用，请重试此任务。',
  AI_FAILED: 'AI 服务暂时不可用，请稍后重试。',
  AI_TIMEOUT: 'AI 服务暂时不可用，请稍后重试。',
  ANALYSIS_FAILED: 'AI 服务暂时不可用，请稍后重试。',
  AI_ANALYSIS_INVALID: 'AI 返回的拆解格式仍不完整，已尝试自动修复和重新生成；请稍后重试。',
  AGENT_ENGINE_UNAVAILABLE: '本地 Codex 引擎未就绪，请重启应用后重试。',
  AGENT_CLI_NOT_FOUND: '未检测到 Codex CLI，请先安装并登录 Codex，然后到设置点「重新检测 Codex」。',
  AGENT_CLI_SPAWN_FAILED: 'Codex CLI 启动失败，请到设置点「重新检测 Codex」后重试。',
  AGENT_CLI_TIMEOUT: 'Codex 拆解超时（超过 5 分钟），请重试或检查 Codex 状态。',
  AGENT_ANALYSIS_FAILED: 'Codex 拆解失败，请查看详情或到设置点「重新检测 Codex」后重试。',
  AGENT_ENDPOINT_UNAVAILABLE: '本地 Codex 接口未运行，请重启应用后重试。',
  SCRAPLING_ENGINE_INTERNAL: '抖音采集引擎内部出错(可能该博主页面受限或反爬)，已自动跳过，可稍后重试。',
  DOUYIN_SAFETY_CHALLENGE: '抖音需要人工完成安全验证，请在登录窗口完成验证后重试。',
  MEDIA_DOWNLOAD_HTTP_403: '视频下载被抖音拒绝(403)，该视频可能受限，已自动跳过。',
  MEDIA_DOWNLOAD_HTTP_416: '视频链接已失效(416)，该作品可能已删除，已自动跳过。',
  UNSAFE_MEDIA_URL: '视频链接不安全，已自动跳过该作品。',
  MEDIA_DOWNLOAD_TRANSPORT_FAILED: '视频下载网络失败，请稍后重试。',
  MEDIA_DOWNLOAD_INVALID_REDIRECT: '视频下载地址跳转异常，该作品可能受限，已自动跳过。',
  MEDIA_DOWNLOAD_TOO_MANY_REDIRECTS: '视频下载跳转过多，已自动跳过该作品。',
  MEDIA_DOWNLOAD_SIZE_MISMATCH: '视频下载内容不完整，请稍后重试。',
  MEDIA_DOWNLOAD_INVALID_CONTENT_RANGE: '视频下载范围异常，请稍后重试或改为上传本地视频。',
  WORK_PROCESSING_FAILED: '作品处理失败，请检查模型设置后重试。'
} as const

export type SafeWorkFailureCode = keyof typeof SAFE_WORK_FAILURES

const STAGE_FALLBACKS: Record<WorkListItem['stage'], string> = {
  discovered: '视频准备失败，请稍后重试或重新导入。',
  downloaded: '音频提取失败，请确认视频可以正常播放后重试。',
  audio_extracted: '文字转写失败，请稍后重试。',
  transcribed: 'AI 服务暂时不可用，请稍后重试。',
  analyzed: '结果保存失败，请稍后重试。',
  synced: '同步失败，请稍后重试。',
  completed: '任务未能完成，请稍后重试。'
}

export function safeWorkFailure(code: unknown, stage: WorkListItem['stage']): Readonly<{ code: SafeWorkFailureCode; message: string }> {
  if (typeof code === 'string' && Object.hasOwn(SAFE_WORK_FAILURES, code)) {
    const known = code as SafeWorkFailureCode
    return Object.freeze({ code: known, message: SAFE_WORK_FAILURES[known] })
  }
  return Object.freeze({ code: 'WORK_PROCESSING_FAILED', message: STAGE_FALLBACKS[stage] })
}
