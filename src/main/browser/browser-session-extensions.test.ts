import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeExtension = { id: string; name: string; version: string; path: string }

type FakeSession = {
  extensions: {
    loadExtension: ReturnType<typeof vi.fn>
    removeExtension: ReturnType<typeof vi.fn>
  }
}

const state = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  loadCallsByPartition: new Map<string, string[]>(),
  removedByPartition: new Map<string, string[]>(),
  failingDirectories: new Set<string>(),
  blockedDirectories: new Map<string, Promise<void>>(),
  allWebContents: [] as {
    isDestroyed: () => boolean
    session: unknown
    reload: ReturnType<typeof vi.fn>
  }[]
}))

function fakeSession(partition: string): FakeSession {
  return {
    extensions: {
      loadExtension: vi.fn(async (directory: string): Promise<FakeExtension> => {
        state.loadCallsByPartition.set(partition, [
          ...(state.loadCallsByPartition.get(partition) ?? []),
          directory
        ])
        await state.blockedDirectories.get(directory)
        if (state.failingDirectories.has(directory)) {
          throw new Error(`no manifest at ${directory}`)
        }
        return {
          id: `id-${directory}`,
          name: `name-${directory}`,
          version: '1.2.3',
          path: directory
        }
      }),
      removeExtension: vi.fn((extensionId: string) => {
        state.removedByPartition.set(partition, [
          ...(state.removedByPartition.get(partition) ?? []),
          extensionId
        ])
      })
    }
  }
}

vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => {
      const existing = state.sessions.get(partition)
      if (existing) {
        return existing
      }
      const created = fakeSession(partition)
      state.sessions.set(partition, created)
      return created
    }
  },
  webContents: { getAllWebContents: () => state.allWebContents }
}))

/** Holds `loadExtension` for one directory open until the returned release is called. */
function blockDirectory(directory: string): () => void {
  let release = (): void => {}
  state.blockedDirectories.set(
    directory,
    new Promise<void>((resolve) => {
      release = resolve
    })
  )
  return release
}

describe('browser session extensions', () => {
  beforeEach(() => {
    vi.resetModules()
    state.sessions.clear()
    state.loadCallsByPartition.clear()
    state.removedByPartition.clear()
    state.failingDirectories.clear()
    state.blockedDirectories.clear()
    state.allWebContents = []
  })

  it('loads every configured directory once and reports what Electron made of it', async () => {
    const { applyBrowserSessionExtensions } = await import('./browser-session-extensions')

    const extensions = await applyBrowserSessionExtensions('persist:p', ['/a', '/b'])

    expect(state.loadCallsByPartition.get('persist:p')).toEqual(['/a', '/b'])
    expect(extensions).toEqual([
      { directory: '/a', id: 'id-/a', name: 'name-/a', version: '1.2.3', error: null },
      { directory: '/b', id: 'id-/b', name: 'name-/b', version: '1.2.3', error: null }
    ])
  })

  it('is idempotent across policy re-installs', async () => {
    const { applyBrowserSessionExtensions } = await import('./browser-session-extensions')

    await applyBrowserSessionExtensions('persist:p', ['/a'])
    await applyBrowserSessionExtensions('persist:p', ['/a'])

    expect(state.loadCallsByPartition.get('persist:p')).toEqual(['/a'])
  })

  it('unloads a directory that dropped out of the list', async () => {
    const { applyBrowserSessionExtensions } = await import('./browser-session-extensions')

    await applyBrowserSessionExtensions('persist:p', ['/a', '/b'])
    const extensions = await applyBrowserSessionExtensions('persist:p', ['/b'])

    expect(state.removedByPartition.get('persist:p')).toEqual(['id-/a'])
    expect(extensions.map((extension) => extension.directory)).toEqual(['/b'])
  })

  it('reports a failing directory without losing the rest', async () => {
    state.failingDirectories.add('/broken')
    const { applyBrowserSessionExtensions } = await import('./browser-session-extensions')

    const extensions = await applyBrowserSessionExtensions('persist:p', ['/broken', '/a'])

    expect(extensions[0]).toEqual({
      directory: '/broken',
      id: null,
      name: null,
      version: null,
      error: 'no manifest at /broken'
    })
    expect(extensions[1]?.id).toBe('id-/a')
  })

  it('retries a previously failing directory on the next apply', async () => {
    state.failingDirectories.add('/a')
    const { applyBrowserSessionExtensions } = await import('./browser-session-extensions')
    await applyBrowserSessionExtensions('persist:p', ['/a'])

    state.failingDirectories.delete('/a')
    const extensions = await applyBrowserSessionExtensions('persist:p', ['/a'])

    expect(state.loadCallsByPartition.get('persist:p')).toEqual(['/a', '/a'])
    expect(extensions[0]?.error).toBeNull()
  })

  it('re-calls loadExtension only when a reload is asked for', async () => {
    const { applyBrowserSessionExtensions } = await import('./browser-session-extensions')
    await applyBrowserSessionExtensions('persist:p', ['/a'])

    await applyBrowserSessionExtensions('persist:p', ['/a'], { reload: true })

    expect(state.loadCallsByPartition.get('persist:p')).toEqual(['/a', '/a'])
    // Electron swaps the copy in place, so nothing is removed first.
    expect(state.removedByPartition.get('persist:p')).toBeUndefined()
  })

  it('keeps the loaded set of each partition apart', async () => {
    const { applyBrowserSessionExtensions, describeBrowserSessionExtensions } =
      await import('./browser-session-extensions')

    await applyBrowserSessionExtensions('persist:one', ['/a'])
    await applyBrowserSessionExtensions('persist:two', ['/a'])

    expect(state.loadCallsByPartition.get('persist:one')).toEqual(['/a'])
    expect(state.loadCallsByPartition.get('persist:two')).toEqual(['/a'])
    expect(describeBrowserSessionExtensions('persist:two', ['/a'])[0]?.id).toBe('id-/a')
  })

  it('describes a configured directory that was never applied as not loaded', async () => {
    const { describeBrowserSessionExtensions } = await import('./browser-session-extensions')

    expect(describeBrowserSessionExtensions('persist:p', ['/a'])).toEqual([
      { directory: '/a', id: null, name: null, version: null, error: null }
    ])
  })

  it('unloads a retired partition so nothing keeps running in its session', async () => {
    const { applyBrowserSessionExtensions, unloadBrowserSessionExtensions } =
      await import('./browser-session-extensions')
    await applyBrowserSessionExtensions('persist:p', ['/a'])

    await unloadBrowserSessionExtensions('persist:p')

    expect(state.removedByPartition.get('persist:p')).toEqual(['id-/a'])
    // And the bookkeeping is gone, so a re-created profile loads from scratch.
    await applyBrowserSessionExtensions('persist:p', ['/a'])
    expect(state.loadCallsByPartition.get('persist:p')).toEqual(['/a', '/a'])
  })

  it('holds a second apply for the partition until the first one finished', async () => {
    const { applyBrowserSessionExtensions } = await import('./browser-session-extensions')
    const release = blockDirectory('/slow')

    const first = applyBrowserSessionExtensions('persist:p', ['/slow'])
    const second = applyBrowserSessionExtensions('persist:p', ['/fast'])
    await Promise.resolve()

    expect(state.loadCallsByPartition.get('persist:p')).toEqual(['/slow'])

    release()
    await first
    const extensions = await second

    expect(state.loadCallsByPartition.get('persist:p')).toEqual(['/slow', '/fast'])
    // The newer list wins: an overlapping apply reads an empty map and leaves /slow loaded.
    expect(state.removedByPartition.get('persist:p')).toEqual(['id-/slow'])
    expect(extensions.map((extension) => extension.directory)).toEqual(['/fast'])
  })

  it('unloads an extension whose load only landed after the partition was retired', async () => {
    const { applyBrowserSessionExtensions, unloadBrowserSessionExtensions } =
      await import('./browser-session-extensions')
    const release = blockDirectory('/slow')
    const applied = applyBrowserSessionExtensions('persist:p', ['/slow'])
    const unloaded = unloadBrowserSessionExtensions('persist:p')

    release()
    await applied
    await unloaded

    expect(state.removedByPartition.get('persist:p')).toEqual(['id-/slow'])
  })

  it('reloads only the pages that belong to the partition', async () => {
    const { reloadBrowserSessionPages } = await import('./browser-session-extensions')
    const { session } = await import('electron')
    const mine = session.fromPartition('persist:p')
    const other = session.fromPartition('persist:other')
    const pages = [
      { isDestroyed: () => false, session: mine, reload: vi.fn() },
      { isDestroyed: () => false, session: other, reload: vi.fn() },
      { isDestroyed: () => true, session: mine, reload: vi.fn() }
    ]
    state.allWebContents = pages

    expect(reloadBrowserSessionPages('persist:p')).toBe(1)
    expect(pages[0].reload).toHaveBeenCalledTimes(1)
    expect(pages[1].reload).not.toHaveBeenCalled()
    expect(pages[2].reload).not.toHaveBeenCalled()
  })
})
