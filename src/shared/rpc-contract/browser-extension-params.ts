import { z } from 'zod'
import { requiredString } from './rpc-param-primitives'

// Why a separate module: browser-params.ts is at its line cap, and these four share one subject —
// the unpacked extension directories a browser session profile loads.

// Why a default rather than an optional: 'default' is the registry's id for the default profile, so
// omitting --profile means that profile, never "no profile".
const ProfileId = z.string().min(1).default('default')

export const ProfileExtensionList = z.object({ profileId: ProfileId })

export const ProfileExtensionTarget = z.object({
  profileId: ProfileId,
  // Absolute because the CLI resolves --dir against its own cwd, which the runtime does not share.
  directory: requiredString('Missing required --dir')
})

export const ProfileExtensionReload = z.object({ profileId: ProfileId })
