import { CurrentAccount, LimitReached, Unavailable } from '@styld/protocol'
import { Effect } from 'effect'
import { nowDate } from '../kernel/Db.ts'
import { Pacing } from '../kernel/Pacing.ts'
import { WardrobeStore } from './Store.ts'

/** What may wait unused per account before another upload path is handed out: paths not yet expired and bytes no
 * piece, capture or photo took yet. A hundred uploads, or 512 MiB (five of the largest videos), is far beyond a
 * camera roll's selection, and bounds what one account can leave stored until the sweep (`Work.ts`). */
const waitingUploads = 100
const waitingBytes = 512 * 1024 * 1024

/** Hand out another upload path only at the account's pace (`upload`) and while what waits unused, with this one,
 * stays under the cap. */
export const admitUpload = Effect.fn('Styld.Wardrobe.admitUpload')(function* (bytes: number) {
  yield* (yield* Pacing).account('upload')
  const { accountId } = yield* CurrentAccount
  const waiting = yield* (yield* WardrobeStore)
    .waitingUploads(accountId, yield* nowDate)
    .pipe(Effect.mapError(() => Unavailable.make({})))
  if (waiting.count >= waitingUploads || waiting.bytes + bytes > waitingBytes)
    return yield* LimitReached.make({ limit: 'uploads' })
})
