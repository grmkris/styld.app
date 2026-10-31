import { expect } from 'bun:test'
import * as Output from 'alchemy/Output'
import { Redacted, Schema } from 'effect'
import { Allowance, decoded } from './CleanPictureAcceptance.ts'
import { picturesAccount } from './PictureFixture.ts'
import { scanAccount } from './ScanFixture.ts'
import { client, signIn } from './WardrobeAcceptance.ts'

/** The API Worker's settings for Styld on the native stack: the model is the fixture's stand-in gateway. */
export const stylistEnvironment = (fixtures: Output.Output<string | undefined>) => ({
  STYLIST: 'gateway',
  STYLIST_GATEWAY_BASE: Output.interpolate`${fixtures}/test/stylist/v1`,
  STYLIST_GATEWAY_API_KEY: Redacted.make('native-test-gateway-key'),
})

const Part = Schema.Struct({ _tag: Schema.String, pieceIds: Schema.optionalKey(Schema.Array(Schema.String)) })
const Chat = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  messages: Schema.Array(Schema.Struct({ role: Schema.String, text: Schema.String, parts: Schema.Array(Part) })),
  replying: Schema.optionalKey(Schema.Struct({ state: Schema.String })),
})
const Sent = Schema.Struct({ chatId: Schema.String })
const Chats = Schema.Struct({ chats: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })) })
const Pieces = Schema.Struct({ pieces: Schema.Array(Schema.Struct({ id: Schema.String })) })

/** Styld answers a message about the person's own wardrobe: the reply is written on the queue by the real turn, its
 * tools the assistants' own, with the stand-in model; the chat lives in the account's Durable Object. A message costs
 * one credit, once however often it is sent, and comes back when no reply comes. Nobody else reads the chat. Runs
 * after `verifyScan`, on the scan account and its pieces. */
export const verifyStylist = async (origin: string) => {
  const owner = client(origin, await signIn(origin, scanAccount))
  const remaining = async () => (await decoded(Allowance, await owner('/api/captures/tray'))).allowance.remaining
  const ownPieces = new Set((await decoded(Pieces, await owner('/api/pieces'))).pieces.map(({ id }) => id))
  const before = await remaining()
  const send = (operationId: string, text: string, chatId?: string) =>
    owner('/api/stylist/messages', {
      method: 'POST',
      body: JSON.stringify({ operationId, text, locale: 'en', ...(chatId === undefined ? {} : { chatId }) }),
    })
  const { chatId } = await decoded(Sent, await send('native-stylist-0001', 'What should I wear today?'))
  // The same request again is the same message.
  expect(await decoded(Sent, await send('native-stylist-0001', 'What should I wear today?'))).toEqual({ chatId })
  const read = async () => decoded(Chat, await owner(`/api/stylist/chats/${chatId}`))
  const settled = async (done: (chat: typeof Chat.Type) => boolean) => {
    let chat = await read()
    for (let attempt = 0; attempt < 160 && !done(chat); attempt += 1) {
      await Bun.sleep(250)
      chat = await read()
    }
    return chat
  }
  const answered = await settled((chat) => chat.messages.length >= 2)
  expect(answered.title).toBe('What should I wear today?')
  expect(answered.messages.map(({ role }) => role)).toEqual(['person', 'styld'])
  const [, reply] = answered.messages
  expect(reply?.text).toMatch(/^Wear your \w+ today\.\n\nHave a good day\.$/)
  const shown = reply?.parts.flatMap(({ pieceIds }) => pieceIds ?? []) ?? []
  expect(shown).toHaveLength(1)
  expect(ownPieces.has(shown[0] ?? '')).toBe(true)
  expect(await remaining()).toBe(before - 1)
  const listed = await decoded(Chats, await owner('/api/stylist/chats'))
  expect(listed.chats[0]).toEqual({ id: chatId, title: 'What should I wear today?' })

  // A model that does not answer: after the queue's attempts the reply shows as failed and the credit comes back.
  await decoded(Sent, await send('native-stylist-0002', 'And tomorrow? [[fail]]', chatId))
  const failed = await settled((chat) => chat.replying?.state === 'failed')
  expect(failed.replying?.state).toBe('failed')
  expect(await remaining()).toBe(before - 1)

  // Someone else's chat is not there for them.
  const other = client(origin, await signIn(origin, picturesAccount))
  expect((await other(`/api/stylist/chats/${chatId}`)).status).toBe(404)
  expect((await decoded(Chats, await other('/api/stylist/chats'))).chats).toEqual([])
}
