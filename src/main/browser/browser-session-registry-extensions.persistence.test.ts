import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFsState,
  installModuleMocks,
  META_PATH,
  seedMeta
} from './__mocks__/browser-session-registry-persistence-fixture'

const PROFILE_ID = '11111111-1111-1111-1111-111111111111'
const PROFILE_PARTITION = `persist:orca-browser-session-${PROFILE_ID}`

const extensionMocks = vi.hoisted(() => ({
  apply: vi.fn(async (_partition: string, _directories: readonly string[]) => [])
}))

describe('BrowserSessionRegistry extension persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    extensionMocks.apply.mockClear()
  })

  function mockExtensionLoader(): void {
    vi.doMock('./browser-session-extensions', () => ({
      applyBrowserSessionExtensions: extensionMocks.apply,
      describeBrowserSessionExtensions: () => [],
      unloadBrowserSessionExtensions: vi.fn(),
      reloadBrowserSessionPages: () => 0
    }))
  }

  it('restores both the default and a hydrated profile and loads their extensions', async () => {
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      defaultExtensions: ['/ext/default'],
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: [
        {
          id: PROFILE_ID,
          scope: 'isolated',
          partition: PROFILE_PARTITION,
          label: 'Isolated',
          source: null,
          extensions: ['/ext/isolated']
        }
      ]
    })
    installModuleMocks(fsState)
    mockExtensionLoader()
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.initializeBrowserSessionsFromPersistedState()

    expect(browserSessionRegistry.getDefaultProfile().extensions).toEqual(['/ext/default'])
    expect(browserSessionRegistry.getProfile(PROFILE_ID)?.extensions).toEqual(['/ext/isolated'])
    expect(extensionMocks.apply.mock.calls).toEqual([
      [PROFILE_PARTITION, ['/ext/isolated']],
      ['persist:orca-browser', ['/ext/default']]
    ])
  })

  it('drops tampered directories rather than feeding them to the loader', async () => {
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      defaultExtensions: ['relative/dist', 42, '/ext/keep'],
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: [
        {
          id: PROFILE_ID,
          scope: 'isolated',
          partition: PROFILE_PARTITION,
          label: 'Isolated',
          source: null,
          extensions: 'not-an-array'
        }
      ]
    })
    installModuleMocks(fsState)
    mockExtensionLoader()
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.initializeBrowserSessionsFromPersistedState()

    expect(browserSessionRegistry.getDefaultProfile().extensions).toEqual(['/ext/keep'])
    expect(browserSessionRegistry.getProfile(PROFILE_ID)?.extensions).toBeUndefined()
    expect(extensionMocks.apply.mock.calls).toEqual([['persist:orca-browser', ['/ext/keep']]])
  })

  it('writes the default profile extension list back to the meta file', async () => {
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: []
    })
    installModuleMocks(fsState)
    mockExtensionLoader()
    const { browserSessionRegistry } = await import('./browser-session-registry')

    browserSessionRegistry.updateProfile('default', { extensions: ['/ext/one'] })

    expect(JSON.parse(fsState.files.get(META_PATH) ?? '{}').defaultExtensions).toEqual(['/ext/one'])
  })

  it('writes a non-default profile extension list inside profiles', async () => {
    const fsState = createFsState()
    seedMeta(fsState, {
      defaultSource: null,
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: [
        {
          id: PROFILE_ID,
          scope: 'isolated',
          partition: PROFILE_PARTITION,
          label: 'Isolated',
          source: null
        }
      ]
    })
    installModuleMocks(fsState)
    mockExtensionLoader()
    const { browserSessionRegistry } = await import('./browser-session-registry')
    browserSessionRegistry.initializeBrowserSessionsFromPersistedState()

    browserSessionRegistry.updateProfile(PROFILE_ID, { extensions: ['/ext/one'] })

    const written = JSON.parse(fsState.files.get(META_PATH) ?? '{}')
    expect(written.profiles).toEqual([
      expect.objectContaining({ id: PROFILE_ID, extensions: ['/ext/one'] })
    ])
  })
})
