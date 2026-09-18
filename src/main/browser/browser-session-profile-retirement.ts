import { session } from 'electron'
import type { Session } from 'electron'
import { retireProxySessionApplication } from '../network/proxy-settings'
import {
  clearBrowserSessionPartitionPolicies,
  forgetBrowserSessionPartitionConfiguration,
  retireBrowserSessionUserAgentPolicy
} from './browser-session-partition-policies'
import { invalidateBrowserSessionProxyApplication } from './browser-session-proxy'
import { cancelBrowserWebAuthnAccountRequestsForSession } from './browser-webauthn-account-picker'
import { unloadBrowserSessionExtensions } from './browser-session-extensions'

export async function retireFailedBrowserSessionProfile(
  partition: string,
  sess: Session
): Promise<void> {
  const retirement = retireProxySessionApplication(sess)
  try {
    clearBrowserSessionPartitionPolicies(partition, sess)
  } catch {
    // Best-effort policy cleanup must not skip retirement.
  }
  try {
    await retirement
  } catch {
    console.warn('[proxy] Failed to release proxy from browser partition', partition)
  }
}

/**
 * Retire a deleted profile's partition: drop its policies and clear its storage so nothing is left
 * behind. Best-effort — the profile is already out of the registry, so will-attach-webview blocks
 * the partition regardless.
 */
export async function retireDeletedBrowserSessionProfilePartition(
  partition: string
): Promise<void> {
  try {
    const sess = session.fromPartition(partition)
    forgetBrowserSessionPartitionConfiguration(partition)
    unloadBrowserSessionExtensions(partition)
    retireBrowserSessionUserAgentPolicy(sess)
    invalidateBrowserSessionProxyApplication(sess)
    const release = retireProxySessionApplication(sess)
    // Persistent partitions can retain service workers after every WebContents dies, so a retired
    // session's deny policies must remain permanent.
    cancelBrowserWebAuthnAccountRequestsForSession(sess)
    try {
      await release
    } catch {
      console.warn('[proxy] Failed to release proxy from browser partition', partition)
    }
    await sess.clearStorageData()
    await sess.clearCache()
  } catch {
    // Best-effort cleanup.
  }
}
