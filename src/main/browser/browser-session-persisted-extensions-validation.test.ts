import { describe, expect, it } from 'vitest'
import {
  MAX_BROWSER_SESSION_EXTENSIONS,
  sanitizePersistedBrowserSessionExtensions
} from './browser-session-persisted-profile-validation'

// The meta file is writable by anything on the machine, so what comes back off disk is untrusted:
// these directories are handed straight to Electron's extension loader on every boot.
describe('sanitizePersistedBrowserSessionExtensions', () => {
  it('keeps absolute directories in the order they were written', () => {
    expect(sanitizePersistedBrowserSessionExtensions(['/one', '/two'])).toEqual(['/one', '/two'])
  })

  it('drops the field when it is not an array', () => {
    expect(sanitizePersistedBrowserSessionExtensions(undefined)).toBeUndefined()
    expect(sanitizePersistedBrowserSessionExtensions('/one')).toBeUndefined()
    expect(sanitizePersistedBrowserSessionExtensions({ 0: '/one' })).toBeUndefined()
  })

  it('drops entries that are not absolute paths', () => {
    expect(
      sanitizePersistedBrowserSessionExtensions(['relative/dist', '../escape', '/keep'])
    ).toEqual(['/keep'])
  })

  it('drops entries that are not usable strings', () => {
    expect(
      sanitizePersistedBrowserSessionExtensions([null, 42, '', '/nul\0byte', {}, '/keep'])
    ).toEqual(['/keep'])
  })

  it('drops the field entirely when nothing survives', () => {
    expect(sanitizePersistedBrowserSessionExtensions(['relative', 7])).toBeUndefined()
    expect(sanitizePersistedBrowserSessionExtensions([])).toBeUndefined()
  })

  it('deduplicates repeated directories', () => {
    expect(sanitizePersistedBrowserSessionExtensions(['/one', '/one', '/two'])).toEqual([
      '/one',
      '/two'
    ])
  })

  it('bounds how many directories one profile can carry', () => {
    const tampered = Array.from(
      { length: MAX_BROWSER_SESSION_EXTENSIONS + 20 },
      (_unused, index) => `/dir-${index}`
    )

    expect(sanitizePersistedBrowserSessionExtensions(tampered)).toHaveLength(
      MAX_BROWSER_SESSION_EXTENSIONS
    )
  })
})
