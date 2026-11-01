import { expect } from 'bun:test'
import { Predicate, Schema } from 'effect'
import { addedPiece, idOf } from './GalleryAcceptance.ts'
import { type Call, client, seedAccounts, send, signIn } from './Accounts.ts'

/** Test-only acceptance: stickers and mood boards Styld makes for a board, through the public edge, with the stand-in
 * painter and planner (`[[refuse]]`, `[[lost]]` and `[[unclear]]` in the words) and the stand-in judge (`[[fail]]`). */

const Generation = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  reason: Schema.NullOr(Schema.String),
  pictures: Schema.Array(
    Schema.Struct({ index: Schema.Number, status: Schema.String, imageId: Schema.NullOr(Schema.String) }),
  ),
})
type Generation = typeof Generation.Type

const generationOf = async (response: Response) => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Generation)(await response.json())
}

/** The generation once the queue took it as far as it goes. */
const finished = async (owner: Call, id: string): Promise<Generation> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const generation = await generationOf(await owner(`/api/generations/${id}`))
    if (['done', 'refused', 'failed'].includes(generation.status)) return generation
    await Bun.sleep(250)
  }
  throw new Error(`generation ${id} did not finish`)
}

const Board = Schema.Struct({
  version: Schema.Number,
  items: Schema.Array(Schema.Struct({ _tag: Schema.String })),
  pins: Schema.Array(Schema.Struct({ _tag: Schema.String, generated: Schema.optionalKey(Schema.Boolean) })),
})
const boardOf = async (owner: Call, boardId: string) =>
  Schema.decodeUnknownSync(Board)(await (await owner(`/api/boards/${boardId}`)).json())

/** One sticker from words, pinned and marked Generated; the same operation answers the same job. A refusal, a lost
 * answer and words that fail the check make no sticker. */
const verifyPictures = async (owner: Call, other: Call, boardId: string) => {
  const ask = { operationId: 'native-generate-0001', prompt: 'a rainy street at dusk' }
  const asked = await generationOf(await send(owner, `/api/boards/${boardId}/stickers`, 'POST', ask))
  expect(asked).toMatchObject({ status: 'drawing', pictures: [{ index: 0, status: 'waiting' }] })
  expect((await generationOf(await send(owner, `/api/boards/${boardId}/stickers`, 'POST', ask))).id).toBe(asked.id)
  expect(
    (await send(owner, `/api/boards/${boardId}/stickers`, 'POST', { ...ask, prompt: 'something else' })).status,
  ).toBe(409)
  const done = await finished(owner, asked.id)
  expect(done).toMatchObject({ status: 'done', pictures: [{ status: 'drawn' }] })
  const board = await boardOf(owner, boardId)
  expect(board.pins.some((pin) => pin.generated === true && Predicate.isTagged(pin, 'PicturePin'))).toBe(true)
  expect((await other(`/api/generations/${asked.id}`)).status).toBe(404)

  const refused = await generationOf(
    await send(owner, `/api/boards/${boardId}/stickers`, 'POST', {
      operationId: 'native-generate-0002',
      prompt: 'a scene [[refuse]]',
    }),
  )
  expect(await finished(owner, refused.id)).toMatchObject({
    status: 'refused',
    reason: 'refused',
    pictures: [{ status: 'refused', imageId: null }],
  })
  const lost = await generationOf(
    await send(owner, `/api/boards/${boardId}/stickers`, 'POST', {
      operationId: 'native-generate-0003',
      prompt: 'a scene [[lost]]',
    }),
  )
  expect(await finished(owner, lost.id)).toMatchObject({ status: 'refused', pictures: [{ status: 'unknown' }] })
  const failing = await send(owner, `/api/boards/${boardId}/stickers`, 'POST', {
    operationId: 'native-generate-0004',
    prompt: 'words that [[fail]]',
  })
  expect(failing.status).toBe(422)
  expect(await failing.json()).toMatchObject({ _tag: 'PromptRefused' })
}

/** The board's ask still being made, as a board opened again reads it. */
const running = async (call: Call, boardId: string) =>
  Schema.decodeUnknownSync(Schema.Struct({ generation: Schema.NullOr(Generation) }))(
    await (await call(`/api/boards/${boardId}/generations/running`)).json(),
  ).generation

/** Words the wardrobe holds too little for give the credit back; a mood board pins the person's own pieces and lays
 * the collage out with them, drawing nothing. While it is made, its board says so to its owner and to no one else. */
const verifyMoodBoard = async (owner: Call, stranger: Call, boardId: string, pieceIds: ReadonlyArray<string>) => {
  const unclear = await generationOf(
    await send(owner, `/api/boards/${boardId}/mood`, 'POST', {
      operationId: 'native-mood-0002',
      prompt: 'nothing in particular [[unclear]]',
    }),
  )
  expect(await finished(owner, unclear.id)).toMatchObject({ status: 'refused', reason: 'unclear', pictures: [] })
  const before = await boardOf(owner, boardId)
  const generated = (board: typeof before) => board.pins.filter((pin) => pin.generated === true).length
  const asked = await generationOf(
    await send(owner, `/api/boards/${boardId}/mood`, 'POST', {
      operationId: 'native-mood-0001',
      prompt: 'a slow weekend by the sea',
    }),
  )
  expect(asked.status).toBe('planning')
  // The queue waits for a batch before it plans, so the ask is still being made here.
  expect((await running(owner, boardId))?.id).toBe(asked.id)
  expect(await running(stranger, boardId)).toBeNull()
  const done = await finished(owner, asked.id)
  expect(done).toMatchObject({ status: 'done', pictures: [] })
  expect(await running(owner, boardId)).toBeNull()
  const board = await boardOf(owner, boardId)
  expect(generated(board)).toBe(generated(before))
  expect(board.pins.filter((pin) => Predicate.isTagged(pin, 'PiecePin')).length).toBe(pieceIds.length)
  expect(board.version).toBe(before.version + 1)
  expect(board.items.filter((item) => Predicate.isTagged(item, 'PieceItem')).length).toBe(pieceIds.length)
  expect(board.items.filter((item) => Predicate.isTagged(item, 'ImageItem')).length).toBe(0)
}

/** Stickers and mood boards for a board. */
export const verifyGeneration = async (origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, 'native-generation', 'native-generation-other')
  const owner = client(origin, await signIn(origin, 'native-generation'))
  const other = client(origin, await signIn(origin, 'native-generation-other'))
  expect((await fetch(`${origin}/api/generations/gj_${'x'.repeat(22)}`)).status).toBe(401)
  const boardOfOwner = await idOf(
    await send(owner, '/api/boards', 'POST', { operationId: 'native-generation-board', name: 'Rain' }),
  )
  await verifyPictures(owner, other, boardOfOwner)
  // Six asks a minute at most: the mood boards are the second account's.
  const pieceIds = [
    await addedPiece(origin, other, 'native-generation-piece-1'),
    await addedPiece(origin, other, 'native-generation-piece-2'),
  ]
  const boardOfOther = await idOf(
    await send(other, '/api/boards', 'POST', { operationId: 'native-generation-board', name: 'Sea' }),
  )
  await verifyMoodBoard(other, owner, boardOfOther, pieceIds)
}
