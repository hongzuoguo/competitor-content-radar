import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWavArguments } from '../../src/services/media/ffmpeg'
import { cleanupExpiredMedia } from '../../src/services/media/cleanup'

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
})
