import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserSessionProfile } from '../../shared/browser-workspace-types'

const registry = vi.hoisted(() => ({
  profiles: new Map<string, BrowserSessionProfile>(),
  getProfile: vi.fn(),
  updateProfile: vi.fn()
}))

const sessionExtensions = vi.hoisted(() => ({
  applied: [] as { partition: string; directories: readonly string[]; reload: boolean }[],
  reloadedPartitions: [] as string[]
}))

vi.mock('./browser-session-registry', () => ({
  browserSessionRegistry: {
    getProfile: (profileId: string) => registry.profiles.get(profileId) ?? null,
    updateProfile: (profileId: string, patch: Partial<BrowserSessionProfile>) => {
      const profile = registry.profiles.get(profileId)
      if (!profile) {
        return null
      }
      const updated = { ...profile, ...patch }
      registry.profiles.set(profileId, updated)
      return updated
    }
  }
}))

vi.mock('./browser-session-extensions', () => ({
  applyBrowserSessionExtensions: vi.fn(
    async (
      partition: string,
      directories: readonly string[],
      options: { reload?: boolean } = {}
    ) => {
      sessionExtensions.applied.push({
        partition,
        directories: [...directories],
        reload: options.reload === true
      })
      return directories.map((directory) => ({
        directory,
        id: `id-${directory}`,
        name: 'ext',
        version: '1.0.0',
        error: null
      }))
    }
  ),
  describeBrowserSessionExtensions: (_partition: string, directories: readonly string[]) =>
    directories.map((directory) => ({
      directory,
      id: `id-${directory}`,
      name: 'ext',
      version: '1.0.0',
      error: null
    })),
  reloadBrowserSessionPages: (partition: string) => {
    sessionExtensions.reloadedPartitions.push(partition)
    return 2
  }
}))

function unpackedExtension(): string {
  const directory = mkdtempSync(join(tmpdir(), 'orca-ext-'))
  writeFileSync(join(directory, 'manifest.json'), '{"manifest_version":3}')
  return directory
}

describe('browser session profile extensions', () => {
  beforeEach(() => {
    registry.profiles.clear()
    registry.profiles.set('default', {
      id: 'default',
      scope: 'default',
      partition: 'persist:orca-browser',
      label: 'Default',
      source: null
    })
    sessionExtensions.applied = []
    sessionExtensions.reloadedPartitions = []
  })

  it('adds a valid unpacked directory, persists it and reloads the open pages', async () => {
    const { addBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')
    const directory = unpackedExtension()

    const result = await addBrowserSessionProfileExtension('default', directory)

    expect(result.ok).toBe(true)
    expect(registry.profiles.get('default')?.extensions).toEqual([directory])
    expect(sessionExtensions.applied).toEqual([
      { partition: 'persist:orca-browser', directories: [directory], reload: false }
    ])
    expect(sessionExtensions.reloadedPartitions).toEqual(['persist:orca-browser'])
    expect(result.ok && result.reloadedPages).toBe(2)
  })

  it('refuses a relative path', async () => {
    const { addBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')

    const result = await addBrowserSessionProfileExtension('default', 'dist')

    expect(result).toEqual({
      ok: false,
      reason: 'Extension directory must be an absolute path: dist'
    })
    expect(sessionExtensions.applied).toEqual([])
  })

  it('refuses a directory without a manifest', async () => {
    const { addBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')
    const directory = mkdtempSync(join(tmpdir(), 'orca-ext-'))

    const result = await addBrowserSessionProfileExtension('default', directory)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('No manifest.json in')
  })

  it('refuses a path that is not a directory', async () => {
    const { addBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')
    const root = mkdtempSync(join(tmpdir(), 'orca-ext-'))
    const file = join(root, 'manifest.json')
    writeFileSync(file, '{}')

    const result = await addBrowserSessionProfileExtension('default', file)

    expect(result.ok === false && result.reason).toBe(`Not a directory: ${file}`)
  })

  it('refuses a directory that does not exist', async () => {
    const { addBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')
    const missing = join(tmpdir(), 'orca-ext-missing-directory')

    const result = await addBrowserSessionProfileExtension('default', missing)

    expect(result.ok === false && result.reason).toBe(`Directory not found: ${missing}`)
  })

  it('refuses an unknown profile', async () => {
    const { addBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')

    const result = await addBrowserSessionProfileExtension('nope', unpackedExtension())

    expect(result).toEqual({ ok: false, reason: 'Browser profile nope was not found' })
  })

  it('bounds how many extensions one profile carries', async () => {
    const { addBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')
    const root = mkdtempSync(join(tmpdir(), 'orca-ext-'))
    const existing = Array.from({ length: 16 }, (_unused, index) => join(root, `held-${index}`))
    registry.profiles.set('default', {
      ...registry.profiles.get('default')!,
      extensions: existing
    })

    const result = await addBrowserSessionProfileExtension('default', unpackedExtension())

    expect(result).toEqual({
      ok: false,
      reason: 'A browser profile holds at most 16 extensions'
    })
  })

  it('adding the same directory twice changes nothing', async () => {
    const { addBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')
    const directory = unpackedExtension()
    await addBrowserSessionProfileExtension('default', directory)
    sessionExtensions.applied = []

    const result = await addBrowserSessionProfileExtension('default', directory)

    expect(result.ok && result.extensions).toHaveLength(1)
    expect(sessionExtensions.applied).toEqual([])
  })

  it('removes a configured directory and drops the field when none are left', async () => {
    const { addBrowserSessionProfileExtension, removeBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')
    const directory = unpackedExtension()
    await addBrowserSessionProfileExtension('default', directory)

    const result = await removeBrowserSessionProfileExtension('default', directory)

    expect(result.ok).toBe(true)
    expect(registry.profiles.get('default')?.extensions).toBeUndefined()
  })

  it('refuses to remove a directory the profile never held', async () => {
    const { removeBrowserSessionProfileExtension } =
      await import('./browser-session-profile-extensions')

    const result = await removeBrowserSessionProfileExtension('default', '/nowhere')

    expect(result).toEqual({
      ok: false,
      reason: '/nowhere is not loaded in browser profile default'
    })
  })

  it('reload re-reads every configured directory and reloads the pages', async () => {
    const { addBrowserSessionProfileExtension, reloadBrowserSessionProfileExtensions } =
      await import('./browser-session-profile-extensions')
    const directory = unpackedExtension()
    await addBrowserSessionProfileExtension('default', directory)
    sessionExtensions.applied = []
    sessionExtensions.reloadedPartitions = []

    const result = await reloadBrowserSessionProfileExtensions('default')

    expect(result.ok).toBe(true)
    expect(sessionExtensions.applied).toEqual([
      { partition: 'persist:orca-browser', directories: [directory], reload: true }
    ])
    expect(sessionExtensions.reloadedPartitions).toEqual(['persist:orca-browser'])
  })

  it('lists what is configured without touching the partition', async () => {
    const { addBrowserSessionProfileExtension, listBrowserSessionProfileExtensions } =
      await import('./browser-session-profile-extensions')
    const directory = unpackedExtension()
    await addBrowserSessionProfileExtension('default', directory)
    sessionExtensions.applied = []

    const result = listBrowserSessionProfileExtensions('default')

    expect(result.ok && result.extensions.map((entry) => entry.directory)).toEqual([directory])
    expect(sessionExtensions.applied).toEqual([])
  })
})
