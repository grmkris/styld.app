import { Effect, Layer, Option, Schema } from 'effect'
import { HttpServerRequest } from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { workersAiFetch } from '../src/stylist/WorkersAiFetch.ts'

// Test-only: a stand-in for the stylist's model behind an OpenAI-compatible gateway. It answers by where the reply
// is, not from recordings (those are unit-tested in Stylist.test.ts): first it searches the wardrobe, then it
// suggests the first piece it found and shows it, then it signs off. A message with `[[fail]]` is refused, as a model
// that is down would be. Its answers go out as the gateway streams them, through the same adapter Workers AI uses.

const Message = Schema.Struct({
  role: Schema.String,
  content: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tool_calls: Schema.optionalKey(Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) }))),
})
const Request = Schema.Struct({ messages: Schema.Array(Message) })
const Found = Schema.fromJsonString(
  Schema.Struct({ pieces: Schema.Array(Schema.Struct({ id: Schema.String, category: Schema.String })) }),
)

const call = (name: string, args: object) => ({
  id: `call_${name}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

const completion = (content: string, toolCalls: ReadonlyArray<object> = []) => ({
  id: 'stand-in',
  created: 0,
  choices: [
    {
      message: { role: 'assistant', content, tool_calls: toolCalls },
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
})

/** The next answer, by the messages so far: since the person's last message, no tool yet, a search, or a show. */
const answer = (messages: (typeof Request.Type)['messages']) => {
  const lastPerson = messages.findLastIndex(({ role }) => role === 'user')
  const since = messages.slice(lastPerson + 1)
  const searched = since.find(({ role, content }) => role === 'tool' && (content ?? '').includes('"pieces"'))
  const shown = since.some(({ tool_calls }) => tool_calls?.some(({ function: { name } }) => name === 'pieces_show'))
  if (shown) return completion('Have a good day.')
  if (searched === undefined) return completion('', [call('piece_search', {})])
  const [first] = Schema.decodeUnknownOption(Found)(searched.content ?? '').pipe(
    Option.match({
      onNone: () => [],
      onSome: ({ pieces }) => pieces,
    }),
  )
  return first === undefined
    ? completion('Your wardrobe is empty: add a few pieces first.')
    : completion(`Wear your ${first.category} today.`, [call('pieces_show', { pieceIds: [first.id] })])
}

const chatCompletions = Effect.gen(function* () {
  const request = yield* HttpServerRequest
  const text = yield* request.text
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Request))(text)
  if (Option.isNone(decoded)) return HttpServerResponse.empty({ status: 400 })
  const person = decoded.value.messages.findLast(({ role }) => role === 'user')
  if ((person?.content ?? '').includes('[[fail]]')) return HttpServerResponse.empty({ status: 503 })
  const reply = answer(decoded.value.messages)
  const streamed = yield* Effect.promise(() =>
    workersAiFetch(() => Promise.resolve(reply))('stand-in', { method: 'POST', body: text }),
  )
  return HttpServerResponse.text(yield* Effect.promise(() => streamed.text()), { contentType: 'text/event-stream' })
}).pipe(Effect.orDie)

export const stylistRoutes = Layer.mergeAll(
  HttpRouter.add('POST', '/test/stylist/v1/chat/completions', chatCompletions),
)
