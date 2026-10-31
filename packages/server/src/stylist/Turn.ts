import { Clock, Effect, Ref, Stream } from 'effect'
import { Chat, type Tool, type Toolkit } from 'effect/ai'

/** One model call of a reply: how long it took and the tokens it was billed. */
export interface StepUsage {
  readonly milliseconds: number
  readonly inputTokens: number
  readonly outputTokens: number
}

/** How often the reply so far is reported while it is written. */
const progressEvery = 250

/** Run one reply: the model answers the chat so far, calling the toolkit's tools as it needs, for at most
 * `maxSteps` calls; each call's answer is fed back before the next. A call that wrote words and called only
 * `showing` tools ends the reply. `progress` hears the reply so far, at most four times a second, and `counted` each
 * call's usage; the words of every call are kept, a blank line apart. */
export const runTurn = <Tools extends Record<string, Tool.Any>>(input: {
  readonly system: string
  readonly history: ReadonlyArray<{ readonly role: 'person' | 'styld'; readonly text: string }>
  readonly toolkit: Toolkit.WithHandler<Tools>
  readonly maxSteps: number
  readonly showing: ReadonlySet<string>
  readonly progress: (text: string) => Effect.Effect<void>
  readonly counted: (usage: StepUsage) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const chat = yield* Chat.fromPrompt([
      { role: 'system', content: input.system },
      ...input.history.map((message) =>
        message.role === 'person'
          ? ({ role: 'user', content: message.text } as const)
          : ({ role: 'assistant', content: message.text } as const),
      ),
    ])
    const written = yield* Ref.make<ReadonlyArray<string>>([])
    const reported = yield* Ref.make(0)
    const report = (text: string, force: boolean) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (!force && now - (yield* Ref.get(reported)) < progressEvery) return
        yield* Ref.set(reported, now)
        yield* input.progress(text)
      })
    for (let step = 0; step < input.maxSteps; step++) {
      const started = yield* Clock.currentTimeMillis
      const before = (yield* Ref.get(written)).join('\n\n')
      const calls: Array<string> = []
      const state = { text: '', inputTokens: 0, outputTokens: 0 }
      yield* chat.streamText({ prompt: [], toolkit: input.toolkit }).pipe(
        Stream.runForEach((part) => {
          if (part.type === 'text-delta') {
            state.text += part.delta
            return report([before, state.text].filter((text) => text.length > 0).join('\n\n'), false)
          }
          if (part.type === 'tool-call') calls.push(part.name)
          if (part.type === 'finish') {
            state.inputTokens += part.usage.inputTokens.total ?? 0
            state.outputTokens += part.usage.outputTokens.total ?? 0
          }
          return Effect.void
        }),
      )
      const milliseconds = (yield* Clock.currentTimeMillis) - started
      yield* input.counted({ milliseconds, inputTokens: state.inputTokens, outputTokens: state.outputTokens })
      const text = state.text.trim()
      if (text.length > 0) yield* Ref.update(written, (all) => [...all, text])
      const showedOnly = text.length > 0 && calls.every((name) => input.showing.has(name))
      if (calls.length === 0 || showedOnly) break
    }
    const reply = (yield* Ref.get(written)).join('\n\n')
    yield* report(reply, true)
    return reply
  })
