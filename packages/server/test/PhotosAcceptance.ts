import { expect } from 'bun:test'
import { Schema } from 'effect'
import { idOf } from './GalleryAcceptance.ts'
import { receivedPhoto, waitUntilReady } from './WardrobeAcceptance.ts'
import { type Call, client, seedAccounts, send, signIn } from './Accounts.ts'

/** Test-only acceptance: My Gallery through the public edge. Natively a photo shows one garment, cut out as the photo
 * itself, of a kind nobody told, so it stays unmatched until the person matches it (`test/fakes/Garments.ts`). */

const Photo = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  favourite: Schema.Boolean,
  hasCutout: Schema.Boolean,
  garments: Schema.Array(
    Schema.Struct({ id: Schema.String, match: Schema.String, pieceId: Schema.NullOr(Schema.String) }),
  ),
})
type Photo = typeof Photo.Type
const Photos = Schema.Struct({ photos: Schema.Array(Photo) })

const photoOf = async (response: Response): Promise<Photo> => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Photo)(await response.json())
}

const remaining = async (call: Call) =>
  Schema.decodeUnknownSync(Schema.Struct({ allowance: Schema.Struct({ remaining: Schema.Number }) }))(
    await (await call('/api/captures/tray')).json(),
  ).allowance.remaining

/** The photo once its garments are found. */
const found = async (call: Call, photoId: string): Promise<Photo> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const photo = await photoOf(await call(`/api/photos/${photoId}`))
    if (photo.status !== 'finding') return photo
    await Bun.sleep(250)
  }
  throw new Error(`photo ${photoId} was never found`)
}

/** Adding a photo spends its upload and a credit, once per operation; its garments wait for the person to match them,
 * and the review tray stays empty. */
const verifyAdding = async (origin: string, owner: Call) => {
  const before = await remaining(owner)
  const add = { operationId: 'native-photo-add-1', uploadId: await receivedPhoto(origin, owner) }
  const added = await photoOf(await send(owner, '/api/photos', 'POST', add))
  expect(added.status).toBe('finding')
  expect((await photoOf(await send(owner, '/api/photos', 'POST', add))).id).toBe(added.id)
  const other = { ...add, uploadId: await receivedPhoto(origin, owner) }
  expect((await send(owner, '/api/photos', 'POST', other)).status).toBe(409)
  const ready = await found(owner, added.id)
  expect(ready).toMatchObject({ status: 'ready', favourite: false, garments: [{ match: 'unmatched', pieceId: null }] })
  expect(await remaining(owner)).toBe(before - 1)
  const tray = Schema.decodeUnknownSync(Schema.Struct({ captures: Schema.Array(Schema.Unknown) }))(
    await (await owner('/api/captures/tray')).json(),
  )
  expect(tray.captures).toHaveLength(0)
  return ready
}

/** Matching, favourites, the piece's photos and deletion; another account sees none of it. */
const verifyMatching = async (origin: string, owner: Call, other: Call, photo: Photo) => {
  const [garment] = photo.garments
  if (garment === undefined) throw new Error('no garment')
  const pieceId = await idOf(
    await send(owner, '/api/pieces', 'POST', {
      operationId: 'native-photo-piece-1',
      uploadId: await receivedPhoto(origin, owner),
      type: 'tops',
    }),
  )
  expect(await waitUntilReady(owner, pieceId)).toBe('ready')
  const path = `/api/photos/${photo.id}/garments/${garment.id}`
  const matched = await photoOf(await send(owner, path, 'PUT', { pieceId }))
  expect(matched.garments[0]).toMatchObject({ match: 'confirmed', pieceId })
  const strangerPiece = `pc_${'s'.repeat(22)}`
  expect((await send(owner, path, 'PUT', { pieceId: strangerPiece })).status).toBe(404)
  const inPiece = Schema.decodeUnknownSync(Photos)(await (await owner(`/api/pieces/${pieceId}/photos`)).json())
  expect(inPiece.photos.map(({ id }) => id)).toEqual([photo.id])
  expect((await photoOf(await send(owner, `/api/photos/${photo.id}`, 'PATCH', { favourite: true }))).favourite).toBe(
    true,
  )
  expect((await owner(`/cdn/photos/${photo.id}/thumb`)).status).toBe(200)
  expect((await owner(`/cdn/photos/${photo.id}/garments/${garment.id}`)).status).toBe(200)
  expect((await other(`/api/photos/${photo.id}`)).status).toBe(404)
  expect((await other(`/cdn/photos/${photo.id}/thumb`)).status).toBe(404)
  expect((await send(other, `/api/photos/${photo.id}`, 'DELETE')).status).toBe(404)
  expect((await fetch(`${origin}/cdn/photos/${photo.id}/thumb`)).status).toBe(401)
  expect((await send(owner, `/api/photos/${photo.id}`, 'DELETE')).status).toBe(204)
  expect((await owner(`/api/photos/${photo.id}`)).status).toBe(404)
  expect((await owner(`/cdn/photos/${photo.id}/thumb`)).status).toBe(404)
  const after = Schema.decodeUnknownSync(Photos)(await (await owner(`/api/pieces/${pieceId}/photos`)).json())
  expect(after.photos).toHaveLength(0)
}

const TrayCaptures = Schema.Struct({
  captures: Schema.Array(
    Schema.Struct({ id: Schema.String, detections: Schema.Array(Schema.Struct({ id: Schema.String })) }),
  ),
})

/** A garment the wardrobe lacks goes to the review tray once, free; keeping it there confirms the new piece in the
 * photo. */
const verifyOffering = async (origin: string, owner: Call) => {
  const add = { operationId: 'native-photo-add-2', uploadId: await receivedPhoto(origin, owner) }
  const photo = await found(owner, (await photoOf(await send(owner, '/api/photos', 'POST', add))).id)
  const [garment] = photo.garments
  if (garment === undefined) throw new Error('no garment')
  const before = await remaining(owner)
  const path = `/api/photos/${photo.id}/garments/${garment.id}/offer`
  expect((await photoOf(await send(owner, path, 'POST'))).garments[0]?.match).toBe('offered')
  expect((await photoOf(await send(owner, path, 'POST'))).garments[0]?.match).toBe('offered')
  expect(await remaining(owner)).toBe(before)
  const wear = { operationId: 'native-photo-look-1', name: 'Outfit from Saturday' }
  expect((await send(owner, `/api/photos/${photo.id}/look`, 'POST', wear)).status).toBe(409)
  const tray = Schema.decodeUnknownSync(TrayCaptures)(await (await owner('/api/captures/tray')).json())
  expect(tray.captures).toHaveLength(1)
  const detectionId = tray.captures[0]?.detections[0]?.id ?? ''
  const reviewed = await send(owner, '/api/captures/review', 'POST', {
    operationId: 'native-photo-review-1',
    keep: [{ detectionId, type: 'shirts' }],
    discard: [],
  })
  expect(reviewed.status).toBe(200)
  const { pieceIds } = Schema.decodeUnknownSync(Schema.Struct({ pieceIds: Schema.Array(Schema.String) }))(
    await reviewed.json(),
  )
  const linked = await photoOf(await owner(`/api/photos/${photo.id}`))
  expect(linked.garments[0]).toMatchObject({ match: 'confirmed', pieceId: pieceIds[0] })
  // Wear it again: the photo's pieces as a look, once, remembered on the photo.
  const Saved = Schema.Struct({ id: Schema.String, pieces: Schema.Array(Schema.Struct({ id: Schema.String })) })
  const look = Schema.decodeUnknownSync(Saved)(
    await (await send(owner, `/api/photos/${photo.id}/look`, 'POST', wear)).json(),
  )
  expect(look.pieces.map(({ id }) => id)).toEqual([...pieceIds])
  const again = Schema.decodeUnknownSync(Saved)(
    await (await send(owner, `/api/photos/${photo.id}/look`, 'POST', wear)).json(),
  )
  expect(again.id).toBe(look.id)
  const remembered = Schema.decodeUnknownSync(Schema.Struct({ lookId: Schema.NullOr(Schema.String) }))(
    await (await owner(`/api/photos/${photo.id}`)).json(),
  )
  expect(remembered.lookId).toBe(look.id)
  // The person cut out for collages, once: cutting again answers the same photo.
  const cutOut = await photoOf(await send(owner, `/api/photos/${photo.id}/cutout`, 'POST'))
  expect(cutOut).toMatchObject({ hasCutout: true })
  expect((await photoOf(await send(owner, `/api/photos/${photo.id}/cutout`, 'POST'))).id).toBe(photo.id)
  await verifyOnBoard(origin, owner, photo.id)
}

const BoardPins = Schema.Struct({
  pins: Schema.Array(Schema.Struct({ _tag: Schema.String, imageId: Schema.optionalKey(Schema.String) })),
  items: Schema.Array(Schema.Struct({ _tag: Schema.String })),
})

/** The public board once a visitor can read it. */
const publicBoard = async (origin: string, boardId: string) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${origin}/api/public/boards/${boardId}`)
    if (response.ok) return Schema.decodeUnknownSync(BoardPins)(await response.json())
    await Bun.sleep(250)
  }
  throw new Error('The board never became public')
}

/** Add to board: the photo and the look worn from it go on the person's own board, once; a visitor to the public
 * board sees neither the photo's pin nor its picture. */
const verifyOnBoard = async (origin: string, owner: Call, photoId: string) => {
  await send(owner, '/api/profile', 'PATCH', { handle: 'native.photos', name: 'Native Photos', tone: 'clay' })
  expect((await send(owner, '/api/profile/published', 'PUT', { published: true })).status).toBe(200)
  const board = await send(owner, '/api/boards', 'POST', { operationId: 'native-photo-board-1', name: 'Saturday' })
  const { id: boardId } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await board.json())
  const toBoard = { operationId: 'native-photo-to-board-1', boardId }
  expect((await send(owner, `/api/photos/${photoId}/board`, 'POST', toBoard)).status).toBe(204)
  expect((await send(owner, `/api/photos/${photoId}/board`, 'POST', toBoard)).status).toBe(204)
  const own = Schema.decodeUnknownSync(BoardPins)(await (await owner(`/api/boards/${boardId}`)).json())
  const pictures = own.pins.filter(({ _tag }) => _tag === 'PicturePin')
  expect(pictures).toHaveLength(1)
  expect(own.pins.some(({ _tag }) => _tag === 'LookPin')).toBe(true)
  const visibility = await send(owner, `/api/boards/${boardId}/visibility`, 'PUT', { visibility: 'public' })
  expect(visibility.status).toBe(200)
  const seen = await publicBoard(origin, boardId)
  expect(seen.pins.map(({ _tag }) => _tag)).not.toContain('PublicPicturePin')
  expect(seen.items.map(({ _tag }) => _tag)).not.toContain('ImageItem')
  expect((await fetch(`${origin}/cdn/public/pictures/${pictures[0]?.imageId ?? ''}/thumb`)).status).toBe(404)
}

/** My Gallery for the website. */
export const verifyPhotos = async (origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, 'native-photos', 'native-photos-other')
  const owner = client(origin, await signIn(origin, 'native-photos'))
  const other = client(origin, await signIn(origin, 'native-photos-other'))
  expect((await fetch(`${origin}/api/photos`)).status).toBe(401)
  const photo = await verifyAdding(origin, owner)
  const listed = Schema.decodeUnknownSync(Photos)(await (await owner('/api/photos')).json())
  expect(listed.photos.map(({ id }) => id)).toEqual([photo.id])
  await verifyMatching(origin, owner, other, photo)
  await verifyOffering(origin, owner)
}
