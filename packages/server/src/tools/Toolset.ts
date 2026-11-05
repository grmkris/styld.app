import { Layer } from 'effect'
import { account } from '../Account.ts'
import { capture } from '../capture/Module.ts'
import { feedback } from '../feedback/Module.ts'
import { generation } from '../generation/Module.ts'
import { links } from '../links/Module.ts'
import { outfits } from '../outfits/Module.ts'
import { photos } from '../photos/Module.ts'
import { social } from '../social/Module.ts'
import { wardrobe } from '../wardrobe/Module.ts'
import { AssistantToolset } from './StyldTools.ts'

/** The assistants' tools over the modules they project; Styld's chat answers with the same ones. */
export const toolset = AssistantToolset.layer.pipe(
  Layer.provide([
    wardrobe.layer,
    links.layer,
    social.layer,
    capture.layer,
    generation.layer,
    photos.layer,
    outfits.layer,
    account.layer,
    feedback.layer,
  ]),
)
