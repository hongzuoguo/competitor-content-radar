import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWavArguments } from '../../src/services/media/ffmpeg'
import { cleanupExpiredMedia, createMediaCleanupOptions, normalizeMediaRetentionDays } from '../../src/services/media/cleanup'

describe('local media handling', () => {
  const directories: string[] = []

  afterEach(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  })

  it('extracts a 16 kHz mono WAV for local recognition', () => {
    expect(buildWavArguments('input.mp4', 'output.wav')).toEqual([
      '-y',
      '-i',
      'input.mp4',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      'output.wav'
    ])
  })

  it('accepts safe retention boundaries and falls back to seven days', () => {
    expect(normalizeMediaRetentionDays(1)).toBe(1)
    expect(normalizeMediaRetentionDays(365)).toBe(365)
    expect(normalizeMediaRetentionDays(0)).toBe(7)
    expect(normalizeMediaRetentionDays(366)).toBe(7)
    expect(normalizeMediaRetentionDays(7.5)).toBe(7)
    expect(normalizeMediaRetentionDays('30')).toBe(7)
  })

  it('deletes media older than seven days and keeps newer files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-media-'))
    directories.push(directory)
    const oldFile = join(directory, 'old.mp4')
    const newFile = join(directory, 'new.wav')
    writeFileSync(oldFile, 'old')
    writeFileSync(newFile, 'new')
    utimesSync(oldFile, new Date('2026-06-01'), new Date('2026-06-01'))

    const removed = cleanupExpiredMedia(directory, new Date('2026-07-11T00:00:00Z'))

    expect(removed).toEqual([oldFile])
    expect(readFileSync(newFile, 'utf8')).toBe('new')
  })

  it('removes only expired terminal media while protecting active job files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-media-'))
    directories.push(directory)
    const completed = join(directory, 'completed', 'video.mp4')
    const active = join(directory, 'active', 'video.mp4')
    mkdirSync(join(directory, 'completed'))
    mkdirSync(join(directory, 'active'))
    writeFileSync(completed, 'done')
    writeFileSync(active, 'running')
    utimesSync(completed, new Date('2026-06-01'), new Date('2026-06-01'))
    utimesSync(active, new Date('2026-06-01'), new Date('2026-06-01'))

    const removed = cleanupExpiredMedia(directory, {
      retentionDays: 7,
      eligiblePaths: new Set([completed, active]),
      protectedPaths: new Set([active])
    }, new Date('2026-07-11T00:00:00Z'))

    expect(removed).toEqual([completed])
    expect(existsSync(active)).toBe(true)
  })

  it('derives eligible terminal files and protects whole active work directories', () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-media-'))
    directories.push(directory)
    const terminalVideo = join(directory, 'terminal', 'video.mp4')
    const activeVideo = join(directory, 'active', 'video.mp4')
    const activeSibling = join(directory, 'active', 'audio.wav')
    mkdirSync(join(directory, 'terminal'))
    mkdirSync(join(directory, 'active'))
    for (const path of [terminalVideo, activeVideo, activeSibling]) {
      writeFileSync(path, path)
      utimesSync(path, new Date('2026-06-01'), new Date('2026-06-01'))
    }
    const options = createMediaCleanupOptions({
      retentionDays: 14,
      works: [
        { id: 'terminal', mediaPath: terminalVideo },
        { id: 'active', mediaPath: activeVideo }
      ],
      jobs: [
        { workId: 'terminal', status: 'completed' },
        { workId: 'active', status: 'running' }
      ],
      artifacts: [
        { workId: 'terminal', wavPath: null },
        { workId: 'active', wavPath: activeSibling }
      ]
    })

    expect(cleanupExpiredMedia(directory, options, new Date('2026-07-11T00:00:00Z'))).toEqual([terminalVideo])
    expect(existsSync(activeVideo)).toBe(true)
    expect(existsSync(activeSibling)).toBe(true)
  })

  it('uses the retention boundary and ignores candidates outside managed storage', () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-media-'))
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'radar-external-'))
    directories.push(directory, outsideDirectory)
    const atBoundary = join(directory, 'boundary.mp4')
    const newer = join(directory, 'newer.mp4')
    const outside = join(outsideDirectory, 'source.mp4')
    writeFileSync(atBoundary, 'boundary')
    writeFileSync(newer, 'newer')
    writeFileSync(outside, 'source')
    utimesSync(atBoundary, new Date('2026-07-04T00:00:00Z'), new Date('2026-07-04T00:00:00Z'))
    utimesSync(newer, new Date('2026-07-04T00:00:00.001Z'), new Date('2026-07-04T00:00:00.001Z'))
    utimesSync(outside, new Date('2026-06-01'), new Date('2026-06-01'))

    const removed = cleanupExpiredMedia(directory, {
      retentionDays: 7,
      eligiblePaths: new Set([atBoundary, newer, outside]),
      protectedPaths: new Set()
    }, new Date('2026-07-11T00:00:00Z'))

    expect(removed).toEqual([atBoundary])
    expect(readFileSync(newer, 'utf8')).toBe('newer')
    expect(readFileSync(outside, 'utf8')).toBe('source')
  })

  it('safely handles a missing media root', () => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-media-'))
    directories.push(directory)
    expect(cleanupExpiredMedia(join(directory, 'missing'), {
      retentionDays: 7,
      eligiblePaths: new Set(),
      protectedPaths: new Set()
    })).toEqual([])
  })

  it('fails closed when the managed root is replaced by a directory link', ({ skip }) => {
    const expectedRoot = mkdtempSync(join(tmpdir(), 'radar-media-'))
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'radar-external-'))
    directories.push(expectedRoot, outsideDirectory)
    const outside = join(outsideDirectory, 'old.mp4')
    writeFileSync(outside, 'source')
    utimesSync(outside, new Date('2026-06-01'), new Date('2026-06-01'))
    rmSync(expectedRoot, { recursive: true })
    try {
      symlinkSync(outsideDirectory, expectedRoot, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) skip()
      throw error
    }

    expect(cleanupExpiredMedia(expectedRoot, {
      retentionDays: 1,
      eligiblePaths: new Set([join(expectedRoot, 'old.mp4')]),
      protectedPaths: new Set()
    }, new Date('2026-07-11T00:00:00Z'))).toEqual([])
    expect(readFileSync(outside, 'utf8')).toBe('source')
  })

  it('never follows a linked child directory outside the confirmed root', ({ skip }) => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-media-'))
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'radar-external-'))
    directories.push(directory, outsideDirectory)
    const outside = join(outsideDirectory, 'old.mp4')
    const linkedDirectory = join(directory, 'linked')
    writeFileSync(outside, 'source')
    utimesSync(outside, new Date('2026-06-01'), new Date('2026-06-01'))
    try {
      symlinkSync(outsideDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) skip()
      throw error
    }

    expect(cleanupExpiredMedia(directory, {
      retentionDays: 1,
      eligiblePaths: new Set([join(linkedDirectory, 'old.mp4')]),
      protectedPaths: new Set()
    }, new Date('2026-07-11T00:00:00Z'))).toEqual([])
    expect(readFileSync(outside, 'utf8')).toBe('source')
  })

  it('never follows an ordinary file symlink', ({ skip }) => {
    const directory = mkdtempSync(join(tmpdir(), 'radar-media-'))
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'radar-external-'))
    directories.push(directory, outsideDirectory)
    const outside = join(outsideDirectory, 'old.mp4')
    const linkedFile = join(directory, 'linked.mp4')
    writeFileSync(outside, 'source')
    utimesSync(outside, new Date('2026-06-01'), new Date('2026-06-01'))
    try {
      symlinkSync(outside, linkedFile, 'file')
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) skip()
      throw error
    }

    expect(cleanupExpiredMedia(directory, {
      retentionDays: 1,
      eligiblePaths: new Set([linkedFile]),
      protectedPaths: new Set()
    }, new Date('2026-07-11T00:00:00Z'))).toEqual([])
    expect(readFileSync(outside, 'utf8')).toBe('source')
  })
})
