import { expect } from 'bun:test'
import { Predicate, Schema } from 'effect'
import { type Call, client, seedAccounts, send, signIn } from './Accounts.ts'
import { Allowance, decoded, museTee } from './CleanPictureAcceptance.ts'
import { addedPiece, idOf } from './GalleryAcceptance.ts'
import { receivedPhoto, waitUntilReady } from './WardrobeAcceptance.ts'

/** Test-only acceptance: try-on through the public edge (owner, 4 November 2026), the person's own My Gallery photo
 * and pieces drawn by Muse's stand-in, for two credits, private to its owner. */

const TryOn = Schema.Struct({
  id: Schema.String,
  photoId: Schema.String,
  pieceIds: Schema.Array(Schema.String),
  status: Schema.String,
  images: Schema.optionalKey(Schema.Struct({ thumb: Schema.String, full: Schema.String })),
})
type TryOn = typeof TryOn.Type
const TryOns = Schema.Struct({ tryOns: Schema.Array(TryOn) })
const Prompts = Schema.Struct({ prompts: Schema.Array(Schema.String) })
const Pins = Schema.Struct({
  pins: Schema.Array(Schema.Struct({ _tag: Schema.String, generated: Schema.optionalKey(Schema.Boolean) })),
})

/** The picture putting a try-on on a board answers. */
const Picture = Schema.Struct({ imageId: Schema.String })

const tryOnOf = async (response: Response) => decoded(TryOn, response)
const remaining = async (call: Call) => (await decoded(Allowance, await call('/api/captures/tray'))).allowance.remaining

/** The try-on once the queue took it as far as it goes. */
const finished = async (owner: Call, id: string): Promise<TryOn> => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const tryOn = await tryOnOf(await owner(`/api/try-ons/${id}`))
    if (['done', 'refused', 'failed'].includes(tryOn.status)) return tryOn
    await Bun.sleep(250)
  }
  throw new Error(`try-on ${id} did not finish`)
}

/** A My Gallery photo of the account's: its id. */
const addedPhoto = async (origin: string, call: Call, operationId: string) =>
  idOf(await send(call, '/api/photos', 'POST', { operationId, uploadId: await receivedPhoto(origin, call) }))

/** A try-on needs the person's word that the photo shows them, and only their own photo and pieces; one asked for
 * twice under its id is one try-on. */
const verifyStarting = async (owner: Call, other: Call, photoId: string, pieceIds: ReadonlyArray<string>) => {
  const ask = { operationId: 'native-try-on-0001', photoId, pieceIds }
  expect((await send(owner, '/api/try-ons', 'POST', ask)).status).toBe(400)
  expect((await send(owner, '/api/try-ons', 'POST', { ...ask, thisIsMe: false })).status).toBe(400)
  expect((await send(other, '/api/try-ons', 'POST', { ...ask, thisIsMe: true })).status).toBe(404)
  const before = await remaining(owner)
  const started = await tryOnOf(await send(owner, '/api/try-ons', 'POST', { ...ask, thisIsMe: true }))
  expect(started).toMatchObject({ status: 'drawing', photoId, pieceIds })
  expect((await tryOnOf(await send(owner, '/api/try-ons', 'POST', { ...ask, thisIsMe: true }))).id).toBe(started.id)
  expect(
    (await send(owner, '/api/try-ons', 'POST', { ...ask, pieceIds: pieceIds.slice(1), thisIsMe: true })).status,
  ).toBe(409)
  expect(await remaining(owner)).toBe(before - 2)
  expect((await other(`/api/try-ons/${started.id}`)).status).toBe(404)
  return started
}

/** Try on, from the person's own photo and pieces to the drawn result at its owner's address, on a board and gone. */
export const verifyTryOn = async (origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, 'native-try-on', 'native-try-on-other')
  const owner = client(origin, await signIn(origin, 'native-try-on'))
  const other = client(origin, await signIn(origin, 'native-try-on-other'))
  expect((await fetch(`${origin}/api/try-ons`)).status).toBe(401)
  expect((await fetch(`${fixtures}/test/pictures/answer?key=green`, { method: 'PUT', body: museTee() })).status).toBe(
    204,
  )
  const photoId = await addedPhoto(origin, owner, 'native-try-on-photo')
  const pieceIds = [
    await addedPiece(origin, owner, 'native-try-on-piece-1'),
    await addedPiece(origin, owner, 'native-try-on-piece-2'),
  ]
  for (const pieceId of pieceIds) expect(await waitUntilReady(owner, pieceId)).toBe('ready')
  const earlier = (await decoded(Prompts, await fetch(`${fixtures}/test/pictures/prompts`))).prompts.length

  const started = await verifyStarting(owner, other, photoId, pieceIds)
  const done = await finished(owner, started.id)
  expect(done.status).toBe('done')
  const sent = (await decoded(Prompts, await fetch(`${fixtures}/test/pictures/prompts`))).prompts.slice(earlier)
  expect(sent.filter((prompt) => prompt.includes('virtual try-on')).length).toBe(1)
  const full = done.images?.full ?? ''
  expect((await fetch(new URL(full, origin))).status).toBe(200)
  expect((await decoded(TryOns, await owner('/api/try-ons'))).tryOns.map(({ id }) => id)).toEqual([started.id])
  expect((await decoded(TryOns, await other('/api/try-ons'))).tryOns).toEqual([])

  const boardId = await idOf(
    await send(owner, '/api/boards', 'POST', { operationId: 'native-try-on-board', name: 'Me' }),
  )
  const toBoard = { operationId: 'native-try-on-to-board', boardId }
  const onBoard = await decoded(Picture, await send(owner, `/api/try-ons/${started.id}/board`, 'POST', toBoard))
  const sameAgain = { operationId: 'native-try-on-to-board-2', boardId }
  const repeated = await decoded(Picture, await send(owner, `/api/try-ons/${started.id}/board`, 'POST', sameAgain))
  expect(repeated.imageId).toBe(onBoard.imageId)
  expect((await send(other, `/api/try-ons/${started.id}/board`, 'POST', toBoard)).status).toBe(404)
  const { pins } = await decoded(Pins, await owner(`/api/boards/${boardId}`))
  expect(pins.filter((pin) => Predicate.isTagged(pin, 'PicturePin')).length).toBe(1)

  const removal = { operationId: 'native-try-on-delete' }
  expect((await send(other, `/api/try-ons/${started.id}`, 'DELETE', removal)).status).toBe(404)
  expect((await send(owner, `/api/try-ons/${started.id}`, 'DELETE', removal)).status).toBe(204)
  expect((await send(owner, `/api/try-ons/${started.id}`, 'DELETE', removal)).status).toBe(204)
  expect((await owner(`/api/try-ons/${started.id}`)).status).toBe(404)
  expect((await fetch(new URL(full, origin))).status).not.toBe(200)
}
