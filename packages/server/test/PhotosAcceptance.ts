import { verifySignedImage } from './SignedMediaAcceptance.ts'
import { expect } from 'bun:test'
import { Schema } from 'effect'
import { idOf } from './GalleryAcceptance.ts'
import { receivedPhoto, waitUntilReady } from './WardrobeAcceptance.ts'
import { type Call, client, emailOf, seedAccounts, send, signIn } from './Accounts.ts'
import { nativeOperatorToken, operatorClient } from './OperatorToken.ts'

/** Test-only acceptance: My Gallery through the public edge. Natively a photo shows one garment, cut out as the photo
 * itself, of a kind nobody told, so it stays unmatched until the person matches it (`test/fakes/Garments.ts`). */

const Photo = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  favourite: Schema.Boolean,
  hasCutout: Schema.Boolean,
  images: Schema.Struct({ thumb: Schema.String, full: Schema.String }),
  cutoutImages: Schema.optionalKey(Schema.Struct({ thumb: Schema.String, full: Schema.String })),
  garments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      match: Schema.String,
      pieceId: Schema.NullOr(Schema.String),
      // A piece added by hand has no picture of the photo.
      image: Schema.optionalKey(Schema.String),
    }),
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

/** A piece Styld did not find, added to the photo by hand (Eva, 4 November): confirmed after the garments found, with
 * no picture of the photo, once per operation and once per piece; it counts as in the photo, and comes off again. */
const verifyAddingByHand = async (origin: string, owner: Call, other: Call, photoId: string) => {
  const pieceId = await idOf(
    await send(owner, '/api/pieces', 'POST', {
      operationId: 'native-photo-piece-hand',
      uploadId: await receivedPhoto(origin, owner),
      type: 'jackets',
    }),
  )
  expect(await waitUntilReady(owner, pieceId)).toBe('ready')
  const path = `/api/photos/${photoId}/pieces`
  const add = { operationId: 'native-photo-hand-1', pieceId }
  const added = await photoOf(await send(owner, path, 'POST', add))
  const before = added.garments.length - 1
  const hand = added.garments[before]
  expect(hand).toMatchObject({ match: 'confirmed', pieceId })
  expect(hand?.image).toBeUndefined()
  expect((await photoOf(await send(owner, path, 'POST', add))).garments).toHaveLength(before + 1)
  const again = { operationId: 'native-photo-hand-2', pieceId }
  expect((await photoOf(await send(owner, path, 'POST', again))).garments).toHaveLength(before + 1)
  const stranger = { operationId: 'native-photo-hand-3', pieceId: `pc_${'s'.repeat(22)}` }
  expect((await send(owner, path, 'POST', stranger)).status).toBe(404)
  expect((await send(other, path, 'POST', { operationId: 'native-photo-hand-4', pieceId })).status).toBe(404)
  const inPiece = Schema.decodeUnknownSync(Photos)(await (await owner(`/api/pieces/${pieceId}/photos`)).json())
  expect(inPiece.photos.map(({ id }) => id)).toEqual([photoId])
  const remove = { operationId: 'native-photo-hand-remove', pieceId: null }
  const removed = await photoOf(await send(owner, `/api/photos/${photoId}/garments/${hand?.id ?? ''}`, 'PUT', remove))
  expect(removed.garments).toHaveLength(before)
}

/** Matching, favourites, the piece's photos and deletion; another account sees none of it. */
const verifyMatching = async (origin: string, owner: Call, other: Call, photo: Photo) => {
  const [garment] = photo.garments
  if (garment === undefined) throw new Error('no garment')
  const pieceId = await idOf(
    await send(owner, '/api/pieces', 'POST', {
      operationId: 'native-photo-piece-1',
      uploadId: await receivedPhoto(origin, owner),
      type: 'shortSleeveTops',
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
  await verifyAddingByHand(origin, owner, other, photo.id)
  expect((await photoOf(await send(owner, `/api/photos/${photo.id}`, 'PATCH', { favourite: true }))).favourite).toBe(
    true,
  )
  await verifySignedImage(origin, photo.images.thumb)
  await verifySignedImage(origin, garment.image ?? '')
  expect((await other(`/api/photos/${photo.id}`)).status).toBe(404)
  expect((await send(other, `/api/photos/${photo.id}`, 'DELETE')).status).toBe(404)
  expect((await fetch(`${origin}/cdn/photos/${photo.id}/thumb`)).status).toBe(404)
  expect((await send(owner, `/api/photos/${photo.id}`, 'DELETE')).status).toBe(204)
  expect((await owner(`/api/photos/${photo.id}`)).status).toBe(404)
  expect((await fetch(new URL(photo.images.full, origin))).status).toBe(404)
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
  // A garment waiting in the review tray stays there: a match sent for it answers the photo as it is.
  const unmatch = { operationId: 'native-photo-unmatch-offered', pieceId: null }
  const kept = await send(owner, `/api/photos/${photo.id}/garments/${garment.id}`, 'PUT', unmatch)
  expect((await photoOf(kept)).garments[0]?.match).toBe('offered')
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
  // The page shows the cut-out at once (T-17): its signed address serves it transformed to WebP, transparency kept
  // (signed media, T-21).
  const cutoutAddress = cutOut.cutoutImages?.full ?? ''
  expect(cutoutAddress).not.toBe('')
  const cutoutPicture = await fetch(new URL(cutoutAddress, origin))
  expect(cutoutPicture.status).toBe(200)
  expect(cutoutPicture.headers.get('content-type')).toContain('image/webp')
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

/** Add to board: the picture the page shows (the cut-out, then the photo itself; T-17) and the look worn from it go on
 * the person's own board, each once; a visitor to the public board sees neither the photo's pins nor its pictures. */
const verifyOnBoard = async (origin: string, owner: Call, photoId: string) => {
  await send(owner, '/api/profile', 'PATCH', { handle: 'native.photos', name: 'Native Photos', tone: 'clay' })
  expect((await send(owner, '/api/profile/published', 'PUT', { published: true })).status).toBe(200)
  const board = await send(owner, '/api/boards', 'POST', { operationId: 'native-photo-board-1', name: 'Saturday' })
  const { id: boardId } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await board.json())
  const cutoutToBoard = { operationId: 'native-photo-to-board-1', boardId, picture: 'cutout' }
  expect((await send(owner, `/api/photos/${photoId}/board`, 'POST', cutoutToBoard)).status).toBe(204)
  expect((await send(owner, `/api/photos/${photoId}/board`, 'POST', cutoutToBoard)).status).toBe(204)
  const withCutout = Schema.decodeUnknownSync(BoardPins)(await (await owner(`/api/boards/${boardId}`)).json())
  expect(withCutout.pins.filter(({ _tag }) => _tag === 'PicturePin')).toHaveLength(1)
  // The photo itself is another picture; the same request again, under another id, places nothing more.
  const photoToBoard = { operationId: 'native-photo-to-board-2', boardId, picture: 'photo' }
  expect((await send(owner, `/api/photos/${photoId}/board`, 'POST', photoToBoard)).status).toBe(204)
  const again = { ...photoToBoard, operationId: 'native-photo-to-board-3' }
  expect((await send(owner, `/api/photos/${photoId}/board`, 'POST', again)).status).toBe(204)
  const own = Schema.decodeUnknownSync(BoardPins)(await (await owner(`/api/boards/${boardId}`)).json())
  const pictures = own.pins.filter(({ _tag }) => _tag === 'PicturePin')
  expect(pictures).toHaveLength(2)
  expect(own.items).toEqual([{ _tag: 'ImageItem' }, { _tag: 'ImageItem' }])
  expect(own.pins.some(({ _tag }) => _tag === 'LookPin')).toBe(true)
  const visibility = await send(owner, `/api/boards/${boardId}/visibility`, 'PUT', { visibility: 'public' })
  expect(visibility.status).toBe(200)
  const seen = await publicBoard(origin, boardId)
  expect(seen.pins.map(({ _tag }) => _tag)).not.toContain('PublicPicturePin')
  expect(seen.items.map(({ _tag }) => _tag)).not.toContain('ImageItem')
  expect((await fetch(`${origin}/cdn/public/pictures/${pictures[0]?.imageId ?? ''}/thumb`)).status).toBe(404)
}

/** My Gallery for the website. */
const Counts = Schema.Struct({
  photos: Schema.Number,
  ready: Schema.Number,
  garments: Schema.Number,
  queued: Schema.Number,
})

/** The operator finds a photo again (Eva, 4 November): Styld's guess is replaced by what is found now, a piece added by
 * hand stays, no credit is spent, and the same operation again queues nothing new. Only the operator's token reaches it. */
const verifyRefinding = async (origin: string, owner: Call) => {
  const add = { operationId: 'native-photo-add-3', uploadId: await receivedPhoto(origin, owner) }
  const photo = await found(owner, (await photoOf(await send(owner, '/api/photos', 'POST', add))).id)
  const [guess] = photo.garments
  if (guess === undefined) throw new Error('no garment')
  const pieceId = await idOf(
    await send(owner, '/api/pieces', 'POST', {
      operationId: 'native-photo-piece-refind',
      uploadId: await receivedPhoto(origin, owner),
      type: 'jeans',
    }),
  )
  expect(await waitUntilReady(owner, pieceId)).toBe('ready')
  const byHand = { operationId: 'native-photo-hand-refind', pieceId }
  await photoOf(await send(owner, `/api/photos/${photo.id}/pieces`, 'POST', byHand))
  const before = await remaining(owner)
  const email = emailOf('native-photos')
  const operator = operatorClient(origin, nativeOperatorToken)
  expect((await owner(`/api/operator/photos?email=${encodeURIComponent(email)}`)).status).toBe(404)
  const refind = { operationId: 'native-photo-refind-1', email }
  expect((await send(owner, '/api/operator/photos/refind', 'POST', refind)).status).toBe(404)
  const sent = await send(operator, '/api/operator/photos/refind', 'POST', refind)
  expect(sent.status).toBe(200)
  const counts = Schema.decodeUnknownSync(Counts)(await sent.json())
  expect(counts.queued).toBe(counts.ready)
  const again = await send(operator, '/api/operator/photos/refind', 'POST', refind)
  expect(Schema.decodeUnknownSync(Counts)(await again.json())).toEqual(counts)
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const now = await photoOf(await owner(`/api/photos/${photo.id}`))
    if (!now.garments.some(({ id }) => id === guess.id)) {
      expect(now.garments.filter(({ match }) => match === 'unmatched')).toHaveLength(1)
      expect(now.garments.filter(({ pieceId: piece }) => piece === pieceId)).toHaveLength(1)
      expect(await remaining(owner)).toBe(before)
      const read = await operator(`/api/operator/photos?email=${encodeURIComponent(email)}`)
      expect(Schema.decodeUnknownSync(Counts)(await read.json()).queued).toBe(0)
      return
    }
    await Bun.sleep(250)
  }
  throw new Error(`photo ${photo.id} was never found again`)
}

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
  await verifyRefinding(origin, owner)
}
