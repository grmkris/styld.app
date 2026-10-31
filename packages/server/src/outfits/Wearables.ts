import { Piece } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import { shownImage, shows } from '../wardrobe/Shown.ts'
import type { Store } from '../wardrobe/Store.ts'
import type { Wearable } from './Rules.ts'

// The outfit engine's one reader of the wardrobe: the person's ready pieces with what the rules need, and the stored
// picture each one shows, for Clef to look at.

/** One of the person's pieces as the engine reads it: the rules' view, and the stored image it shows with a version
 * that changes whenever the piece or its drawing does. */
export interface Owned {
  readonly wearable: Wearable
  readonly picture: { readonly key: string; readonly contentType: string; readonly version: string }
}

/** The most pieces one request reads, newest first. */
const mostRead = 300

const WearableRow = Schema.Struct({
  id: Piece.fields.id,
  type: Piece.fields.type,
  colours: Piece.fields.colours,
  season: Piece.fields.season,
  occasions: Piece.fields.occasions,
  pattern: Piece.fields.pattern,
  name: Piece.fields.name,
})

/** The account's ready pieces. Only the service writes rows, through the same schemas; one that does not decode is a
 * bug. */
export const wearablesOf = (store: Store, accountId: string) =>
  Effect.gen(function* () {
    const rows = (yield* store.listPieces(accountId)).filter(({ status }) => status === 'ready').slice(0, mostRead)
    const pictures = new Map((yield* store.picturesOf(accountId)).map((row) => [row.pieceId, row]))
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeUnknownEffect(WearableRow)(row).pipe(
        Effect.orDie,
        Effect.map((wearable): Owned => {
          const picture = pictures.get(row.id)
          const version = `${String(row.updatedAt.getTime())}-${shows(picture)}${String(picture?.version ?? 0)}`
          return {
            wearable: { ...wearable, drawn: shows(picture) === 'clean' },
            picture: { ...shownImage(row, picture), version },
          }
        }),
      ),
    )
  })
