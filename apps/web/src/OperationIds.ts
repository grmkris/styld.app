import { OperationId } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'

// Every write the website sends names its operation, and every operation id is made here, one way: drawn inside the
// Command that sends the write (FOLDKIT.md › Commands), never while preparing it. A change sent once draws a new id.
// A change whose answer may have been lost is tried again under the id its first try drew: that try's failure Message
// carries the id back, the Model keeps it, and the retry's Command receives it here, so the server answers the first
// request instead of doing it twice.

/** The operation id a write is sent under: the one an earlier try of the same change drew, or a new one. A UUID
 * always decodes as an operation id, and the browser's crypto does not fail short of a broken runtime. */
export const drawOperationId = (
  maybeEarlier: Option.Option<OperationId> = Option.none(),
): Effect.Effect<OperationId, never, SecureRandom.SecureRandom> =>
  Option.match(maybeEarlier, {
    onSome: Effect.succeed,
    onNone: () =>
      Effect.gen(function* () {
        const uuid = yield* (yield* SecureRandom.SecureRandom).uuidV4()
        return yield* Schema.decodeUnknownEffect(OperationId)(uuid)
      }).pipe(Effect.orDie),
  })
