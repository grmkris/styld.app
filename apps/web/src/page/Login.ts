import { AccountClaims } from '@styld/auth/config'
import { Context, Duration, Effect, Option, Schema, Stream } from 'effect'
import { Command, Subscription, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

// MODEL

/** Why an email or a code was refused, in words the page shows. */
export const Problem = Schema.Literals([
  'invalidEmail',
  'wrongCode',
  'expired',
  'tooManyAttempts',
  'tooManyRequests',
  'unavailable',
  'google',
])
export type Problem = typeof Problem.Type

/** The handles of the newest code the server sent. They name the code; only the person's inbox
 * holds the code itself. */
export const CodeSent = Schema.Struct({
  flowId: Schema.String,
  requestId: Schema.String,
  proofId: Schema.String,
  keyId: Schema.String,
})
export type CodeSent = typeof CodeSent.Type

/** A code lasts five minutes and takes three tries. The server refuses a spent code with the same
 * answer as a wrong one, so the page keeps both rules to say which it was. */
const codeLifetime = Duration.minutes(5)
const codeAttempts = 3
/** The server sends no new code within 30 seconds of the last one; the page counts them down. */
const resendPauseSeconds = 30
/** A code is six digits; a full one is sent without waiting for the button. */
const codeShape = /^\d{6}$/

const CodeUse = Schema.Literals(['open', 'expired', 'exhausted'])

export const Code = Schema.Struct({
  sent: CodeSent,
  use: CodeUse,
  rejections: Schema.Number,
  /** The last send was a resend, which the page announces. */
  resent: Schema.Boolean,
  /** Seconds left of the resend pause after the last send; none left means a new code can be asked for. */
  resendIn: Schema.Number,
})
export type Code = typeof Code.Type

/** Where sign-in stands. The code the person types never enters the Model: the code form keeps it. */
export const Step = defineTaggedUnion({
  EnterEmail: {},
  SendingCode: {},
  EnterCode: { code: Code },
  VerifyingCode: { code: Code },
  ResendingCode: { code: Code },
})
export type Step = typeof Step.Type

export const Model = Schema.Struct({
  email: Schema.String,
  /** The sign-in flow this page opened with its first request; every later code belongs to it. */
  flowId: Schema.Option(Schema.String),
  step: Step,
  problem: Schema.Option(Problem),
  /** The page is on its way to Google's sign-in. */
  goingToGoogle: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  email: '',
  flowId: Option.none(),
  step: Step.EnterEmail(),
  problem: Option.none(),
  goingToGoogle: false,
})

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedEmail: { value: Schema.String },
  SubmittedEmail: {},
  SucceededRequestCode: { sent: CodeSent },
  FailedRequestCode: { problem: Problem },
  SubmittedCode: {},
  /** The code field changed. It says only whether six digits are in it: the code itself stays in the field. */
  UpdatedCode: { isComplete: Schema.Boolean },
  SucceededVerifyCode: { claims: AccountClaims },
  FailedVerifyCode: { problem: Problem },
  ClickedResendCode: {},
  SucceededResendCode: { sent: CodeSent },
  FailedResendCode: { problem: Problem },
  TickedResendCountdown: { requestId: Schema.String },
  ElapsedCodeLifetime: { requestId: Schema.String },
  ClickedUseDifferentEmail: {},
  ClickedContinueWithGoogle: { forConnection: Schema.Boolean },
  FailedStartGoogle: { problem: Problem },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ SignedIn: { claims: AccountClaims } })
export type OutMessage = typeof OutMessage.Type

// PORT

/** The code form's id: the browser adapter reads the code from it when verifying. */
export const codeFormId = 'email-code'

export class SignInRefused extends Schema.TaggedError<SignInRefused>()('SignInRefused', { problem: Problem }) {}

/** The browser's email-code sign-in. It reads the code from the code form when verifying, so the
 * code never passes through a Message or a Command argument. */
export class EmailSignIn extends Context.Service<
  EmailSignIn,
  {
    /** Send a code in the page's language, in the given flow or a new one. */
    readonly requestCode: (email: string, flowId: Option.Option<string>) => Effect.Effect<CodeSent, SignInRefused>
    readonly verifyCode: (email: string, sent: CodeSent) => Effect.Effect<AccountClaims, SignInRefused>
    /** Leave for Google's sign-in, which comes back to the login page signed in (or with a problem). It only returns
     * if Google could not be started. */
    readonly startGoogle: (forConnection: boolean) => Effect.Effect<void, SignInRefused>
  }
>()('@styld/web/EmailSignIn') {}

// COMMAND

export const RequestCode = Command.define('RequestCode', {
  args: { email: Schema.String, flowId: Schema.Option(Schema.String) },
  messages: [Message.SucceededRequestCode, Message.FailedRequestCode],
  execute: ({ email, flowId }) =>
    Effect.gen(function* () {
      const sent = yield* (yield* EmailSignIn).requestCode(email, flowId)
      return Message.SucceededRequestCode({ sent })
    }).pipe(Effect.catchTag('SignInRefused', ({ problem }) => Effect.succeed(Message.FailedRequestCode({ problem })))),
})

export const ResendCode = Command.define('ResendCode', {
  args: { email: Schema.String, flowId: Schema.String },
  messages: [Message.SucceededResendCode, Message.FailedResendCode],
  execute: ({ email, flowId }) =>
    Effect.gen(function* () {
      const sent = yield* (yield* EmailSignIn).requestCode(email, Option.some(flowId))
      return Message.SucceededResendCode({ sent })
    }).pipe(Effect.catchTag('SignInRefused', ({ problem }) => Effect.succeed(Message.FailedResendCode({ problem })))),
})

export const VerifyCode = Command.define('VerifyCode', {
  args: { email: Schema.String, sent: CodeSent },
  messages: [Message.SucceededVerifyCode, Message.FailedVerifyCode],
  execute: ({ email, sent }) =>
    Effect.gen(function* () {
      const claims = yield* (yield* EmailSignIn).verifyCode(email, sent)
      return Message.SucceededVerifyCode({ claims })
    }).pipe(Effect.catchTag('SignInRefused', ({ problem }) => Effect.succeed(Message.FailedVerifyCode({ problem })))),
})

export const StartGoogle = Command.define('StartGoogle', {
  args: { forConnection: Schema.Boolean },
  messages: [Message.FailedStartGoogle],
  execute: ({ forConnection }) =>
    Effect.gen(function* () {
      yield* (yield* EmailSignIn).startGoogle(forConnection)
      // The page is leaving; nothing more is said unless the browser stays.
      return yield* Effect.never
    }).pipe(Effect.catchTag('SignInRefused', ({ problem }) => Effect.succeed(Message.FailedStartGoogle({ problem })))),
})

export const WaitForCodeExpiry = Command.define('WaitForCodeExpiry', {
  args: { requestId: Schema.String },
  messages: [Message.ElapsedCodeLifetime],
  execute: ({ requestId }) => Effect.sleep(codeLifetime).pipe(Effect.as(Message.ElapsedCodeLifetime({ requestId }))),
})

/** Whether the field holds a whole code, spaces aside. */
export const isCompleteCode = (value: string) => codeShape.test(value.replace(/\s/g, ''))

/** The resend pause after the last send has passed. */
export const canResend = (code: Code) => code.resendIn <= 0

// UPDATE

const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, EmailSignIn>

/** The code the step holds, whatever is happening to it.
 */
export const currentCode = (step: Step): Option.Option<Code> =>
  Step.guards.EnterCode(step) || Step.guards.VerifyingCode(step) || Step.guards.ResendingCode(step)
    ? Option.some(step.code)
    : Option.none()

/** A fresh code: open, untried, and timed from now. */
const codeArrived = (model: Model, sent: CodeSent, resent: boolean): UpdateReturn => ({
  model: modifyFields(model, {
    flowId: () => Option.some(sent.flowId),
    step: () => Step.EnterCode({ code: { sent, use: 'open', rejections: 0, resent, resendIn: resendPauseSeconds } }),
    problem: () => Option.none(),
  }),
  commands: [WaitForCodeExpiry({ requestId: sent.requestId })],
})

/** The same step, holding a changed code. */
const withCode = (step: Step, code: Code): Step =>
  Step.match(step, {
    EnterEmail: () => step,
    SendingCode: () => step,
    EnterCode: () => Step.EnterCode({ code }),
    VerifyingCode: () => Step.VerifyingCode({ code }),
    ResendingCode: () => Step.ResendingCode({ code }),
  })

/** The code a timer was started for, if it is still the newest one. */
const timedCode = (model: Model, requestId: string) =>
  Option.filter(currentCode(model.step), (code) => code.sent.requestId === requestId)

const submittedEmail = (model: Model): UpdateReturn => {
  if (!Step.guards.EnterEmail(model.step)) return { model }
  const email = model.email.trim()
  if (!emailShape.test(email) || email.length > 320)
    return { model: modifyFields(model, { problem: () => Option.some<Problem>('invalidEmail') }) }
  return {
    model: modifyFields(model, { email: () => email, step: () => Step.SendingCode(), problem: () => Option.none() }),
    commands: [RequestCode({ email, flowId: model.flowId })],
  }
}

const submittedCode = (model: Model): UpdateReturn => {
  const { step } = model
  if (!Step.guards.EnterCode(step) || step.code.use !== 'open') return { model }
  return {
    model: modifyFields(model, { step: () => Step.VerifyingCode({ code: step.code }), problem: () => Option.none() }),
    commands: [VerifyCode({ email: model.email, sent: step.code.sent })],
  }
}

/** A refused code counts against its tries; the last try uses the code up. A code that ran out
 * while it was being checked is refused like a wrong one, so the page names the real reason. */
const failedVerifyCode = (model: Model, problem: Problem): UpdateReturn => {
  const { step } = model
  if (!Step.guards.VerifyingCode(step)) return { model }
  const rejections = problem === 'wrongCode' ? step.code.rejections + 1 : step.code.rejections
  const exhausted = rejections >= codeAttempts
  const shown: Problem = exhausted
    ? 'tooManyAttempts'
    : step.code.use === 'expired' && problem === 'wrongCode'
      ? 'expired'
      : problem
  return {
    model: modifyFields(model, {
      step: () =>
        Step.EnterCode({
          code: modifyFields(step.code, {
            rejections: () => rejections,
            use: (use) => (exhausted ? 'exhausted' : use),
            resent: () => false,
          }),
        }),
      problem: () => Option.some(shown),
    }),
  }
}

const clickedResendCode = (model: Model): UpdateReturn => {
  const { step } = model
  if (!Step.guards.EnterCode(step) || !canResend(step.code)) return { model }
  return {
    model: modifyFields(model, { step: () => Step.ResendingCode({ code: step.code }), problem: () => Option.none() }),
    commands: [ResendCode({ email: model.email, flowId: step.code.sent.flowId })],
  }
}

const failedResendCode = (model: Model, problem: Problem): UpdateReturn => {
  const { step } = model
  if (!Step.guards.ResendingCode(step)) return { model }
  return {
    model: modifyFields(model, {
      step: () => Step.EnterCode({ code: modifyFields(step.code, { resent: () => false }) }),
      problem: () => Option.some(problem),
    }),
  }
}

const tickedResendCountdown = (model: Model, requestId: string): UpdateReturn =>
  Option.match(timedCode(model, requestId), {
    onNone: () => ({ model }),
    onSome: (code) => ({
      model: modifyFields(model, {
        step: (step) => withCode(step, modifyFields(code, { resendIn: (seconds) => Math.max(0, seconds - 1) })),
      }),
    }),
  })

const elapsedCodeLifetime = (model: Model, requestId: string): UpdateReturn =>
  Option.match(
    Option.filter(timedCode(model, requestId), (code) => code.use === 'open'),
    {
      onNone: () => ({ model }),
      onSome: (code) => ({
        model: modifyFields(model, {
          step: (step) => withCode(step, modifyFields(code, { use: () => 'expired' })),
          problem: () => Option.some<Problem>('expired'),
        }),
      }),
    },
  )

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    UpdatedEmail: ({ value }) => ({ model: modifyFields(model, { email: () => value }) }),
    SubmittedEmail: () => submittedEmail(model),
    SucceededRequestCode: ({ sent }) =>
      Step.guards.SendingCode(model.step) ? codeArrived(model, sent, false) : { model },
    // A refused request may come from a flow that ran out, so the next request opens a new one.
    FailedRequestCode: ({ problem }) => ({
      model: modifyFields(model, {
        step: () => Step.EnterEmail(),
        flowId: () => Option.none(),
        problem: () => Option.some(problem),
      }),
    }),
    SubmittedCode: () => submittedCode(model),
    UpdatedCode: ({ isComplete }) => (isComplete ? submittedCode(model) : { model }),
    SucceededVerifyCode: ({ claims }) => ({ model: init(), outMessage: OutMessage.SignedIn({ claims }) }),
    FailedVerifyCode: ({ problem }) => failedVerifyCode(model, problem),
    ClickedResendCode: () => clickedResendCode(model),
    ClickedContinueWithGoogle: ({ forConnection }) =>
      model.goingToGoogle || !Step.guards.EnterEmail(model.step)
        ? { model }
        : {
            model: modifyFields(model, { goingToGoogle: () => true, problem: () => Option.none() }),
            commands: [StartGoogle({ forConnection })],
          },
    FailedStartGoogle: ({ problem }) => ({
      model: modifyFields(model, { goingToGoogle: () => false, problem: () => Option.some(problem) }),
    }),
    SucceededResendCode: ({ sent }) =>
      Step.guards.ResendingCode(model.step) ? codeArrived(model, sent, true) : { model },
    FailedResendCode: ({ problem }) => failedResendCode(model, problem),
    TickedResendCountdown: ({ requestId }) => tickedResendCountdown(model, requestId),
    ElapsedCodeLifetime: ({ requestId }) => elapsedCodeLifetime(model, requestId),
    // The flow stays: a new flow sends nothing while a code from this one is still live.
    ClickedUseDifferentEmail: () => ({
      model: modifyFields(init(), { email: () => model.email, flowId: () => model.flowId }),
    }),
  })

// SUBSCRIPTION

const resendTick = Duration.seconds(1)

/** The resend countdown ticks once a second, only while the newest code's pause runs; a new code starts it over. */
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  resendCountdown: entry(
    { maybeCountingFor: Schema.Option(Schema.String) },
    {
      modelToDependencies: (model) => ({
        maybeCountingFor: Option.map(
          Option.filter(currentCode(model.step), (code) => !canResend(code)),
          (code) => code.sent.requestId,
        ),
      }),
      dependenciesToStream: ({ maybeCountingFor }) =>
        Option.match(maybeCountingFor, {
          onNone: () => Stream.empty,
          onSome: (requestId) =>
            Stream.tick(resendTick).pipe(
              Stream.drop(1),
              Stream.map(() => Message.TickedResendCountdown({ requestId })),
            ),
        }),
    },
  ),
}))
