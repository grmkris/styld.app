import { BrowserAuth } from '@styld/auth/client'
import { Effect, Layer, Option, Predicate, Redacted } from 'effect'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import { codeFormId, EmailSignIn, type Problem, SignInRefused } from './page/Login.ts'
import { noteNext } from './SignInReturn.ts'

/** Sign-in always returns to the website; the page then decides where the person belongs. */
const returnTarget = '/'

/** Google returns to the login page, which carries on to the assistant's authorization or to `next`, noted for this
 * tab because Google's return address cannot carry it (Navigation.ts › returnAfterSignIn). */
const googleReturn = (forConnection: boolean) => (forConnection ? '/login/connect' : '/login')

/** The words for a refusal. The server answers a wrong, expired or spent code the same way, so
 * the page tells those apart itself (`page/Login.ts`). */
const problemFor = (error: unknown): Problem => {
  if (Predicate.isTagged(error, 'EmailRejected')) return 'wrongCode'
  if (Predicate.isTagged(error, 'ProofIngressDenied')) return 'tooManyRequests'
  return 'unavailable'
}

const pageLocale = (document: Document) => (document.documentElement.lang === 'sl' ? 'sl' : 'en')

const refused = (error: unknown) => SignInRefused.make({ problem: problemFor(error) })

/** The code form's field, emptied as it is read so a refused code is typed again. */
const takeCode = (document: Document) =>
  Effect.suspend(() => {
    const form = document.getElementById(codeFormId)
    const field = form instanceof HTMLFormElement ? form.elements.namedItem('code') : null
    if (!(field instanceof HTMLInputElement)) return Effect.fail(SignInRefused.make({ problem: 'unavailable' }))
    const code = Redacted.make(field.value.replace(/\s/g, ''))
    field.value = ''
    return /^\d{6}$/.test(Redacted.value(code))
      ? Effect.succeed(code)
      : Effect.fail(SignInRefused.make({ problem: 'wrongCode' }))
  })

/** Email-code sign-in through the auth contract. A first request opens a flow, which binds the
 * code to this browser; a resend sends a new code in the same flow. */
export const emailSignInLayer = (document: Document) =>
  Layer.effect(
    EmailSignIn,
    Effect.gen(function* () {
      const { auth } = yield* BrowserAuth
      const random = yield* SecureRandom.SecureRandom
      const openFlow = Effect.gen(function* () {
        const flowId = yield* random.uuidV4()
        yield* auth.beginEmail({ flowId })
        return flowId
      })
      return {
        requestCode: (email, flowId) =>
          Effect.gen(function* () {
            const flow = yield* Option.match(flowId, { onSome: Effect.succeed, onNone: () => openFlow })
            const receipt = yield* auth.requestEmailCode({
              flowId: flow,
              email,
              returnTarget,
              requestId: yield* random.uuidV4(),
              locale: pageLocale(document),
            })
            return { flowId: flow, requestId: receipt.requestId, proofId: receipt.proofId, keyId: receipt.keyId }
          }).pipe(Effect.mapError(refused)),
        verifyCode: (email, sent) =>
          Effect.gen(function* () {
            const code = yield* takeCode(document)
            const { completion } = yield* auth
              .completeEmailCode({
                flowId: sent.flowId,
                email,
                returnTarget,
                proofId: sent.proofId,
                keyId: sent.keyId,
                code: Redacted.value(code),
              })
              .pipe(Effect.mapError(refused))
            if (!Predicate.isTagged(completion, 'Authenticated'))
              return yield* SignInRefused.make({ problem: 'unavailable' })
            return completion.session.claims
          }),
        startGoogle: (forConnection) =>
          Effect.gen(function* () {
            yield* noteNext(new URLSearchParams(window.location.search).get('next'))
            const { authorizationUrl } = yield* auth.googleSignIn({
              provider: 'google',
              returnTarget: googleReturn(forConnection),
            })
            yield* Effect.sync(() => window.location.assign(Redacted.value(authorizationUrl)))
          }).pipe(Effect.mapError(() => SignInRefused.make({ problem: 'google' }))),
      }
    }),
  )
