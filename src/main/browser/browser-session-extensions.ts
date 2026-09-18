import { session, webContents } from 'electron'
import type { Extension } from 'electron'
import type { BrowserSessionExtension } from '../../shared/browser-workspace-types'

// Why a module map: Electron forgets extensions on every boot, so the registry reloads them on
// every policy install, and `loadExtension` hands back the only handle to the loaded instance.
// A string value is the load error for that directory, kept so the UI can show why it failed.
const extensionsByPartition = new Map<string, Map<string, Extension | string>>()

// Why a queue: `loadExtension` is awaited, so a retirement that lands mid-load would unload only
// what arrived before it, and two applies would each carry a different list, the last one to
// finish winning over the newer one. One partition loads, unloads and reloads one thing at a time.
const workByPartition = new Map<string, Promise<unknown>>()

function serializeByPartition<T>(partition: string, work: () => T | Promise<T>): Promise<T> {
  const next = (workByPartition.get(partition) ?? Promise.resolve()).then(work)
  workByPartition.set(
    partition,
    next.then(
      () => undefined,
      () => undefined
    )
  )
  return next
}

export function applyBrowserSessionExtensions(
  partition: string,
  directories: readonly string[],
  /** `reload` re-calls `loadExtension` on live directories; Electron swaps the copy in place. */
  options: { reload?: boolean } = {}
): Promise<BrowserSessionExtension[]> {
  return serializeByPartition(partition, () =>
    loadPartitionExtensions(partition, directories, options)
  )
}

async function loadPartitionExtensions(
  partition: string,
  directories: readonly string[],
  options: { reload?: boolean }
): Promise<BrowserSessionExtension[]> {
  const sess = session.fromPartition(partition)
  const loaded = extensionsByPartition.get(partition) ?? new Map<string, Extension | string>()
  extensionsByPartition.set(partition, loaded)
  for (const [directory, entry] of loaded) {
    if (directories.includes(directory)) {
      continue
    }
    if (typeof entry !== 'string') {
      sess.extensions.removeExtension(entry.id)
    }
    loaded.delete(directory)
  }
  for (const directory of directories) {
    const entry = loaded.get(directory)
    // A previous failure is always retried; a live extension only on an explicit reload.
    if (entry !== undefined && typeof entry !== 'string' && options.reload !== true) {
      continue
    }
    try {
      loaded.set(
        directory,
        await sess.extensions.loadExtension(directory, { allowFileAccess: false })
      )
    } catch (error) {
      loaded.set(directory, error instanceof Error ? error.message : String(error))
    }
  }
  return describeBrowserSessionExtensions(partition, directories)
}

export function describeBrowserSessionExtensions(
  partition: string,
  directories: readonly string[]
): BrowserSessionExtension[] {
  const loaded = extensionsByPartition.get(partition)
  return directories.map((directory) => {
    const entry = loaded?.get(directory)
    if (entry === undefined) {
      return { directory, id: null, name: null, version: null, error: null }
    }
    if (typeof entry === 'string') {
      return { directory, id: null, name: null, version: null, error: entry }
    }
    return {
      directory,
      id: entry.id,
      name: entry.name,
      version: entry.version,
      error: null
    }
  })
}

/**
 * Unload everything a retired partition holds, including a load still in flight. Its Electron
 * Session outlives the profile, and a left-behind extension keeps its service worker and host
 * permissions running in it.
 */
export function unloadBrowserSessionExtensions(partition: string): Promise<void> {
  return serializeByPartition(partition, () => {
    const loaded = extensionsByPartition.get(partition)
    extensionsByPartition.delete(partition)
    if (!loaded) {
      return
    }
    const sess = session.fromPartition(partition)
    for (const entry of loaded.values()) {
      if (typeof entry !== 'string') {
        sess.extensions.removeExtension(entry.id)
      }
    }
  })
}

/**
 * Content scripts only reach a page loaded after the extension was, so every page already open in
 * the partition has to navigate again before an added or reloaded extension shows up in it.
 */
export function reloadBrowserSessionPages(partition: string): number {
  const sess = session.fromPartition(partition)
  let reloaded = 0
  for (const contents of webContents.getAllWebContents()) {
    // Orca's own UI never runs in a browser partition, so everything here is a browsed page.
    if (contents.isDestroyed() || contents.session !== sess) {
      continue
    }
    contents.reload()
    reloaded += 1
  }
  return reloaded
}
