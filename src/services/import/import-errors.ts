export type ImportErrorCode =
  | 'FILE_NOT_FOUND'
  | 'UNSUPPORTED_VIDEO_FORMAT'
  | 'INSUFFICIENT_DISK_SPACE'
  | 'MEDIA_COPY_FAILED'

export interface ImportErrorOptions {
  action?: string
  retryable?: boolean
  cause?: unknown
}

export class ImportError extends Error {
  readonly code: ImportErrorCode
  readonly action?: string
  readonly retryable?: boolean

  constructor(code: ImportErrorCode, message: string, options: ImportErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'ImportError'
    this.code = code
    this.action = options.action
    this.retryable = options.retryable
  }
}
