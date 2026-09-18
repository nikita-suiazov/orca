import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BrowserSessionExtension,
  BrowserSessionExtensionsOutcome
} from '../../../../shared/browser-workspace-types'

export type BrowserSessionExtensionsController = {
  extensionsByProfileId: Record<string, BrowserSessionExtension[]>
  busyProfileId: string | null
  error: string | null
  add: (profileId: string) => Promise<void>
  remove: (profileId: string, directory: string) => Promise<void>
  reload: (profileId: string) => Promise<void>
}

type ExtensionsApi = {
  sessionListExtensions: (args: { profileId: string }) => Promise<BrowserSessionExtensionsOutcome>
  sessionAddExtension: (args: { profileId: string }) => Promise<BrowserSessionExtensionsOutcome>
  sessionRemoveExtension: (args: {
    profileId: string
    directory: string
  }) => Promise<BrowserSessionExtensionsOutcome>
  sessionReloadExtensions: (args: { profileId: string }) => Promise<BrowserSessionExtensionsOutcome>
}

function extensionsApi(): ExtensionsApi | null {
  const api = window.api?.browser
  return typeof api?.sessionListExtensions === 'function' ? api : null
}

/**
 * Reads and mutates the extension list of each profile straight over IPC rather than through the
 * store: nothing outside this Settings section consumes it, and main owns the truth either way.
 */
export function useBrowserSessionExtensions(
  profileIds: readonly string[]
): BrowserSessionExtensionsController {
  const [extensionsByProfileId, setExtensionsByProfileId] = useState<
    Record<string, BrowserSessionExtension[]>
  >({})
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Why a ref: profileIds is a fresh array every render, so the effect keys on its contents.
  const loadedKeyRef = useRef<string>('')

  const settle = useCallback((profileId: string, outcome: BrowserSessionExtensionsOutcome) => {
    if (outcome.ok) {
      setExtensionsByProfileId((current) => ({ ...current, [profileId]: outcome.extensions }))
      setError(null)
      return
    }
    // The picker being dismissed is a decision, not a failure.
    setError(outcome.reason === 'canceled' ? null : outcome.reason)
  }, [])

  const run = useCallback(
    async (
      profileId: string,
      call: (api: ExtensionsApi) => Promise<BrowserSessionExtensionsOutcome>
    ) => {
      const api = extensionsApi()
      if (!api) {
        return
      }
      setBusyProfileId(profileId)
      try {
        settle(profileId, await call(api))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusyProfileId(null)
      }
    },
    [settle]
  )

  useEffect(() => {
    const key = profileIds.join(',')
    if (key === loadedKeyRef.current) {
      return
    }
    loadedKeyRef.current = key
    const api = extensionsApi()
    if (!api) {
      return
    }
    for (const profileId of profileIds) {
      void api
        .sessionListExtensions({ profileId })
        .then((outcome) => settle(profileId, outcome))
        .catch(() => {})
    }
  }, [profileIds, settle])

  return {
    extensionsByProfileId,
    busyProfileId,
    error,
    add: (profileId) => run(profileId, (api) => api.sessionAddExtension({ profileId })),
    remove: (profileId, directory) =>
      run(profileId, (api) => api.sessionRemoveExtension({ profileId, directory })),
    reload: (profileId) => run(profileId, (api) => api.sessionReloadExtensions({ profileId }))
  }
}
