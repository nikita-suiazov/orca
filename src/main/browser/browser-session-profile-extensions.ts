import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import type { BrowserSessionExtensionsOutcome } from '../../shared/browser-workspace-types'
import { browserSessionRegistry } from './browser-session-registry'
import {
  applyBrowserSessionExtensions,
  describeBrowserSessionExtensions,
  reloadBrowserSessionPages
} from './browser-session-extensions'
import { MAX_BROWSER_SESSION_EXTENSIONS } from './browser-session-persisted-profile-validation'

export type BrowserSessionExtensionsResult = BrowserSessionExtensionsOutcome

/**
 * Why the filesystem is checked here rather than left to Electron: `loadExtension` rejects a
 * missing or unpacked-but-manifest-less directory with a message aimed at an app author, and the
 * path would still be persisted and retried on every boot.
 */
function checkUnpackedExtensionDirectory(directory: string): string | null {
  if (typeof directory !== 'string' || directory.length === 0 || directory.includes('\0')) {
    return 'Extension directory is required'
  }
  if (!isAbsolute(directory)) {
    return `Extension directory must be an absolute path: ${directory}`
  }
  const resolved = normalize(directory)
  try {
    if (!statSync(resolved).isDirectory()) {
      return `Not a directory: ${resolved}`
    }
  } catch {
    return `Directory not found: ${resolved}`
  }
  if (!existsSync(join(resolved, 'manifest.json'))) {
    return `No manifest.json in ${resolved} — Orca loads unpacked extensions only, not .crx files`
  }
  return null
}

function profileDirectories(profileId: string): string[] | null {
  const profile = browserSessionRegistry.getProfile(profileId)
  return profile ? (profile.extensions ?? []) : null
}

export function listBrowserSessionProfileExtensions(
  profileId: string
): BrowserSessionExtensionsResult {
  const profile = browserSessionRegistry.getProfile(profileId)
  if (!profile) {
    return { ok: false, reason: `Browser profile ${profileId} was not found` }
  }
  return {
    ok: true,
    profileId,
    extensions: describeBrowserSessionExtensions(profile.partition, profile.extensions ?? []),
    reloadedPages: 0
  }
}

export async function addBrowserSessionProfileExtension(
  profileId: string,
  directory: string
): Promise<BrowserSessionExtensionsResult> {
  const current = profileDirectories(profileId)
  if (current === null) {
    return { ok: false, reason: `Browser profile ${profileId} was not found` }
  }
  const failure = checkUnpackedExtensionDirectory(directory)
  if (failure !== null) {
    return { ok: false, reason: failure }
  }
  const resolved = normalize(directory)
  if (current.includes(resolved)) {
    return listBrowserSessionProfileExtensions(profileId)
  }
  if (current.length >= MAX_BROWSER_SESSION_EXTENSIONS) {
    return {
      ok: false,
      reason: `A browser profile holds at most ${MAX_BROWSER_SESSION_EXTENSIONS} extensions`
    }
  }
  return commit(profileId, [...current, resolved])
}

export async function removeBrowserSessionProfileExtension(
  profileId: string,
  directory: string
): Promise<BrowserSessionExtensionsResult> {
  const current = profileDirectories(profileId)
  if (current === null) {
    return { ok: false, reason: `Browser profile ${profileId} was not found` }
  }
  const resolved = normalize(directory)
  if (!current.includes(resolved)) {
    return { ok: false, reason: `${resolved} is not loaded in browser profile ${profileId}` }
  }
  return commit(
    profileId,
    current.filter((entry) => entry !== resolved)
  )
}

/** Re-reads every configured directory from disk, which is how an extension author sees an edit. */
export async function reloadBrowserSessionProfileExtensions(
  profileId: string
): Promise<BrowserSessionExtensionsResult> {
  const profile = browserSessionRegistry.getProfile(profileId)
  if (!profile) {
    return { ok: false, reason: `Browser profile ${profileId} was not found` }
  }
  const extensions = await applyBrowserSessionExtensions(
    profile.partition,
    profile.extensions ?? [],
    { reload: true }
  )
  return {
    ok: true,
    profileId,
    extensions,
    reloadedPages: reloadBrowserSessionPages(profile.partition)
  }
}

async function commit(
  profileId: string,
  directories: string[]
): Promise<BrowserSessionExtensionsResult> {
  const updated = browserSessionRegistry.updateProfile(profileId, {
    extensions: directories.length > 0 ? directories : undefined
  })
  if (!updated) {
    return { ok: false, reason: `Browser profile ${profileId} was not found` }
  }
  const extensions = await applyBrowserSessionExtensions(
    updated.partition,
    updated.extensions ?? []
  )
  return {
    ok: true,
    profileId,
    extensions,
    // Content scripts do not inject into a page that was already open, so the list changing means
    // every page in this profile has to navigate again before it matches what the list claims.
    reloadedPages: reloadBrowserSessionPages(updated.partition)
  }
}
