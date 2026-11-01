import { Option, Schema } from 'effect'
import type { WorkersAi } from '../../src/ai/LanguageModel.ts'
import type { ClefRequest, RunClef } from '../../src/capture/Clef.ts'

// Workers AI as the native suite answers it: the local stack cannot reach Workers AI. Clef's questions go to the
// fixture Worker, which answers from what each test stored there and records the prompts; the text model Styld
// answers with is played in process, by where the reply is.

/** Clef asked over HTTP, at the fixture Worker's stand-in. */
export const clefAt =
  (url: string): RunClef =>
  async (request: ClefRequest) => {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) throw new Error(`Clef stand-in answered ${response.status}`)
    return response.json()
  }

const Message = Schema.Struct({ role: Schema.String, content: Schema.optionalKey(Schema.NullOr(Schema.String)) })
const Request = Schema.Struct({ messages: Schema.Array(Message) })
const Found = Schema.fromJsonString(
  Schema.Struct({ pieces: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String })) }),
)

const call = (name: string, args: object) => ({
  id: `call_${name}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
})

const completion = (content: string, toolCalls: ReadonlyArray<object> = []) => ({
  id: 'fake',
  created: 0,
  choices: [
    {
      message: { role: 'assistant', content, tool_calls: toolCalls },
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
})

/** The next answer, by the messages since the person's last one: first it searches the wardrobe, then it suggests the
 * first piece it found and shows it, which ends the reply. */
const answer = (messages: (typeof Request.Type)['messages']) => {
  const since = messages.slice(messages.findLastIndex(({ role }) => role === 'user') + 1)
  const searched = since.find(({ role, content }) => role === 'tool' && (content ?? '').includes('"pieces"'))
  if (searched === undefined) return completion('', [call('piece_search', {})])
  const [first] = Option.match(Schema.decodeUnknownOption(Found)(searched.content ?? ''), {
    onNone: () => [],
    onSome: ({ pieces }) => pieces,
  })
  return first === undefined
    ? completion('Your wardrobe is empty: add a few pieces first.')
    : completion(`Wear your ${first.type} today.`, [call('pieces_show', { pieceIds: [first.id] })])
}

/** The chat model: a message with `[[fail]]` is refused, as a model that is down would be. */
export const fakeChat: WorkersAi['Service']['run'] = async (_model, input) => {
  const request = Schema.decodeUnknownOption(Request)(input)
  if (Option.isNone(request)) throw new Error('Not a chat completion')
  const person = request.value.messages.findLast(({ role }) => role === 'user')
  if ((person?.content ?? '').includes('[[fail]]')) throw new Error('The model is down')
  return answer(request.value.messages)
}
