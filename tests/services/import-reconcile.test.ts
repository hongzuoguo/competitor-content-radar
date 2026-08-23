import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../src/services/database/database'
import { AppRepositories } from '../../src/services/database/repositories'
import { ImportService, type ImportServiceDependencies } from '../../src/services/import/import-service'

describe('ImportService restart reconciliation', () => {
  const directories: string[] = []
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

  function createService(repositories: AppRepositories, overrides: Partial<ImportServiceDependencies> = {}) {
    return new ImportService({
      repositories, mediaRoot: 'managed',
      ingestLocal: vi.fn(), resolveDouyin: vi.fn(), download: vi.fn(),
      processor: {
        extractAudio: vi.fn(), transcribe: vi.fn(),
        analyze: vi.fn(async () => ({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null }))
      },
      getSettings: () => ({}), ...overrides
    })
  }

  function seed(repositories: AppRepositories, id: string, sourceKey: string, stage: 'discovered' | 'transcribed') {
    repositories.works.upsert({
      id, creatorId: null, platformWorkId: null, sourceType: 'local_file', sourceKey,
      mediaPath: sourceKey.startsWith('pending:') ? null : 'managed/video.mp4', title: 'video',
      publishedAt: new Date().toISOString(), originalUrl: null, downloadUrl: null,
      metrics: { likes: 0, comments: 0, shares: 0, collects: 0 }
    })
    repositories.jobs.save({
      workId: id, stage, status: 'running', attemptCount: 1, nextAttemptAt: null,
      errorCode: null, errorMessage: null, updatedAt: new Date().toISOString()
    })
  }

  it('marks an interrupted later stage retryable and resumes from its persisted transcript', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-reconcile-'))
    directories.push(directory)
    const path = join(directory, 'radar.db')
    const first = new AppDatabase(path)
    const firstRepositories = new AppRepositories(first.connection)
    seed(firstRepositories, 'later', 'sha256:later', 'transcribed')
    firstRepositories.artifacts.save({
      workId: 'later', wavPath: 'managed/audio.wav', transcript: 'persisted words',
      existingWorkId: null, updatedAt: new Date().toISOString()
    })
    first.close()

    const reopened = new AppDatabase(path)
    const repositories = new AppRepositories(reopened.connection)
    const analyze = vi.fn(async () => ({ result: {}, provider: 'p', model: 'm', promptVersion: 'v1', tokenUsage: null }))
    const extractAudio = vi.fn()
    const transcribe = vi.fn()
    const service = createService(repositories, { processor: { extractAudio, transcribe, analyze } })
    service.reconcileInterruptedJobs()
    expect(repositories.jobs.get('later')).toMatchObject({ status: 'failed', errorCode: 'APP_INTERRUPTED', stage: 'transcribed' })
    await service.retry('later')
    await vi.waitFor(() => expect(repositories.jobs.get('later')?.status).toBe('completed'))
    expect(extractAudio).not.toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
    reopened.close()
  })

  it('requires reimport when restart loses a provisional source input', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-reconcile-'))
    directories.push(directory)
    const path = join(directory, 'radar.db')
    const first = new AppDatabase(path)
    seed(new AppRepositories(first.connection), 'preparing', 'pending:preparing', 'discovered')
    first.close()
    const reopened = new AppDatabase(path)
    const repositories = new AppRepositories(reopened.connection)
    const service = createService(repositories)
    service.reconcileInterruptedJobs()
    expect(repositories.jobs.get('preparing')).toMatchObject({ status: 'failed', errorCode: 'SOURCE_INPUT_REQUIRED' })
    await expect(service.retry('preparing')).rejects.toMatchObject({ code: 'JOB_NOT_RETRYABLE' })
    reopened.close()
  })
})
