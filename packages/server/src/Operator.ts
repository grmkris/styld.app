import { CurrentOperator, NotFound, OperatorAuth } from '@styld/protocol'
import { Effect, Layer, Option, Redacted } from 'effect'
import { Deployment } from './Config.ts'

// The operator's token checked at the edge of the operator's routes (`@styld/protocol` › Operator): the Worker keeps
// only the token's SHA-256 digest and compares digests in constant time, so neither the token nor how much of a guess
// matched leaks. A stage without a token has no operator: its routes answer as if they were not there.

/** A token shorter than this is not a random secret (32 random bytes in base64url are 43 characters). */
const shortest = 43

const digest = (token: string) =>
  Effect.promise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).pipe(
    Effect.map((bytes) => new Uint8Array(bytes)),
  )

/** The digest the Worker keeps of the stage's operator token; a token too short to be a secret is a broken stage. */
export const operatorDigestOf = (token: string) =>
  token.length < shortest
    ? Effect.die(new Error(`STYLD_OPERATOR_TOKEN must be a random secret of at least ${shortest} characters`))
    : digest(token)

/** Two digests of the same length compared without stopping at the first difference. */
const sameDigest = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return difference === 0
}

/** Whether `presented` is the operator's token, for a stage whose token has `operator` as its digest. */
export const isOperator = Effect.fnUntraced(function* (operator: Option.Option<Uint8Array>, presented: string) {
  if (Option.isNone(operator)) return false
  return sameDigest(operator.value, yield* digest(presented))
})

/** `OperatorAuth` on the server: the bearer token, when it is the operator's, becomes `CurrentOperator`. */
export const operatorAuthLayer = Layer.effect(
  OperatorAuth,
  Effect.gen(function* () {
    const deployment = yield* Deployment
    return OperatorAuth.of({
      bearer: Effect.fnUntraced(function* (httpEffect, { credential }) {
        if (!(yield* isOperator(deployment.operator, Redacted.value(credential)))) return yield* NotFound.make({})
        yield* Effect.annotateCurrentSpan('styld.actor', 'operator')
        return yield* Effect.provideService(httpEffect, CurrentOperator, { via: 'token' })
      }),
    })
  }),
)
