import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import type { Model } from '../src/page/Today.ts'
import { FavouriteData, TrayData } from '../src/page/PickUp.ts'
import { FeedData, More } from '../src/page/WhatsNew.ts'

// Home with what it reads beside today's outfit already in: the tray with `waiting` pieces, no favourite photo, and
// nothing new from anyone.

export const settled = (today: Model, waiting = 0, pictures: ReadonlyArray<string> = []): Model =>
  modifyFields(today, {
    pickUp: () => ({
      tray: TrayData.Success({ data: { waiting, pictures, allowance: { remaining: 97, daily: 100 } } }),
      favourite: FavouriteData.Success({ data: Option.none() }),
    }),
    whatsNew: () => ({ feed: FeedData.Success({ data: { items: [], cursor: null } }), more: More.Idle() }),
  })
