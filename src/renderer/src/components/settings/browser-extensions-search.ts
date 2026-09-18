import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getBrowserExtensionsSearchEntry = createLocalizedCatalog((): SettingsSearchEntry => ({
  title: translate('settings.browser.extensions.title', 'Extensions'),
  description: translate(
    'settings.browser.extensions.searchDescription',
    'Load unpacked Chrome extensions into a browser profile.'
  ),
  keywords: [
    ...translateSearchKeyword('auto.components.settings.browser.search.2d2d995c58', 'browser'),
    ...translateSearchKeyword(
      'auto.components.settings.browser.search.extensions.extension',
      'extension'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.browser.search.extensions.unpacked',
      'unpacked'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.browser.search.extensions.chrome',
      'chrome'
    ),
    ...translateSearchKeyword('auto.components.settings.browser.search.extensions.addon', 'add-on'),
    ...translateSearchKeyword(
      'auto.components.settings.browser.search.extensions.manifest',
      'manifest'
    )
  ]
}))
