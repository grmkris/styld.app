import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'
import {
  type Code,
  Message,
  RequestCode,
  Step,
  VerifyCode,
  canResend,
  currentCode,
  init,
  update,
} from '../src/page/Login.ts'

const sent = { flowId: 'flow_1', requestId: 'req_1', proofId: 'proof_1', keyId: 'key_1' }
const open: Code = { sent, use: 'open', rejections: 0, resent: false, resendIn: 30 }

const at = (step: Step) =>
  modifyFields(init(), { email: () => 'ana@example.com', flowId: () => Option.some('flow_1'), step: () => step })

const codeUse = (step: Step) => Option.map(currentCode(step), ({ use }) => use)

describe('a code lasts five minutes', () => {
  test('when it runs out the page says so and stops sending it to the server', () => {
    story(
      update,
      given(at(Step.EnterCode({ code: open }))),
      message(Message.ElapsedCodeLifetime({ requestId: 'req_1' })),
      model(({ step, problem }) => {
        expect(codeUse(step)).toEqual(Option.some('expired'))
        expect(problem).toEqual(Option.some('expired'))
      }),
      message(Message.SubmittedCode()),
      Command.expectNone(),
    )
  })

  test('the lifetime of a code the person already replaced changes nothing', () => {
    story(
      update,
      given(at(Step.EnterCode({ code: open }))),
      message(Message.ElapsedCodeLifetime({ requestId: 'req_0' })),
      model(({ step, problem }) => {
        expect(codeUse(step)).toEqual(Option.some('open'))
        expect(problem).toEqual(Option.none())
      }),
    )
  })

  test('a code that runs out while it is checked is reported as expired, not wrong', () => {
    story(
      update,
      given(at(Step.VerifyingCode({ code: open }))),
      message(Message.ElapsedCodeLifetime({ requestId: 'req_1' })),
      message(Message.FailedVerifyCode({ problem: 'wrongCode' })),
      model(({ step, problem }) => {
        expect(Step.guards.EnterCode(step)).toBe(true)
        expect(problem).toEqual(Option.some('expired'))
      }),
    )
  })

  test('a refusal that is not about the code keeps its tries', () => {
    story(
      update,
      given(at(Step.VerifyingCode({ code: open }))),
      message(Message.FailedVerifyCode({ problem: 'unavailable' })),
      model(({ step, problem }) => {
        expect(Option.map(currentCode(step), ({ rejections }) => rejections)).toEqual(Option.some(0))
        expect(problem).toEqual(Option.some('unavailable'))
      }),
    )
  })
})

describe('a whole code sends itself', () => {
  test('six digits verify once; more input while checking sends nothing', () => {
    story(
      update,
      given(at(Step.EnterCode({ code: open }))),
      message(Message.UpdatedCode({ isComplete: false })),
      Command.expectNone(),
      message(Message.UpdatedCode({ isComplete: true })),
      Command.expectExact(VerifyCode({ email: 'ana@example.com', sent })),
      model(({ step }) => expect(Step.guards.VerifyingCode(step)).toBe(true)),
      Command.resolve(VerifyCode, Message.FailedVerifyCode({ problem: 'wrongCode' })),
    )
    story(
      update,
      given(at(Step.VerifyingCode({ code: open }))),
      message(Message.UpdatedCode({ isComplete: true })),
      message(Message.SubmittedCode()),
      Command.expectNone(),
    )
  })
})

describe('resending', () => {
  test('opens after the countdown for the newest code only', () => {
    story(
      update,
      given(at(Step.EnterCode({ code: modifyFields(open, { resendIn: () => 1 }) }))),
      message(Message.ClickedResendCode()),
      Command.expectNone(),
      message(Message.TickedResendCountdown({ requestId: 'req_0' })),
      model(({ step }) => expect(Option.map(currentCode(step), canResend)).toEqual(Option.some(false))),
      message(Message.TickedResendCountdown({ requestId: 'req_1' })),
      model(({ step }) => expect(Option.map(currentCode(step), canResend)).toEqual(Option.some(true))),
      message(Message.TickedResendCountdown({ requestId: 'req_1' })),
      model(({ step }) => expect(Option.map(currentCode(step), ({ resendIn }) => resendIn)).toEqual(Option.some(0))),
    )
  })

  test('a failed resend keeps the code the person already has', () => {
    story(
      update,
      given(at(Step.ResendingCode({ code: modifyFields(open, { resendIn: () => 0 }) }))),
      message(Message.FailedResendCode({ problem: 'tooManyRequests' })),
      model(({ step, problem }) => {
        expect(Option.map(currentCode(step), ({ sent: { proofId } }) => proofId)).toEqual(Option.some('proof_1'))
        expect(problem).toEqual(Option.some('tooManyRequests'))
      }),
    )
  })
})

describe('one sign-in keeps one flow', () => {
  test('another email asks for its code in the flow of the first', () => {
    story(
      update,
      given(at(Step.EnterCode({ code: open }))),
      message(Message.ClickedUseDifferentEmail()),
      message(Message.UpdatedEmail({ value: 'bo@example.com' })),
      message(Message.SubmittedEmail()),
      Command.expectExact(RequestCode({ email: 'bo@example.com', flowId: Option.some('flow_1') })),
      Command.resolve(RequestCode, Message.FailedRequestCode({ problem: 'unavailable' })),
      // The refused flow may have run out, so the next request opens a new one.
      model(({ flowId }) => expect(flowId).toEqual(Option.none())),
    )
  })
})
