import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/services/database/database'
import { AppRepositories } from '../../src/services/database/repositories'
import { ImportService, type ImportServiceDependencies } from '../../src/services/import/import-service'

describe('ImportService', () => {
  let database: AppDatabase
  let repositories: AppRepositories

  beforeEach(() => {
    database = new AppDatabase(':memory:')
    repositories = new AppRepositories(database.connection)
  })
  afterEach(() => database.close())

  function dependencies(overrides: Partial<ImportServiceDependencies> = {}): ImportServiceDependencies {
    return {
      repositories,
      mediaRoot: 'managed',
      ingestLocal: vi.fn(async () => ({
        sourceType: 'local_file', sourceKey: 'sha256:abc', title: 'clip.mp4',
        mediaPath: 'managed/abc/video.mp4', originalUrl: null
      })),
      resolveDouyin: vi.fn(async () => ({
        sourceType: 'douyin_url', sourceKey: 'douyin:42', title: 'remote',
        originalUrl: 'https://www.douyin.com/video/42', downloadUrl: 'https://cdn.example/video?token=secret'
      })),
      download: vi.fn(async (_url, path) => path),
      processor: {
        extractAudio: vi.fn(async () => 'managed/audio.wav'),
        transcribe: vi.fn(async () => 'transcript'),
        analyze: vi.fn(async () => ({
          result: { referenceValueScore: 80 }, provider: 'test', model: 'model',
          promptVersion: 'v1', tokenUsage: null
        }))
      },
      getSettings: vi.fn(() => ({})),
      ...overrides
    }
  }

  it('returns an accepted local work while its persisted job completes in the background', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const deps = dependencies({ processor: {
      extractAudio: vi.fn(async () => { await blocked; return 'managed/audio.wav' }),
      transcribe: vi.fn(async () => 'words'),
      analyze: vi.fn(async () => ({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null }))
    } })
    const service = new ImportService(deps)

    const result = await service.start({ type: 'local', path: 'source.mp4', creatorId: null })
    expect(result).toEqual({ accepted: true, workId: expect.any(String) })
    expect(repositories.jobs.get(result.workId)?.status).toBe('running')
    release()
    await vi.waitFor(() => expect(repositories.jobs.get(result.workId)?.status).toBe('completed'))
    expect(repositories.analyses.get(result.workId)?.transcript).toBe('words')
  })

  it('downloads Douyin media into managed storage and then uses the shared processor', async () => {
    const deps = dependencies()
    const service = new ImportService(deps)
    const result = await service.start({ type: 'douyin', url: 'https://www.douyin.com/video/42', creatorId: null })
    expect(result.accepted).toBe(true)
    await vi.waitFor(() => expect(deps.processor.analyze).toHaveBeenCalled())
    expect(deps.download).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('managed'))
    expect(deps.processor.extractAudio).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('managed'))
  })

  it('rejects duplicates without running media or processing operations', async () => {
    const deps = dependencies()
    const service = new ImportService(deps)
    const first = await service.start({ type: 'local', path: 'one.mp4', creatorId: null })
    expect(first.accepted).toBe(true)
    await vi.waitFor(() => expect(repositories.jobs.get(first.workId)?.status).toBe('completed'))
    vi.mocked(deps.processor.extractAudio).mockClear()

    await expect(service.start({ type: 'local', path: 'same.mp4', creatorId: null })).resolves.toEqual({
      accepted: false, reason: 'duplicate', existingWorkId: first.workId
    })
    expect(deps.processor.extractAudio).not.toHaveBeenCalled()
  })

  it('validates a non-null creator before ingesting or creating records', async () => {
    const deps = dependencies()
    const service = new ImportService(deps)
    await expect(service.start({ type: 'local', path: 'private/path.mp4', creatorId: 'missing' }))
      .rejects.toMatchObject({ code: 'INVALID_CREATOR' })
    expect(deps.ingestLocal).not.toHaveBeenCalled()
    expect(repositories.works.listAll()).toEqual([])
    expect(repositories.jobs.list()).toEqual([])
  })

  it('persists a transcript on AI failure and retries analysis only', async () => {
    const analyze = vi.fn().mockRejectedValueOnce(Object.assign(new Error('key=super-secret'), { code: 'AI_FAILED' }))
      .mockResolvedValueOnce({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null })
    const report = vi.fn()
    const deps = dependencies({ processor: {
      extractAudio: vi.fn(async () => 'managed/audio.wav'),
      transcribe: vi.fn(async () => 'saved transcript'), analyze
    }, report })
    const service = new ImportService(deps)
    const started = await service.start({ type: 'local', path: 'source.mp4', creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('failed'))
    expect(repositories.jobs.get(started.workId)).toMatchObject({ stage: 'transcribed', errorCode: 'AI_FAILED', attemptCount: 1 })
    expect(repositories.jobs.get(started.workId)?.errorMessage).not.toContain('super-secret')
    expect(repositories.artifacts.get(started.workId)?.transcript).toBe('saved transcript')

    await expect(service.retry(started.workId)).resolves.toEqual({ accepted: true, workId: started.workId })
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('completed'))
    expect(deps.processor.extractAudio).toHaveBeenCalledTimes(1)
    expect(deps.processor.transcribe).toHaveBeenCalledTimes(1)
    expect(analyze).toHaveBeenCalledTimes(2)
  })

  it('serializes transcription while allowing two imports to run', async () => {
    let active = 0
    let maximum = 0
    const transcribe = vi.fn(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 15))
      active -= 1
      return 'words'
    })
    let source = 0
    const deps = dependencies({
      ingestLocal: vi.fn(async () => ({ sourceType: 'local_file', sourceKey: `sha256:${++source}`, title: 'x', mediaPath: `managed/${source}.mp4`, originalUrl: null })),
      processor: { extractAudio: vi.fn(async (_id) => `managed/${_id}.wav`), transcribe, analyze: vi.fn(async () => ({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null })) }
    })
    const service = new ImportService(deps)
    const [one, two] = await Promise.all([
      service.start({ type: 'local', path: 'one.mp4', creatorId: null }),
      service.start({ type: 'local', path: 'two.mp4', creatorId: null })
    ])
    if (!one.accepted || !two.accepted) throw new Error('expected accepted imports')
    await vi.waitFor(() => expect(repositories.jobs.get(two.workId)?.status).toBe('completed'))
    expect(maximum).toBe(1)
  })

  it('reuses extracted audio when transcription is retried', async () => {
    const transcribe = vi.fn().mockRejectedValueOnce(Object.assign(new Error('asr failed'), { code: 'ASR_FAILED' }))
      .mockResolvedValueOnce('recovered')
    const deps = dependencies({ processor: {
      extractAudio: vi.fn(async () => 'managed/audio.wav'), transcribe,
      analyze: vi.fn(async () => ({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null }))
    } })
    const service = new ImportService(deps)
    const started = await service.start({ type: 'local', path: 'source.mp4', creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('failed'))
    expect(repositories.jobs.get(started.workId)?.stage).toBe('audio_extracted')
    await service.retry(started.workId)
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('completed'))
    expect(deps.processor.extractAudio).toHaveBeenCalledTimes(1)
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it('rejects retry for running and completed jobs with stable codes', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const service = new ImportService(dependencies({ processor: {
      extractAudio: vi.fn(async () => { await blocked; return 'managed/audio.wav' }),
      transcribe: vi.fn(async () => 'words'),
      analyze: vi.fn(async () => ({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null }))
    } }))
    const started = await service.start({ type: 'local', path: 'source.mp4', creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    await expect(service.retry(started.workId)).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    release()
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('completed'))
    await expect(service.retry(started.workId)).rejects.toMatchObject({ code: 'JOB_NOT_RETRYABLE' })
  })
})
