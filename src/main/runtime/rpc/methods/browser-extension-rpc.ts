import { defineMethod } from '../core'
import {
  ProfileExtensionList,
  ProfileExtensionReload,
  ProfileExtensionTarget
} from '../../../../shared/rpc-contract/browser-extension-params'

// Why separate from browser-core: these manage a profile's own unpacked extensions and take no
// BrowserTarget, and browser-core is at its line cap.
export const BROWSER_EXTENSION_METHODS = [
  defineMethod({
    name: 'browser.profileExtensionList',
    params: ProfileExtensionList,
    handler: async (params, { runtime }) => runtime.browserProfileExtensionList(params)
  }),
  defineMethod({
    name: 'browser.profileExtensionAdd',
    params: ProfileExtensionTarget,
    handler: async (params, { runtime }) => runtime.browserProfileExtensionAdd(params)
  }),
  defineMethod({
    name: 'browser.profileExtensionRemove',
    params: ProfileExtensionTarget,
    handler: async (params, { runtime }) => runtime.browserProfileExtensionRemove(params)
  }),
  defineMethod({
    name: 'browser.profileExtensionReload',
    params: ProfileExtensionReload,
    handler: async (params, { runtime }) => runtime.browserProfileExtensionReload(params)
  })
] as const
