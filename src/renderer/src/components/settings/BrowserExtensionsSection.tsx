import { useMemo } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { BrowserSessionProfile } from '../../../../shared/browser-workspace-types'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { BROWSER_EXTENSIONS_SETTINGS_TARGET_ID } from '@/lib/settings-navigation-types'
import { getBrowserExtensionsSearchEntry } from './browser-extensions-search'
import { useBrowserSessionExtensions } from './use-browser-session-extensions'
import { translate } from '@/i18n/i18n'

type BrowserExtensionsSectionProps = {
  profiles: BrowserSessionProfile[]
}

export function BrowserExtensionsSection({
  profiles
}: BrowserExtensionsSectionProps): React.JSX.Element {
  const profileIds = useMemo(() => profiles.map((profile) => profile.id), [profiles])
  const controller = useBrowserSessionExtensions(profileIds)
  const entry = getBrowserExtensionsSearchEntry()

  return (
    <SearchableSetting
      id={BROWSER_EXTENSIONS_SETTINGS_TARGET_ID}
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
      className="space-y-3 py-2"
    >
      <div className="space-y-0.5">
        <Label>{entry.title}</Label>
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.browser.extensions.description',
            'Load unpacked Chrome extensions into a browser profile. They are reloaded every time Orca starts. Extension toolbar popups and options pages are not available yet.'
          )}
        </p>
      </div>

      {controller.error ? <p className="text-xs text-destructive">{controller.error}</p> : null}

      <div className="space-y-2">
        {profiles.map((profile) => (
          <div key={profile.id} className="space-y-2 rounded-md border border-border/70 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-xs font-medium">{profile.label}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={controller.busyProfileId === profile.id}
                  onClick={() => void controller.reload(profile.id)}
                >
                  <RefreshCw className="size-3" />
                  {translate('settings.browser.extensions.reload', 'Reload')}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={controller.busyProfileId === profile.id}
                  onClick={() => void controller.add(profile.id)}
                >
                  <Plus className="size-3" />
                  {translate('settings.browser.extensions.add', 'Add unpacked extension…')}
                </Button>
              </div>
            </div>
            <BrowserProfileExtensionList
              extensions={controller.extensionsByProfileId[profile.id] ?? []}
              onRemove={(directory) => void controller.remove(profile.id, directory)}
            />
          </div>
        ))}
      </div>
    </SearchableSetting>
  )
}

function BrowserProfileExtensionList({
  extensions,
  onRemove
}: {
  extensions: ReturnType<typeof useBrowserSessionExtensions>['extensionsByProfileId'][string]
  onRemove: (directory: string) => void
}): React.JSX.Element {
  if (extensions.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        {translate('settings.browser.extensions.empty', 'No extensions loaded in this profile.')}
      </p>
    )
  }
  return (
    <ul className="space-y-1">
      {extensions.map((extension) => (
        <li key={extension.directory} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs">
              {extension.name ?? translate('settings.browser.extensions.notLoaded', 'Not loaded')}
              {extension.version === null ? '' : ` ${extension.version}`}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{extension.directory}</p>
            {extension.error === null ? null : (
              <p className="truncate text-[11px] text-destructive">{extension.error}</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0"
            aria-label={translate('settings.browser.extensions.remove', 'Remove extension')}
            onClick={() => onRemove(extension.directory)}
          >
            <Trash2 className="size-3" />
          </Button>
        </li>
      ))}
    </ul>
  )
}
