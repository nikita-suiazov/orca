import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserSessionProfile } from '../../shared/browser-workspace-types'
import { sanitizePersistedBrowserSessionExtensions } from './browser-session-persisted-profile-validation'

export type PendingBrowserCookieImport =
  | string
  | {
      format: string
      path: string
    }

// Why: no userAgent fields — the session UA is always derived from the running
// engine at startup (clean or native), never persisted. Imports before Aug 2026
// stored a synthesized source-browser UA here; persistMeta drops those legacy
// TOP-LEVEL keys on the next write because this loader no longer carries them.
//
// This does not extend to the retired per-profile `userAgentMode`: it lives inside each
// BrowserSessionProfile in `profiles`, which is carried through untouched, so those bytes
// survive every write. That retention is deliberate — it is what makes rollback and
// data-loss machinery unnecessary — and the startup notice keys on it, so nothing may
// start stripping it. See inspectRetiredBrowserSessionProfileUserAgentModes.
export type BrowserSessionMeta = {
  defaultSource: BrowserSessionProfile['source']
  // Why a top-level field: the default profile is never written into `profiles`, so its own
  // extension list has nowhere else to live.
  defaultExtensions: string[] | undefined
  pendingCookieDbPath: string | null
  pendingCookieImports: Record<string, PendingBrowserCookieImport>
  profiles: BrowserSessionProfile[]
}

// Extension directories are read back off disk unverified, so every load is sanitized here.
function readPersistedProfiles(value: unknown): BrowserSessionProfile[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((profile) =>
    profile && typeof profile === 'object'
      ? {
          ...(profile as BrowserSessionProfile),
          extensions: sanitizePersistedBrowserSessionExtensions(
            (profile as BrowserSessionProfile).extensions
          )
        }
      : (profile as BrowserSessionProfile)
  )
}

export const BROWSER_SESSION_META_FILE_NAME = 'browser-session-meta.json'

// Why: the path is resolved lazily (app.getPath('userData') throws pre-ready) so the failure lands inside the existing swallow.
export function loadBrowserSessionMeta(
  resolveMetadataPath: () => string,
  defaultPartition: string
): BrowserSessionMeta {
  try {
    const raw = readFileSync(resolveMetadataPath(), 'utf-8')
    const data = JSON.parse(raw)
    const legacyPendingCookieDbPath =
      typeof data?.pendingCookieDbPath === 'string' ? data.pendingCookieDbPath : null
    const pendingCookieImports: Record<string, PendingBrowserCookieImport> = {}
    if (data && typeof data.pendingCookieImports === 'object' && data.pendingCookieImports) {
      for (const [partition, entry] of Object.entries(data.pendingCookieImports)) {
        if (
          typeof entry === 'string' ||
          (entry &&
            typeof entry === 'object' &&
            typeof (entry as { format?: unknown }).format === 'string' &&
            typeof (entry as { path?: unknown }).path === 'string')
        ) {
          pendingCookieImports[partition] = entry as PendingBrowserCookieImport
        }
      }
    }
    if (legacyPendingCookieDbPath && !pendingCookieImports[defaultPartition]) {
      pendingCookieImports[defaultPartition] = legacyPendingCookieDbPath
    }
    return {
      defaultSource: data?.defaultSource ?? null,
      defaultExtensions: sanitizePersistedBrowserSessionExtensions(data?.defaultExtensions),
      pendingCookieDbPath: legacyPendingCookieDbPath,
      pendingCookieImports,
      profiles: readPersistedProfiles(data?.profiles)
    }
  } catch {
    return {
      defaultSource: null,
      defaultExtensions: undefined,
      pendingCookieDbPath: null,
      pendingCookieImports: {},
      profiles: []
    }
  }
}

// Why: write-temp-then-rename is atomic, so a crash mid-write can't corrupt the live file.
export function persistBrowserSessionMeta(
  resolveMetadataPath: () => string,
  defaultPartition: string,
  updates: Partial<BrowserSessionMeta>
): void {
  try {
    const existing = loadBrowserSessionMeta(resolveMetadataPath, defaultPartition)
    const tmpPath = `${resolveMetadataPath()}.tmp`
    mkdirSync(dirname(resolveMetadataPath()), { recursive: true })
    writeFileSync(tmpPath, JSON.stringify({ ...existing, ...updates }))
    renameSync(tmpPath, resolveMetadataPath())
  } catch {
    // best-effort
  }
}
