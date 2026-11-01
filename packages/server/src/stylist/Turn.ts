import { Clock, Effect, Ref, Stream } from 'effect'
import { Chat, type Tool, type Toolkit } from 'effect/ai'

/** How often the reply so far is reported while it is written. */
const progressEvery = 250

/** One model call: its words as they come, to `onWords`, and the tools it called. The language model deadlines,
 * counts and prices the call (`ai/LanguageModel.ts`). */
const callModel = <Tools extends Record<string, Tool.Any>>(
  chat: Chat.Chat,
  toolkit: Toolkit.WithHandler<Tools>,
  onWords: (text: string) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const calls: Array<string> = []
    let text = ''
    yield* chat.streamText({ prompt: [], toolkit }).pipe(
      Stream.runForEach((part) => {
        if (part.type === 'text-delta') {
          text += part.delta
          return onWords(text)
        }
        if (part.type === 'tool-call') calls.push(part.name)
        return Effect.void
      }),
    )
    return { text: text.trim(), calls }
  })

/** What one call said: its words, and whether it wrote them beside a lookup, thinking aloud. */
interface Said {
  readonly text: string
  readonly aloud: boolean
}

/** The reply from what the calls said, a blank line apart: thinking aloud is left out unless it is all there is. */
const replyOf = (said: ReadonlyArray<Said>) => {
  const words = said.filter(({ text }) => text.length > 0)
  const meant = words.filter(({ aloud }) => !aloud)
  return (meant.length > 0 ? meant : words).map(({ text }) => text).join('\n\n')
}

/** A call ends the reply when it called no tool, or wrote its words and only showed something. */
const endsReply = (text: string, calls: ReadonlyArray<string>, showing: ReadonlySet<string>) =>
  calls.length === 0 || (text.length > 0 && calls.every((name) => showing.has(name)))

/** Run one reply: the model answers the chat so far, calling the toolkit's tools as it needs, for at most
 * `maxSteps` calls; each call's answer is fed back before the next. A call that wrote words and called only
 * `showing` tools ends the reply. `progress` hears the reply so far, at most four times a second. The words
 * of every call are kept, a blank line apart, except those written beside a `lookingUp` tool while any other call
 * says something. */
export const runTurn = <Tools extends Record<string, Tool.Any>>(input: {
  readonly system: string
  readonly history: ReadonlyArray<{ readonly role: 'person' | 'styld'; readonly text: string }>
  readonly toolkit: Toolkit.WithHandler<Tools>
  readonly maxSteps: number
  readonly showing: ReadonlySet<string>
  readonly lookingUp: ReadonlySet<string>
  readonly progress: (text: string) => Effect.Effect<void>
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
    const said: Array<Said> = []
    const reported = yield* Ref.make(0)
    const report = (text: string, force: boolean) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (!force && now - (yield* Ref.get(reported)) < progressEvery) return
        yield* Ref.set(reported, now)
        yield* input.progress(text)
      })
    for (let step = 0; step < input.maxSteps; step++) {
      const before = replyOf(said)
      const { text, calls } = yield* callModel(chat, input.toolkit, (sofar) =>
        report([before, sofar].filter((words) => words.length > 0).join('\n\n'), false),
      )
      said.push({ text, aloud: calls.some((name) => input.lookingUp.has(name)) })
      if (endsReply(text, calls, input.showing)) break
    }
    const reply = replyOf(said)
    yield* report(reply, true)
    return reply
  })
