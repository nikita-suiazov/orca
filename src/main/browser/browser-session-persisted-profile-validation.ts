import { isAbsolute } from 'node:path'
import { getOrcaProfileBrowserSessionPartition } from '../../shared/orca-profiles'
import type { BrowserSessionProfile } from '../../shared/browser-workspace-types'

export const MAX_BROWSER_SESSION_EXTENSIONS = 16

const BROWSER_SESSION_PROFILE_ID_RE =
  /^[\da-f-]{8}-[\da-f-]{4}-[\da-f-]{4}-[\da-f-]{4}-[\da-f-]{12}$/

type PersistedProfileWithUserAgentMode = Record<string, unknown> & {
  readonly userAgentMode: unknown
}

// Why: validate on-disk profile shape so a tampered JSON file can't inject an arbitrary partition into the will-attach-webview allowlist.
export function isValidPersistedBrowserSessionProfile(
  profile: unknown,
  activeOrcaProfileId: string
): profile is BrowserSessionProfile {
  if (!profile || typeof profile !== 'object') {
    return false
  }
  const candidate = profile as Partial<BrowserSessionProfile>
  return (
    candidate.id !== 'default' &&
    candidate.scope !== 'default' &&
    typeof candidate.id === 'string' &&
    typeof candidate.partition === 'string' &&
    typeof candidate.label === 'string' &&
    isProfileOwnedSessionPartition(candidate.id, candidate.partition, activeOrcaProfileId)
  )
}

// Why absolute-only, deduped and bounded: these directories go straight to Electron's extension
// loader, so a tampered meta file must not be able to point a partition at an arbitrary tree or
// grow the boot-time load list without limit. An unusable field is dropped, not the whole profile.
export function sanitizePersistedBrowserSessionExtensions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const directories = [
    ...new Set(
      value.filter(
        (entry): entry is string =>
          typeof entry === 'string' &&
          entry.length > 0 &&
          !entry.includes('\0') &&
          isAbsolute(entry)
      )
    )
  ]
  return directories.length > 0 ? directories.slice(0, MAX_BROWSER_SESSION_EXTENSIONS) : undefined
}

export function inspectRetiredBrowserSessionProfileUserAgentModes(
  profiles: readonly unknown[],
  activeOrcaProfileId: string
): { noticePending: boolean; degraded: boolean } {
  let noticePending = false
  let degraded = false
  for (const profile of profiles) {
    // Refusing to hydrate an entry is not the same as finding a retired choice: hydrateFromPersisted
    // already skips it silently, and a notice here would claim an old choice could not be inspected
    // for a profile that never carried one.
    if (!isRecord(profile) || !hasPersistedProfileUserAgentMode(profile)) {
      continue
    }
    noticePending = true
    const mode = profile.userAgentMode
    // Degraded covers both ways the choice is uninspectable: an unreadable mode, and a mode sitting
    // on an entry we refuse to hydrate, where we cannot say which profile it belonged to.
    if (
      (mode !== 'clean' && mode !== 'native') ||
      !isValidPersistedBrowserSessionProfile(profile, activeOrcaProfileId)
    ) {
      degraded = true
    }
  }
  return { noticePending, degraded }
}

function hasPersistedProfileUserAgentMode(
  profile: Record<string, unknown>
): profile is PersistedProfileWithUserAgentMode {
  return Object.hasOwn(profile, 'userAgentMode')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProfileOwnedSessionPartition(
  profileId: string,
  partition: string,
  activeOrcaProfileId: string
): boolean {
  return (
    BROWSER_SESSION_PROFILE_ID_RE.test(profileId) &&
    partition === getOrcaProfileBrowserSessionPartition(activeOrcaProfileId, profileId)
  )
}
