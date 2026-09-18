import { BrowserWindow, dialog, ipcMain } from 'electron'
import { isTrustedBrowserRenderer } from './browser-renderer-trust'
import {
  addBrowserSessionProfileExtension,
  listBrowserSessionProfileExtensions,
  reloadBrowserSessionProfileExtensions,
  removeBrowserSessionProfileExtension,
  type BrowserSessionExtensionsResult
} from '../browser/browser-session-profile-extensions'

const NOT_AUTHORIZED: BrowserSessionExtensionsResult = { ok: false, reason: 'Not authorized' }

// Why its own module: browser-session-profile-ipc.ts is at its line cap, and these four channels
// share one subject. Every one is gated on the trusted browser renderer like its neighbours there.
export function registerBrowserSessionExtensionHandlers(): void {
  ipcMain.removeHandler('browser:session:listExtensions')
  ipcMain.removeHandler('browser:session:addExtension')
  ipcMain.removeHandler('browser:session:removeExtension')
  ipcMain.removeHandler('browser:session:reloadExtensions')

  ipcMain.handle(
    'browser:session:listExtensions',
    (event, args: { profileId: string }): BrowserSessionExtensionsResult => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return NOT_AUTHORIZED
      }
      return listBrowserSessionProfileExtensions(args.profileId)
    }
  )

  ipcMain.handle(
    'browser:session:addExtension',
    async (event, args: { profileId: string }): Promise<BrowserSessionExtensionsResult> => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return NOT_AUTHORIZED
      }
      // Why main picks the directory: the renderer never supplies the path, so a compromised one
      // cannot point a partition at a tree the user did not choose in this dialog.
      const directory = await pickUnpackedExtensionDirectory(event.sender)
      if (directory === null) {
        return { ok: false, reason: 'canceled' }
      }
      return addBrowserSessionProfileExtension(args.profileId, directory)
    }
  )

  ipcMain.handle(
    'browser:session:removeExtension',
    async (
      event,
      args: { profileId: string; directory: string }
    ): Promise<BrowserSessionExtensionsResult> => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return NOT_AUTHORIZED
      }
      return removeBrowserSessionProfileExtension(args.profileId, args.directory)
    }
  )

  ipcMain.handle(
    'browser:session:reloadExtensions',
    async (event, args: { profileId: string }): Promise<BrowserSessionExtensionsResult> => {
      if (!isTrustedBrowserRenderer(event.sender)) {
        return NOT_AUTHORIZED
      }
      return reloadBrowserSessionProfileExtensions(args.profileId)
    }
  )
}

async function pickUnpackedExtensionDirectory(
  sender: Electron.WebContents
): Promise<string | null> {
  const options = { properties: ['openDirectory' as const] }
  const parent = BrowserWindow.fromWebContents(sender)
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}
