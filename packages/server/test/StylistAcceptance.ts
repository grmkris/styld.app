import { expect } from 'bun:test'
import { Predicate, Schema } from 'effect'
import { Allowance, decoded } from './CleanPictureAcceptance.ts'
import { addedPiece } from './GalleryAcceptance.ts'
import { client, seedAccounts, signIn } from './Accounts.ts'
import { waitUntilReady } from './WardrobeAcceptance.ts'

const Part = Schema.Struct({
  _tag: Schema.String,
  pieceIds: Schema.optionalKey(Schema.Array(Schema.String)),
  analysis: Schema.optionalKey(Schema.Struct({ pieces: Schema.Number })),
})
const Chat = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  thread: Schema.String,
  messages: Schema.Array(Schema.Struct({ role: Schema.String, text: Schema.String, parts: Schema.Array(Part) })),
  replying: Schema.optionalKey(Schema.Struct({ state: Schema.String })),
})
const Sent = Schema.Struct({ chatId: Schema.String })
const Chats = Schema.Struct({ chats: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })) })
const Taste = Schema.Struct({ notes: Schema.Array(Schema.Struct({ text: Schema.String })) })
const Pieces = Schema.Struct({ pieces: Schema.Array(Schema.Struct({ id: Schema.String })) })

/** One LiveText frame, as far as the test reads it. */
const Frame = Schema.Struct({
  _tag: Schema.String,
  event: Schema.optionalKey(
    Schema.Struct({
      _tag: Schema.String,
      threadId: Schema.String,
      part: Schema.optionalKey(Schema.Struct({ type: Schema.String, delta: Schema.optionalKey(Schema.String) })),
    }),
  ),
})
const decodeFrame = Schema.decodeUnknownSync(Schema.fromJsonString(Frame))

/** Read a chat's live words until `stop` aborts: each frame with when it arrived. */
const watch = (response: Response) => {
  const frames: Array<{ readonly frame: typeof Frame.Type; readonly at: number }> = []
  const body = response.body
  const reading = (async () => {
    if (body === null) return
    const reader = body.pipeThrough(new TextDecoderStream()).getReader()
    let pending = ''
    for (;;) {
      const { done, value } = await reader
        .read()
        .catch((): ReadableStreamReadResult<string> => ({ done: true, value: undefined }))
      if (done || value === undefined) return
      pending += value
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines.filter((each) => each.trim().length > 0))
        frames.push({ frame: decodeFrame(line), at: Date.now() })
    }
  })()
  return { frames, reading }
}

/** Styld remembers what the person said yes to (owner, 4 November 2026): note_add keeps it for the account, the Account
 * page's read lists it, and a new chat is told it. Two messages, a credit each. */
const verifyRemembers = async (
  send: (operationId: string, text: string) => Promise<Response>,
  until: (chatId: string, done: (chat: typeof Chat.Type) => boolean) => Promise<typeof Chat.Type>,
  owner: (path: string) => Promise<Response>,
) => {
  const kept = await decoded(Sent, await send('native-stylist-0004', 'Yes, remember: Never heels'))
  const keeping = await until(kept.chatId, (chat) => chat.messages.length >= 2)
  expect(keeping.messages[1]?.text).toBe('I will remember that.')
  const taste = await decoded(Taste, await owner('/api/me/taste'))
  expect(taste.notes.map(({ text }) => text)).toEqual(['Never heels'])
  const asked = await decoded(Sent, await send('native-stylist-0005', 'What do you remember?'))
  const answer = await until(asked.chatId, (chat) => chat.messages.length >= 2)
  expect(answer.messages[1]?.text).toBe('You told me: "Never heels"')
}

/** Someone else's chat is not there for another account, nor its live words, nor does it take their message. */
const verifyPrivate = async (origin: string, chatId: string) => {
  const other = client(origin, await signIn(origin, 'native-stylist-other'))
  expect((await other(`/api/stylist/chats/${chatId}`)).status).toBe(404)
  expect((await other(`/api/stylist/chats/${chatId}/live`)).status).toBe(404)
  expect((await decoded(Chats, await other('/api/stylist/chats'))).chats).toEqual([])
  // A chat they name that is not theirs takes no message, and no credit.
  expect(
    (
      await other('/api/stylist/messages', {
        method: 'POST',
        body: JSON.stringify({ operationId: 'native-stylist-0004', text: 'Hi', locale: 'en', chatId }),
      })
    ).status,
  ).toBe(404)
}

/** Styld answers a message about the person's own wardrobe in the chat's Thread (Yielded Agent), its tools the
 * assistants' own run by the API Worker, with the streaming fake model: the words arrive live before the reply is in
 * the chat, the reply's card comes from the recorded tool result, a message costs one credit once however often it is
 * sent, and the credit comes back when no reply comes. Nobody else reads the chat or its live words. */
export const verifyStylist = async (origin: string, fixtures: string) => {
  await seedAccounts(fixtures, 'native-stylist', 'native-stylist-other')
  const owner = client(origin, await signIn(origin, 'native-stylist'))
  await waitUntilReady(owner, await addedPiece(origin, owner, 'native-stylist-piece'))
  const remaining = async () => (await decoded(Allowance, await owner('/api/captures/tray'))).allowance.remaining
  const ownPieces = new Set((await decoded(Pieces, await owner('/api/pieces'))).pieces.map(({ id }) => id))
  const before = await remaining()
  const send = (operationId: string, text: string, chatId?: string) =>
    owner('/api/stylist/messages', {
      method: 'POST',
      body: JSON.stringify({ operationId, text, locale: 'en', ...(chatId === undefined ? {} : { chatId }) }),
    })
  const read = async (chatId: string) => decoded(Chat, await owner(`/api/stylist/chats/${chatId}`))
  const until = async (chatId: string, done: (chat: typeof Chat.Type) => boolean) => {
    let chat = await read(chatId)
    for (let attempt = 0; attempt < 240 && !done(chat); attempt += 1) {
      await Bun.sleep(100)
      chat = await read(chatId)
    }
    return chat
  }
  const credits = async (expected: number) => {
    let left = await remaining()
    for (let attempt = 0; attempt < 100 && left !== expected; attempt += 1) {
      await Bun.sleep(100)
      left = await remaining()
    }
    return left
  }

  const { chatId } = await decoded(Sent, await send('native-stylist-0001', 'What should I wear today?'))
  const stop = new AbortController()
  const live = await owner(`/api/stylist/chats/${chatId}/live`, { signal: stop.signal })
  expect(live.status).toBe(200)
  expect(live.headers.get('content-type')).toContain('application/x-ndjson')
  const watching = watch(live)
  // The same request again is the same message.
  expect(await decoded(Sent, await send('native-stylist-0001', 'What should I wear today?'))).toEqual({ chatId })
  const answered = await until(chatId, (chat) => chat.messages.length >= 2)
  const answeredAt = Date.now()
  stop.abort()
  await watching.reading
  expect(answered.title).toBe('What should I wear today?')
  expect(answered.thread.endsWith(`--${chatId}`)).toBe(true)
  expect(answered.messages.map(({ role }) => role)).toEqual(['person', 'styld'])
  const [, reply] = answered.messages
  expect(reply?.text).toMatch(/^Wear your \w+ today\.$/)
  // The words arrived live, a few at a time, before the reply was in the chat.
  const deltas = watching.frames.filter(({ frame }) => frame.event?.part?.type === 'text-delta')
  expect(Predicate.isTagged(watching.frames[0]?.frame, 'Reset')).toBe(true)
  expect(deltas.length).toBeGreaterThan(1)
  expect(deltas.map(({ frame }) => frame.event?.part?.delta ?? '').join('')).toBe(reply?.text ?? '')
  expect(deltas[0]?.at ?? Number.POSITIVE_INFINITY).toBeLessThan(answeredAt)
  expect(
    watching.frames.every(({ frame }) => frame.event === undefined || frame.event.threadId === answered.thread),
  ).toBe(true)
  // The piece it showed is a card from the recorded pieces_show result.
  const shown = reply?.parts.flatMap(({ pieceIds }) => pieceIds ?? []) ?? []
  expect(shown).toHaveLength(1)
  expect(ownPieces.has(shown[0] ?? '')).toBe(true)
  expect(await credits(before - 1)).toBe(before - 1)
  const listed = await decoded(Chats, await owner('/api/stylist/chats'))
  expect(listed.chats[0]).toEqual({ id: chatId, title: 'What should I wear today?' })

  // A model that does not answer: the reply shows as failed and its credit comes back, settled once by the Thread.
  await decoded(Sent, await send('native-stylist-0002', 'And tomorrow? [[fail]]', chatId))
  const failed = await until(chatId, (chat) => chat.replying?.state === 'failed')
  expect(failed.replying?.state).toBe('failed')
  expect(failed.messages.map(({ role }) => role)).toEqual(['person', 'styld', 'person'])
  expect(await credits(before - 1)).toBe(before - 1)

  // "Analyze my wardrobe" (T-14): the model asks for the analysis and comments; the card carries the server's count.
  const analysed = await decoded(Sent, await send('native-stylist-0003', 'Analyze my wardrobe'))
  const analysis = await until(analysed.chatId, (chat) => chat.messages.length >= 2)
  const [, comment] = analysis.messages
  expect(comment?.text).toBe('Mostly tops: a pair of trousers would make more of them.')
  expect(comment?.parts.map(({ _tag }) => _tag)).toEqual(['Analysis'])
  expect(comment?.parts[0]?.analysis?.pieces).toBe(ownPieces.size)
  expect(await credits(before - 2)).toBe(before - 2)

  await verifyRemembers(send, until, owner)
  expect(await credits(before - 4)).toBe(before - 4)

  await verifyPrivate(origin, chatId)
}
