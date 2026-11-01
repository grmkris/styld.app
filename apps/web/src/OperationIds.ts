import { OperationId } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'

// Every write the website sends names its operation: a new id for each change the person makes, and the same id again
// when the same change is retried, so the server answers the first request instead of doing it twice.

/** The id an earlier try of the same change drew, or a new one. A UUID always decodes as an operation id, and the
 * browser's crypto does not fail short of a broken runtime. */
export const operationIdOf = (known: Option.Option<string>) =>
  Effect.gen(function* () {
    const id = Option.isSome(known) ? known.value : yield* (yield* Crypto.Crypto).randomUUIDv4()
    return yield* Schema.decodeUnknownEffect(OperationId)(id)
  }).pipe(Effect.orDie)

/** A new operation id, for a change sent once. */
export const newOperationId = operationIdOf(Option.none())

/** The payload of a write that needs nothing but a new operation id: a delete, a retry. */
export const newOperation = Effect.map(newOperationId, (operationId) => ({ operationId }))
