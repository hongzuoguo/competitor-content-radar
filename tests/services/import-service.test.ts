import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/services/database/database'
import { AppRepositories } from '../../src/services/database/repositories'
import { ImportService, type ImportServiceDependencies } from '../../src/services/import/import-service'
import { ImportError } from '../../src/services/import/import-errors'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
      service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null }),
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

    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
    expect(observed).toEqual([{ workId: started.workId, status: 'running' }])
    unsubscribe()
    finishPreparation({ sourceType: 'local_file', sourceKey: 'sha256:event', title: 'source.mp4', mediaPath: 'managed/event/video.mp4', originalUrl: null })
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('completed'))
    expect(observed).toHaveLength(1)
  })

  it('isolates listener failures from persisted state and background launch', async () => {
    const service = new ImportService(dependencies())
    const healthyListener = vi.fn()
    service.subscribe(() => { throw new Error('renderer destroyed') })
    service.subscribe(healthyListener)

    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
    expect(repositories.jobs.get(started.workId)?.status).toBe('running')
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('completed'))
    expect(healthyListener).toHaveBeenCalled()
  })

  it('downloads Douyin media into managed storage and then uses the shared processor', async () => {
    const deps = dependencies()
    const service = new ImportService(deps)
    const result = await service.start({ source: { type: 'douyin_url', url: 'https://www.douyin.com/video/42' }, creatorId: null })
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
      service.start({ source: { type: 'douyin_url', url: 'https://v.douyin.com/abc/' }, creatorId: null }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('START_BLOCKED')), 20))
    ])
    expect(started.accepted).toBe(true)
    if (!started.accepted) throw new Error('expected accepted import')
    expect(repositories.jobs.get(started.workId)?.status).toBe('running')
    rejectResolution(Object.assign(new Error('https://signed.example/video?token=private'), { code: 'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE' }))
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('failed'))
  })

  it('keeps resolved Douyin metadata when media remains unavailable', async () => {
    const error = new ImportError(
      'DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE',
      '请改为上传本地视频。',
      {
        action: 'upload_local',
        retryable: false,
        partialSource: {
          sourceKey: 'douyin:7658',
          title: '公开文案',
          originalUrl: 'https://www.douyin.com/video/7658'
        }
      }
    )
    const service = new ImportService(dependencies({
      resolveDouyin: vi.fn().mockRejectedValue(error)
    }))

    const started = await service.start({
      source: { type: 'douyin_url', url: 'https://www.douyin.com/user/self?modal_id=7658' },
      creatorId: null
    })
    if (!started.accepted) throw new Error('expected accepted import')
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('failed'))

    expect(repositories.works.get(started.workId)).toMatchObject({
      sourceKey: 'douyin:7658',
      title: '公开文案',
      originalUrl: 'https://www.douyin.com/video/7658',
      downloadUrl: null
    })
    expect(repositories.jobs.get(started.workId)?.errorCode).toBe('DOUYIN_VIDEO_DOWNLOAD_UNAVAILABLE')
  })

  it('accepts a provisional duplicate then converges to the existing work without processing', async () => {
    const deps = dependencies()
    const service = new ImportService(deps)
    const first = await service.start({ source: { type: 'local', path: 'one.mp4' }, creatorId: null })
    expect(first.accepted).toBe(true)
    await vi.waitFor(() => expect(repositories.jobs.get(first.workId)?.status).toBe('completed'))
    vi.mocked(deps.processor.extractAudio).mockClear()

    const duplicate = await service.start({ source: { type: 'local', path: 'same.mp4' }, creatorId: null })
    expect(duplicate).toEqual({ accepted: true, workId: expect.any(String) })
    if (!duplicate.accepted) throw new Error('expected provisional import')
    await vi.waitFor(() => expect(repositories.jobs.get(duplicate.workId)?.errorCode).toBe('IMPORT_DUPLICATE'))
    expect(repositories.artifacts.get(duplicate.workId)?.existingWorkId).toBe(first.workId)
    expect(deps.processor.extractAudio).not.toHaveBeenCalled()
  })

  it('validates a non-null creator before ingesting or creating records', async () => {
    const deps = dependencies()
    const service = new ImportService(deps)
    await expect(service.start({ source: { type: 'local', path: 'private/path.mp4' }, creatorId: 'missing' }))
      .rejects.toMatchObject({ code: 'INVALID_CREATOR' })
    expect(deps.ingestLocal).not.toHaveBeenCalled()
    expect(repositories.works.listAll()).toEqual([])
    expect(repositories.jobs.list()).toEqual([])
  })

  it('rejects an empty source before creating provisional records', async () => {
    const service = new ImportService(dependencies())
    await expect(service.start({ source: { type: 'local', path: '   ' }, creatorId: null }))
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
    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
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
    const started = await service.start({ source: { type: 'local', path: secret }, creatorId: null })
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
    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
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
      service.start({ source: { type: 'local', path: 'one.mp4' }, creatorId: null }),
      service.start({ source: { type: 'local', path: 'two.mp4' }, creatorId: null })
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
    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
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
    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    await expect(service.retry(started.workId)).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    release()
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('completed'))
    await expect(service.retry(started.workId)).rejects.toMatchObject({ code: 'JOB_NOT_RETRYABLE' })
  })

  it('deletes a failed task only after its managed work directory is removed', async () => {
    const mediaRoot = mkdtempSync(join(tmpdir(), 'radar-import-delete-'))
    mkdirSync(join(mediaRoot, 'failed-work'))
    writeFileSync(join(mediaRoot, 'failed-work', 'video.mp4'), 'managed')
    try {
      repositories.works.upsert({
        id: 'failed-work', creatorId: null, platformWorkId: null, sourceType: 'local_file',
        sourceKey: 'sha256:failed', mediaPath: join(mediaRoot, 'failed-work', 'video.mp4'), title: 'Failed',
        publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
        metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
      })
      repositories.jobs.save({
        workId: 'failed-work', stage: 'downloaded', status: 'failed', attemptCount: 1,
        nextAttemptAt: null, errorCode: 'MEDIA_FAILED', errorMessage: null, updatedAt: '2026-07-12T00:00:00.000Z'
      })
      const listener = vi.fn()
      const service = new ImportService(dependencies({ mediaRoot }))
      service.subscribe(listener)

      await service.deleteFailed('failed-work')

      expect(repositories.works.get('failed-work')).toBeNull()
      expect(repositories.jobs.get('failed-work')).toBeNull()
      expect(listener).toHaveBeenCalledWith('failed-work')
    } finally {
      rmSync(mediaRoot, { recursive: true, force: true })
    }
  })

  it.each([
    ['pending', 'pending'], ['running', 'running'], ['completed', 'completed']
  ] as const)('rejects deleting a %s task', async (_label, status) => {
    repositories.works.upsert({
      id: `${status}-work`, creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: `sha256:${status}`, mediaPath: null, title: status,
      publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: `${status}-work`, stage: status === 'completed' ? 'completed' : 'discovered', status,
      attemptCount: 1, nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: '2026-07-12T00:00:00.000Z'
    })
    const service = new ImportService(dependencies())
    await expect(service.deleteFailed(`${status}-work`)).rejects.toMatchObject({ code: 'WORK_DELETE_NOT_ALLOWED' })
    expect(repositories.works.get(`${status}-work`)).not.toBeNull()
  })

  it('rejects missing work with a stable code', async () => {
    const service = new ImportService(dependencies())
    await expect(service.deleteFailed('missing-work')).rejects.toMatchObject({ code: 'FAILED_WORK_NOT_FOUND' })
  })

  it('rejects deleting a work whose job record is missing', async () => {
    repositories.works.upsert({
      id: 'orphan-work', creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: 'sha256:orphan', mediaPath: null, title: 'Orphan',
      publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    const service = new ImportService(dependencies())
    await expect(service.deleteFailed('orphan-work')).rejects.toMatchObject({ code: 'FAILED_WORK_NOT_FOUND' })
    expect(repositories.works.get('orphan-work')).not.toBeNull()
  })

  it('rejects deleting active work even if its persisted job is changed to failed', async () => {
    let rejectPreparation!: (error: Error) => void
    const preparation = new Promise<never>((_resolve, reject) => { rejectPreparation = reject })
    const service = new ImportService(dependencies({ ingestLocal: vi.fn(() => preparation) }))
    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    const job = repositories.jobs.get(started.workId)!
    repositories.jobs.save({ ...job, status: 'failed', errorCode: 'TEST_FAILURE' })

    await expect(service.deleteFailed(started.workId)).rejects.toMatchObject({ code: 'WORK_DELETE_NOT_ALLOWED' })
    rejectPreparation(Object.assign(new Error('stop'), { code: 'TEST_FAILURE' }))
    await service.shutdown()
  })

  it('deletes a failed database record when its managed directory is already absent', async () => {
    const mediaRoot = mkdtempSync(join(tmpdir(), 'radar-import-delete-'))
    try {
      repositories.works.upsert({
        id: 'missing-directory', creatorId: null, platformWorkId: null, sourceType: 'local_file',
        sourceKey: 'sha256:missing-directory', mediaPath: null, title: 'Missing directory',
        publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
        metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
      })
      repositories.jobs.save({
        workId: 'missing-directory', stage: 'discovered', status: 'failed', attemptCount: 1,
        nextAttemptAt: null, errorCode: 'FAILED', errorMessage: null, updatedAt: '2026-07-12T00:00:00.000Z'
      })
      const service = new ImportService(dependencies({ mediaRoot }))

      await expect(service.deleteFailed('missing-directory')).resolves.toBeUndefined()
      expect(repositories.works.get('missing-directory')).toBeNull()
    } finally {
      rmSync(mediaRoot, { recursive: true, force: true })
    }
  })

  it('rejects deletion after shutdown starts', async () => {
    repositories.works.upsert({
      id: 'failed-after-shutdown', creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: 'sha256:failed-after-shutdown', mediaPath: null, title: 'Failed',
      publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: 'failed-after-shutdown', stage: 'discovered', status: 'failed', attemptCount: 1,
      nextAttemptAt: null, errorCode: 'FAILED', errorMessage: null, updatedAt: '2026-07-12T00:00:00.000Z'
    })
    const service = new ImportService(dependencies())
    await service.shutdown()

    await expect(service.deleteFailed('failed-after-shutdown'))
      .rejects.toMatchObject({ code: 'WORK_DELETE_NOT_ALLOWED' })
    expect(repositories.works.get('failed-after-shutdown')).not.toBeNull()
  })

  it('keeps database records when managed file cleanup fails', async () => {
    repositories.works.upsert({
      id: 'failed-work', creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: 'sha256:failed-cleanup', mediaPath: null, title: 'Failed',
      publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: 'failed-work', stage: 'discovered', status: 'failed', attemptCount: 1,
      nextAttemptAt: null, errorCode: 'FAILED', errorMessage: null, updatedAt: '2026-07-12T00:00:00.000Z'
    })
    repositories.artifacts.save({
      workId: 'failed-work', wavPath: 'managed/failed-work/audio.wav', transcript: 'saved',
      existingWorkId: null, updatedAt: '2026-07-12T00:00:00.000Z'
    })
    repositories.analyses.save({
      workId: 'failed-work', transcript: 'saved', result: {}, provider: 'test', model: 'test',
      promptVersion: 'v1', tokenUsage: null, createdAt: '2026-07-12T00:00:00.000Z'
    })
    repositories.snapshots.create({
      id: 'failed-work-snapshot', workId: 'failed-work', capturedAt: '2026-07-12T00:00:00.000Z',
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    const service = new ImportService(dependencies({
      mediaRoot: join(tmpdir(), `definitely-missing-radar-root-${process.pid}-${Date.now()}`)
    }))

    await expect(service.deleteFailed('failed-work')).rejects.toMatchObject({ code: 'FAILED_WORK_FILE_CLEANUP_FAILED' })
    expect(repositories.works.get('failed-work')).not.toBeNull()
    expect(repositories.jobs.get('failed-work')).not.toBeNull()
    expect(repositories.artifacts.get('failed-work')).not.toBeNull()
    expect(repositories.analyses.get('failed-work')).not.toBeNull()
    expect(repositories.snapshots.listByWork('failed-work')).toHaveLength(1)
  })

  it('does not allow retry to launch while failed task deletion is awaiting file cleanup', async () => {
    let releaseCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve })
    const removeManagedWorkDirectory = vi.fn(() => cleanup)
    repositories.works.upsert({
      id: 'failed-work', creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: 'sha256:delete-race', mediaPath: 'managed/failed-work/video.mp4', title: 'Failed',
      publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: 'failed-work', stage: 'downloaded', status: 'failed', attemptCount: 1,
      nextAttemptAt: null, errorCode: 'MEDIA_FAILED', errorMessage: null, updatedAt: '2026-07-12T00:00:00.000Z'
    })
    const deps = dependencies({ removeManagedWorkDirectory })
    const service = new ImportService(deps)

    const deletion = service.deleteFailed('failed-work')
    await vi.waitFor(() => expect(removeManagedWorkDirectory).toHaveBeenCalledOnce())
    await expect(service.deleteFailed('failed-work')).rejects.toMatchObject({ code: 'WORK_DELETE_NOT_ALLOWED' })
    await expect(service.retry('failed-work')).rejects.toMatchObject({ code: 'WORK_DELETE_NOT_ALLOWED' })
    expect(deps.processor.extractAudio).not.toHaveBeenCalled()

    releaseCleanup()
    await deletion
    expect(repositories.works.get('failed-work')).toBeNull()
  })

  it('releases the deletion lock when file cleanup fails', async () => {
    const removeManagedWorkDirectory = vi.fn()
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockResolvedValueOnce(undefined)
    repositories.works.upsert({
      id: 'failed-work', creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: 'sha256:delete-retry', mediaPath: null, title: 'Failed',
      publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: 'failed-work', stage: 'discovered', status: 'failed', attemptCount: 1,
      nextAttemptAt: null, errorCode: 'FAILED', errorMessage: null, updatedAt: '2026-07-12T00:00:00.000Z'
    })
    const service = new ImportService(dependencies({ removeManagedWorkDirectory }))

    await expect(service.deleteFailed('failed-work'))
      .rejects.toMatchObject({ code: 'FAILED_WORK_FILE_CLEANUP_FAILED' })
    await expect(service.deleteFailed('failed-work')).resolves.toBeUndefined()
    expect(removeManagedWorkDirectory).toHaveBeenCalledTimes(2)
    expect(repositories.works.get('failed-work')).toBeNull()
  })

  it('waits for an in-progress failed task deletion during shutdown', async () => {
    let releaseCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve })
    repositories.works.upsert({
      id: 'failed-work', creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: 'sha256:shutdown-delete', mediaPath: null, title: 'Failed',
      publishedAt: '2026-07-12T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: 'failed-work', stage: 'discovered', status: 'failed', attemptCount: 1,
      nextAttemptAt: null, errorCode: 'FAILED', errorMessage: null, updatedAt: '2026-07-12T00:00:00.000Z'
    })
    const service = new ImportService(dependencies({ removeManagedWorkDirectory: vi.fn(() => cleanup) }))

    const deletion = service.deleteFailed('failed-work')
    let shutdownFinished = false
    const shutdown = service.shutdown().then(() => { shutdownFinished = true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(shutdownFinished).toBe(false)

    releaseCleanup()
    await deletion
    await shutdown
    expect(repositories.works.get('failed-work')).toBeNull()
  })

  it('waits for active work during shutdown and rejects new imports', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const service = new ImportService(dependencies({ processor: {
      extractAudio: vi.fn(async () => { await blocked; return 'managed/audio.wav' }),
      transcribe: vi.fn(async () => 'words'),
      analyze: vi.fn(async () => ({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null }))
    } }))
    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    let drained = false
    const shutdown = service.shutdown().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    await expect(service.start({ source: { type: 'local', path: 'another.mp4' }, creatorId: null }))
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
      const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
      if (!started.accepted) throw new Error('expected accepted import')
      failWrites = true
      await service.shutdown()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('notifies after a completed import is persisted', async () => {
    const notify = vi.fn(async () => undefined)
    const service = new ImportService(dependencies({ notification: { notify } }))

    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    await service.shutdown()

    expect(repositories.jobs.get(started.workId)?.status).toBe('completed')
    expect(notify).toHaveBeenCalledWith({
      workId: started.workId,
      status: 'completed',
      stage: 'completed',
      errorCode: null,
      retryable: false
    })
  })

  it('notifies a failed stage without allowing notification errors to change persisted state', async () => {
    const notify = vi.fn(async () => { throw new Error('notifications unavailable') })
    const service = new ImportService(dependencies({
      processor: {
        extractAudio: vi.fn(async () => 'managed/audio.wav'),
        transcribe: vi.fn(async () => 'words'),
        analyze: vi.fn(async () => { throw Object.assign(new Error('AI failed'), { code: 'AI_FAILED' }) })
      },
      notification: { notify }
    }))

    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    await service.shutdown()

    expect(repositories.jobs.get(started.workId)).toMatchObject({
      status: 'failed', stage: 'transcribed', errorCode: 'AI_FAILED'
    })
    expect(notify).toHaveBeenCalledWith({
      workId: started.workId,
      status: 'failed',
      stage: 'transcribed',
      errorCode: 'AI_FAILED',
      retryable: true
    })
  })

  it('waits for terminal cleanup before shutdown resolves', async () => {
    let releaseCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => { releaseCleanup = resolve })
    const afterSettled = vi.fn(() => cleanup)
    const service = new ImportService(dependencies({ afterSettled }))
    const started = await service.start({ source: { type: 'local', path: 'source.mp4' }, creatorId: null })
    if (!started.accepted) throw new Error('expected accepted import')
    await vi.waitFor(() => expect(repositories.jobs.get(started.workId)?.status).toBe('completed'))

    let stopped = false
    const shutdown = service.shutdown().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    releaseCleanup()
    await shutdown
    expect(afterSettled).toHaveBeenCalledOnce()
  })

  it('runs cleanup once only after concurrent imports have all settled', async () => {
    let releaseSecond!: () => void
    const secondBlocked = new Promise<void>((resolve) => { releaseSecond = resolve })
    let source = 0
    const afterSettled = vi.fn()
    const service = new ImportService(dependencies({
      ingestLocal: vi.fn(async () => {
        source += 1
        return {
          sourceType: 'local_file', sourceKey: `sha256:${source}`, title: `${source}.mp4`,
          mediaPath: `managed/${source}/video.mp4`, originalUrl: null
        }
      }),
      processor: {
        extractAudio: vi.fn(async (_id, mediaPath) => {
          if (mediaPath.includes('managed/2/')) await secondBlocked
          return `${mediaPath}.wav`
        }),
        transcribe: vi.fn(async () => 'words'),
        analyze: vi.fn(async () => ({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null }))
      },
      afterSettled
    }))

    const first = await service.start({ source: { type: 'local', path: 'one.mp4' }, creatorId: null })
    const second = await service.start({ source: { type: 'local', path: 'two.mp4' }, creatorId: null })
    await vi.waitFor(() => expect(repositories.jobs.get(first.workId)?.status).toBe('completed'))
    expect(repositories.jobs.get(second.workId)?.status).toBe('running')
    expect(afterSettled).not.toHaveBeenCalled()

    releaseSecond()
    await service.shutdown()
    expect(afterSettled).toHaveBeenCalledOnce()
  })

  it('marks interrupted work retryable without automatically running it', () => {
    repositories.works.upsert({
      id: 'interrupted', creatorId: null, platformWorkId: null, sourceType: 'local_file',
      sourceKey: 'sha256:ready', mediaPath: 'managed/ready/video.mp4', title: 'Ready',
      publishedAt: '2026-07-01T00:00:00.000Z', originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: 'interrupted', stage: 'downloaded', status: 'running', attemptCount: 1,
      nextAttemptAt: null, errorCode: null, errorMessage: null, updatedAt: '2026-07-01T00:00:00.000Z'
    })
    const deps = dependencies()
    const service = new ImportService(deps)

    service.reconcileInterruptedJobs()

    expect(repositories.jobs.get('interrupted')).toMatchObject({ status: 'failed', errorCode: 'APP_INTERRUPTED' })
    expect(service.isRetryable('interrupted')).toBe(true)
    expect(deps.processor.extractAudio).not.toHaveBeenCalled()
  })
})
