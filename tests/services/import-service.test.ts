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

  it('returns immediately with persisted records while local preparation is still pending', async () => {
    let rejectPreparation!: (error: Error) => void
    const preparation = new Promise<never>((_resolve, reject) => { rejectPreparation = reject })
    const deps = dependencies({ ingestLocal: vi.fn(() => preparation) })
    const service = new ImportService(deps)

    const result = await Promise.race([
      service.start({ type: 'local', path: 'source.mp4', creatorId: null }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('START_BLOCKED')), 20))
    ])
    expect(result).toEqual({ accepted: true, workId: expect.any(String) })
    expect(repositories.jobs.get(result.workId)?.status).toBe('running')
    expect(repositories.works.get(result.workId)?.sourceKey).toBe(`pending:${result.workId}`)
    rejectPreparation(Object.assign(new Error('C:\\secret\\name.mp4?token=abc'), { code: 'MEDIA_COPY_FAILED' }))
    await vi.waitFor(() => expect(repositories.jobs.get(result.workId)?.status).toBe('failed'))
    expect(repositories.jobs.get(result.workId)?.errorCode).toBe('MEDIA_COPY_FAILED')
  })

  it('emits only after state is readable and stops after unsubscribe', async () => {
    let finishPreparation!: (value: Awaited<ReturnType<ImportServiceDependencies['ingestLocal']>>) => void
    const preparation = new Promise<Awaited<ReturnType<ImportServiceDependencies['ingestLocal']>>>((resolve) => { finishPreparation = resolve })
    const service = new ImportService(dependencies({ ingestLocal: vi.fn(() => preparation) }))
    const observed: Array<{ workId: string; status: string | undefined }> = []
    const unsubscribe = service.subscribe((workId) => {
      observed.push({ workId, status: repositories.jobs.get(workId)?.status })
    })

    const started = await service.start({ type: 'local', path: 'source.mp4', creatorId: null })
    expect(observed).toEqual([{ workId: started.workId, status: 'running' }])
    unsubscribe()
    finishPreparation({ sourceType: 'local_file', sourceKey: 'sha256:event', title: 'source.mp4', mediaPath: 'managed/event/video.mp4', originalUrl: null })
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('completed'))
    expect(observed).toHaveLength(1)
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

  it('returns immediately while Douyin resolution is pending and records its failure', async () => {
    let rejectResolution!: (error: Error) => void
    const resolution = new Promise<never>((_resolve, reject) => { rejectResolution = reject })
    const service = new ImportService(dependencies({ resolveDouyin: vi.fn(() => resolution) }))
    const started = await Promise.race([
      service.start({ type: 'douyin', url: 'https://v.douyin.com/abc/', creatorId: null }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('START_BLOCKED')), 20))
    ])
    expect(started.accepted).toBe(true)
    if (!started.accepted) throw new Error('expected accepted import')
    expect(repositories.jobs.get(started.workId)?.status).toBe('running')
    rejectResolution(Object.assign(new Error('https://signed.example/video?token=private'), { code: 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE' }))
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('failed'))
  })

  it('accepts a provisional duplicate then converges to the existing work without processing', async () => {
    const deps = dependencies()
    const service = new ImportService(deps)
    const first = await service.start({ type: 'local', path: 'one.mp4', creatorId: null })
    expect(first.accepted).toBe(true)
    await vi.waitFor(() => expect(repositories.jobs.get(first.workId)?.status).toBe('completed'))
    vi.mocked(deps.processor.extractAudio).mockClear()

    const duplicate = await service.start({ type: 'local', path: 'same.mp4', creatorId: null })
    expect(duplicate).toEqual({ accepted: true, workId: expect.any(String) })
    if (!duplicate.accepted) throw new Error('expected provisional import')
    await vi.waitFor(() => expect(repositories.jobs.get(duplicate.workId)?.errorCode).toBe('IMPORT_DUPLICATE'))
    expect(repositories.artifacts.get(duplicate.workId)?.existingWorkId).toBe(first.workId)
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

  it('rejects an empty source before creating provisional records', async () => {
    const service = new ImportService(dependencies())
    await expect(service.start({ type: 'local', path: '   ', creatorId: null }))
      .rejects.toMatchObject({ code: 'INVALID_IMPORT_INPUT' })
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

  it('reports only stable sanitized failure detail', async () => {
    const secret = 'C:\\secret\\name.mp4?token=abc&key=api-secret'
    const report = vi.fn()
    const service = new ImportService(dependencies({
      ingestLocal: vi.fn().mockRejectedValue(Object.assign(new Error(secret), { code: 'MEDIA_COPY_FAILED' })),
      report
    }))
    const started = await service.start({ type: 'local', path: secret, creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    await vi.waitFor(() => expect(report).toHaveBeenCalled())
    const serialized = JSON.stringify(report.mock.calls)
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('token=abc')
    expect(report).toHaveBeenCalledWith('error', 'Import processing failed', {
      workId: started.workId, stage: 'discovered', errorCode: 'MEDIA_COPY_FAILED'
    })
  })

  it('rolls back analysis when advancing the completed stage fails', async () => {
    const deps = dependencies()
    const originalSave = repositories.jobs.save.bind(repositories.jobs)
    let failCompletion = true
    vi.spyOn(repositories.jobs, 'save').mockImplementation((job) => {
      if (failCompletion && job.stage === 'completed') throw new Error('SECOND_WRITE_FAILED')
      originalSave(job)
    })
    const service = new ImportService(deps)
    const started = await service.start({ type: 'local', path: 'source.mp4', creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('failed'))
    expect(repositories.jobs.get(started.workId)?.stage).toBe('transcribed')
    expect(repositories.analyses.get(started.workId)).toBeNull()

    failCompletion = false
    await service.retry(started.workId)
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('completed'))
    expect(deps.processor.analyze).toHaveBeenCalledTimes(2)
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

  it('waits for active work during shutdown and rejects new imports', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const service = new ImportService(dependencies({ processor: {
      extractAudio: vi.fn(async () => { await blocked; return 'managed/audio.wav' }),
      transcribe: vi.fn(async () => 'words'),
      analyze: vi.fn(async () => ({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null }))
    } }))
    const started = await service.start({ type: 'local', path: 'source.mp4', creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    let drained = false
    const shutdown = service.shutdown().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    await expect(service.start({ type: 'local', path: 'another.mp4', creatorId: null }))
      .rejects.toMatchObject({ code: 'APP_SHUTTING_DOWN' })
    release()
    await shutdown
    expect(repositories.jobs.get(started.workId)?.status).toBe('completed')
    database.close()
    expect(database.connection.open).toBe(false)
    database = new AppDatabase(':memory:')
  })

  it('contains failures from its terminal catch without unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      let failWrites = false
      const originalSave = repositories.jobs.save.bind(repositories.jobs)
      vi.spyOn(repositories.jobs, 'save').mockImplementation((job) => {
        if (failWrites) throw new Error('DATABASE_CLOSED')
        originalSave(job)
      })
      const service = new ImportService(dependencies({
        ingestLocal: vi.fn(async () => { throw new Error('preparation failed') }),
        report: vi.fn(() => { throw new Error('LOGGER_FAILED') })
      }))
      const started = await service.start({ type: 'local', path: 'source.mp4', creatorId: null })
      if (!started.accepted) throw new Error('expected accepted import')
      failWrites = true
      await service.shutdown()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
