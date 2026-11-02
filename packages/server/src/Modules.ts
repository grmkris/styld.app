import { account } from './Account.ts'
import { capture } from './capture/Module.ts'
import { generation } from './generation/Module.ts'
import { imports } from './imports/Module.ts'
import { links } from './links/Module.ts'
import { mcp } from './mcp/Module.ts'
import { outfits } from './outfits/Module.ts'
import { photos } from './photos/Module.ts'
import { platform } from './Platform.ts'
import { social } from './social/Module.ts'
import { stylist } from './stylist/Module.ts'
import { wardrobe } from './wardrobe/Module.ts'

/** Every module of the API Worker (`kernel/Module.ts`), each one entry: its services, API groups, routes, consumers
 * and sweeps. `StyldWorker.ts` builds them over the kernel once per runtime. */
export const modules = [
  platform,
  account,
  social,
  wardrobe,
  capture,
  photos,
  generation,
  outfits,
  links,
  stylist,
  mcp,
  imports,
] as const
