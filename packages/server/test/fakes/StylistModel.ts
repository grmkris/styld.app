import { Effect, Layer, Option, Schema, Stream } from 'effect'
import { AiError, LanguageModel, type Prompt, type Response } from 'effect/ai'

// Styld's chat model as the native suite plays it inside the Thread Worker (`StylistThreadWorker.ts`): the local stack
// cannot reach the paid route. It answers by where the reply is, streaming its words a few at a time so a watcher sees
// them arrive before the reply settles. A message with `[[fail]]` is refused, as a model that is down would be.

const usage = { inputTokens: { total: 100 }, outputTokens: { total: 20 } }

const Found = Schema.Struct({ pieces: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String })) })
const decodeFound = Schema.decodeUnknownOption(Found)

/** How long the fake waits between words: long enough that a page opened after the message was sent still sees them
 * arrive before the reply settles. */
const pause = '400 millis'

const toolCall = (name: string, params: object): Stream.Stream<Response.StreamPartEncoded> =>
  Stream.make({ type: 'tool-call', id: `call_${name}`, name, params }, { type: 'finish', reason: 'tool-calls', usage })

/** Words, streamed a few at a time, then the end of the answer. */
const saying = (text: string): Stream.Stream<Response.StreamPartEncoded> =>
  Stream.make<Array<Response.StreamPartEncoded>>({ type: 'text-start', id: 'reply' }).pipe(
    Stream.concat(
      Stream.fromIterable(text.split(/(?<= )/u)).pipe(
        Stream.mapEffect((delta) =>
          Effect.as(Effect.sleep(pause), { type: 'text-delta' as const, id: 'reply', delta }),
        ),
      ),
    ),
    Stream.concat(
      Stream.make<Array<Response.StreamPartEncoded>>(
        { type: 'text-end', id: 'reply' },
        { type: 'finish', reason: 'stop', usage },
      ),
    ),
  )

/** The words of a message, as the person wrote them. */
const textOf = (message: Prompt.Message) =>
  typeof message.content === 'string'
    ? message.content
    : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(' ')

/** The results of the tools called since the person's last message. */
const resultsSince = (messages: ReadonlyArray<Prompt.Message>) =>
  messages
    .slice(messages.findLastIndex(({ role }) => role === 'user') + 1)
    .flatMap((message) =>
      message.role === 'tool' ? message.content.flatMap((part) => (part.type === 'tool-result' ? [part] : [])) : [],
    )

/** What a person says yes to remembering, and what they ask a new chat about it (the taste journey). */
const remember = 'Yes, remember: '
const remembered = 'What do you remember?'

/** Told to remember something, it keeps it with `note_add`; asked what it remembers, it answers from its instructions
 * alone. Anything else is not about taste. */
const tasteAnswer = (
  asked: string,
  messages: ReadonlyArray<Prompt.Message>,
  results: ReturnType<typeof resultsSince>,
): Stream.Stream<Response.StreamPartEncoded> | undefined => {
  if (asked.startsWith(remember))
    return results.some(({ name }) => name === 'note_add')
      ? saying('I will remember that.')
      : toolCall('note_add', { text: asked.slice(remember.length) })
  if (asked !== remembered) return undefined
  const system = messages.find(({ role }) => role === 'system')
  const told = /They asked you to remember: ("[^"]+")/u.exec(system === undefined ? '' : textOf(system))?.[1]
  return saying(told === undefined ? 'Nothing yet.' : `You told me: ${told}`)
}

/** The next answer: first it searches the wardrobe, then it shows the first piece it found, then it suggests it.
 * Asked to analyse the wardrobe, it counts it with `wardrobe_analyze` and then comments; taste is `tasteAnswer`'s. */
const answer = (
  messages: ReadonlyArray<Prompt.Message>,
): Stream.Stream<Response.StreamPartEncoded, AiError.AiError> => {
  const person = messages.findLast(({ role }) => role === 'user')
  const asked = person === undefined ? '' : textOf(person)
  if (asked.includes('[[fail]]'))
    return Stream.fail(
      AiError.make({
        module: 'NativeStylist',
        method: 'streamText',
        reason: new AiError.InvalidRequestError({ description: 'The model is down' }),
      }),
    )
  const results = resultsSince(messages)
  const aboutTaste = tasteAnswer(asked, messages, results)
  if (aboutTaste !== undefined) return aboutTaste
  if (/analy[sz]e|analiz/iu.test(asked))
    return results.some(({ name }) => name === 'wardrobe_analyze')
      ? saying('Mostly tops: a pair of trousers would make more of them.')
      : toolCall('wardrobe_analyze', {})
  const found = results.flatMap(({ name, result }) =>
    name === 'piece_search'
      ? Option.match(decodeFound(result), { onNone: () => [], onSome: ({ pieces }) => pieces })
      : [],
  )
  if (!results.some(({ name }) => name === 'piece_search')) return toolCall('piece_search', {})
  const [first] = found
  if (first === undefined) return saying('Your wardrobe is empty: add a few pieces first.')
  if (!results.some(({ name }) => name === 'pieces_show')) return toolCall('pieces_show', { pieceIds: [first.id] })
  return saying(`Wear your ${first.type} today.`)
}

/** The fake chat model, streaming. */
export const fakeStylistModel = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: () => Effect.die('the chat streams'),
    streamText: (options) => answer(options.prompt.content),
  }),
)
