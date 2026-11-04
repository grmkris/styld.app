import { expect } from 'bun:test'
import { Schema } from 'effect'
import { type Call, client, seedAccounts, send, signIn, signInBody, withOperation } from './Accounts.ts'
import { csrf } from '@styld/auth/config'

/** A 1x1 PNG: the smallest photo the upload checks accept. */
const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
)

const upload = async (call: Call, bytes: Uint8Array<ArrayBuffer>, contentType = 'image/png') => {
  const created = await send(call, '/api/uploads', 'POST', { contentType, bytes: bytes.byteLength })
  expect(created.status).toBe(200)
  const { uploadId, path } = Schema.decodeUnknownSync(Schema.Struct({ uploadId: Schema.String, path: Schema.String }))(
    await created.json(),
  )
  return { uploadId, path }
}

const put = (origin: string, path: string, bytes: Uint8Array<ArrayBuffer>, contentType = 'image/png') =>
  fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': contentType }, body: new Blob([bytes]) })

/** A photo uploaded and received, ready to become something: its upload id. */
export const receivedPhoto = async (origin: string, call: Call) => {
  const photo = await upload(call, png)
  expect((await put(origin, photo.path, png)).status).toBe(204)
  return photo.uploadId
}

export const waitUntilReady = async (call: Call, pieceId: string) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { status } = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }))(
      await (await call(`/api/pieces/${pieceId}`)).json(),
    )
    if (status !== 'processing') return status
    await Bun.sleep(250)
  }
  return 'processing'
}

/** The bytes must be what the upload declared, and an upload takes one photo: a photo received for a piece. */
const checkedUpload = async (origin: string, owner: Call) => {
  // The bytes must be what the upload declared, and an upload takes one photo.
  const fake = await upload(owner, png)
  expect((await put(origin, fake.path.replace(/token=[^&]+/, 'token=wrong'), png)).status).toBe(404)
  expect(
    (
      await put(
        origin,
        fake.path,
        new TextEncoder().encode('not a png at all, honestly!!!!!!').slice(0, png.byteLength),
      )
    ).status,
  ).toBe(415)
  const photo = await upload(owner, png)
  expect((await put(origin, photo.path, png, 'image/jpeg')).status).toBe(415)
  expect((await put(origin, photo.path, png)).status).toBe(204)
  expect((await put(origin, photo.path, png)).status).toBe(409)
  return photo
}

const PieceImages = Schema.Struct({
  images: Schema.Struct({ thumb: Schema.String, full: Schema.String, back: Schema.optionalKey(Schema.String) }),
})

/** The signed addresses the website is handed for a piece's pictures. */
const imagesOf = async (owner: Call, pieceId: string) =>
  Schema.decodeUnknownSync(PieceImages)(await (await owner(`/api/pieces/${pieceId}`)).json()).images

/** A signed address with one of its signed fields changed. */
const altered = (address: string, field: string, value: string) => {
  const url = new URL(address, 'https://styld.test')
  url.searchParams.set(field, value)
  return `${url.pathname}${url.search}`
}

/** A back added on the piece's page: shown by its signed address only, repeated as is, and forgotten again. */
const verifyBack = async (origin: string, owner: Call, other: Call, pieceId: string) => {
  const back = { operationId: 'native-back-0001', uploadId: await receivedPhoto(origin, owner) }
  expect((await send(other, `/api/pieces/${pieceId}/back`, 'PUT', back)).status).toBe(404)
  const set = await send(owner, `/api/pieces/${pieceId}/back`, 'PUT', back)
  expect(await set.json()).toMatchObject({ id: pieceId, hasBack: true })
  expect(await (await send(owner, `/api/pieces/${pieceId}/back`, 'PUT', back)).json()).toMatchObject({ hasBack: true })
  const backImage = (await imagesOf(owner, pieceId)).back
  expect((await fetch(`${origin}${backImage ?? ''}`)).status).toBe(200)
  const removed = await owner(`/api/pieces/${pieceId}/back`, { method: 'DELETE' })
  expect(await removed.json()).toMatchObject({ hasBack: false })
  expect((await imagesOf(owner, pieceId)).back).toBeUndefined()
}

/** A photo goes up, becomes a piece, is processed by the queue and shown through the Images
 * binding, only to its owner; edits, replays and deletion behave as the protocol says. */
export const verifyWardrobe = async (origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, 'native-wardrobe', 'native-wardrobe-other', 'native-farewell')
  const owner = client(origin, await signIn(origin, 'native-wardrobe'))
  const other = client(origin, await signIn(origin, 'native-wardrobe-other'))
  expect((await fetch(`${origin}/api/pieces`)).status).toBe(401)
  expect(await (await owner('/api/pieces')).json()).toEqual({ pieces: [] })

  const photo = await checkedUpload(origin, owner)

  const add = {
    operationId: 'native-add-0001',
    uploadId: photo.uploadId,
    type: 'knitwear',
    colours: ['navy'],
    name: 'Cable knit',
    seasons: ['autumn', 'winter'],
    occasions: ['casual', 'smart'],
  }
  expect((await send(owner, '/api/pieces', 'POST', { ...add, type: 'jumper' })).status).toBe(400)
  expect((await send(owner, '/api/pieces', 'POST', { ...add, shopUrl: 'http://shop.example/knit' })).status).toBe(400)
  const added = await send(owner, '/api/pieces', 'POST', add)
  expect(added.status).toBe(200)
  const addedBody: unknown = await added.json()
  expect(addedBody).toMatchObject({
    status: 'processing',
    source: 'website',
    type: 'knitwear',
    seasons: ['autumn', 'winter'],
    occasions: ['casual', 'smart'],
    pattern: null,
    brand: null,
    hasBack: false,
  })
  const piece = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(addedBody)
  // Repeating the operation repeats its answer; reusing its id for another change is refused.
  expect(await (await send(owner, '/api/pieces', 'POST', add)).json()).toMatchObject({ id: piece.id })
  expect((await send(owner, '/api/pieces', 'POST', { ...add, name: 'Other' })).status).toBe(409)
  expect((await send(owner, '/api/pieces', 'POST', { ...add, operationId: 'native-add-0002' })).status).toBe(422)

  expect(await waitUntilReady(owner, piece.id)).toBe('ready')
  await verifyBack(origin, owner, other, piece.id)
  // The wardrobe's pictures load by their signed addresses alone: no session cookie, so no session read and no D1.
  const images = await imagesOf(owner, piece.id)
  const thumb = await fetch(`${origin}${images.thumb}`)
  expect(thumb.status).toBe(200)
  expect(thumb.headers.get('content-type')).toMatch(/^image\//)
  expect(thumb.headers.get('cache-control')).toMatch(/^private, max-age=\d+, immutable$/)
  expect((await fetch(`${origin}${images.full}`)).status).toBe(200)
  // An altered address, or one pointed at another account's object, is refused before anything is read.
  const otherKey = altered(images.thumb, 'k', 'accounts/acc_other/uploads/up_other')
  expect((await fetch(`${origin}${otherKey}`)).status).toBe(403)
  expect((await fetch(`${origin}${altered(otherKey, 'a', 'acc_other')}`)).status).toBe(403)
  expect((await fetch(`${origin}${altered(images.thumb, 'e', '1')}`)).status).toBe(403)
  expect((await fetch(`${origin}${images.thumb.replace('/thumb?', '/full?')}`)).status).toBe(403)
  // The pieces list hands over the same addresses.
  expect(await (await owner('/api/pieces')).json()).toMatchObject({ pieces: [{ id: piece.id, images }] })

  // Another account cannot see, change, show or delete the piece.
  expect((await other(`/api/pieces/${piece.id}`)).status).toBe(404)
  expect(await (await other('/api/pieces')).json()).toEqual({ pieces: [] })
  expect((await send(other, `/api/pieces/${piece.id}`, 'PATCH', { name: 'Mine now' })).status).toBe(404)
  expect((await other(`/api/pieces/${piece.id}`, { method: 'DELETE' })).status).toBe(404)
  expect(
    (await other('/api/pieces', { method: 'POST', body: JSON.stringify({ ...add, operationId: 'native-add-0003' }) }))
      .status,
  ).toBe(422)

  // A change names only what it changes; null clears an attribute, and no season is all year.
  const edited = await send(owner, `/api/pieces/${piece.id}`, 'PATCH', {
    name: 'Navy jumper',
    type: 'jackets',
    seasons: [],
    rainproof: true,
    brand: 'COS',
    shopUrl: 'https://shop.example/knit',
  })
  expect(await edited.json()).toMatchObject({
    name: 'Navy jumper',
    type: 'jackets',
    seasons: [],
    rainproof: true,
    occasions: ['casual', 'smart'],
    brand: 'COS',
    shopUrl: 'https://shop.example/knit',
  })

  await verifyDeletes(origin, fixtures, { owner, other }, piece.id, photo.uploadId)
}

/** A piece deleted on its page goes with its photo. Then several deleted from the grid at once: another account's
 * request deletes nothing, a piece already gone is skipped, the rest go with their photos, and the same request again
 * answers done. */
const verifyDeletes = async (
  origin: string,
  fixtures: string,
  { owner, other }: { readonly owner: Call; readonly other: Call },
  goneId: string,
  goneUpload: string,
) => {
  const goneKey = `accounts/native-wardrobe/uploads/${goneUpload}`
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${goneKey}`)).json()).toEqual({ exists: true })
  expect((await owner(`/api/pieces/${goneId}`, { method: 'DELETE' })).status).toBe(204)
  expect((await owner(`/api/pieces/${goneId}`)).status).toBe(404)
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${goneKey}`)).json()).toEqual({ exists: false })
  const uploadId = await receivedPhoto(origin, owner)
  const added = await send(owner, '/api/pieces', 'POST', { operationId: 'native-add-0004', uploadId, type: 'tops' })
  const { id } = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(await added.json())
  expect(await waitUntilReady(owner, id)).toBe('ready')
  const key = `accounts/native-wardrobe/uploads/${uploadId}`
  expect((await send(other, '/api/pieces/delete', 'POST', { pieceIds: [id] })).status).toBe(404)
  expect((await owner(`/api/pieces/${id}`)).status).toBe(200)
  expect((await send(owner, '/api/pieces/delete', 'POST', { pieceIds: [] })).status).toBe(400)
  const several = { operationId: 'native-delete-several-1', pieceIds: [goneId, id, id] }
  expect((await send(owner, '/api/pieces/delete', 'POST', several)).status).toBe(204)
  expect((await owner(`/api/pieces/${id}`)).status).toBe(404)
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: false })
  expect((await send(owner, '/api/pieces/delete', 'POST', several)).status).toBe(204)
  expect((await send(owner, '/api/pieces/delete', 'POST', { ...several, pieceIds: [id] })).status).toBe(409)
}

/** Deleting an account ends its access at once and removes its pieces and photos; the email and
 * password no longer sign in. Runs after `verifyWardrobe`, which seeds the account. */
export const verifyAccountDeletion = async (origin: string, fixtures: string): Promise<void> => {
  const cookie = await signIn(origin, 'native-farewell')
  const call = client(origin, cookie)
  const photo = await upload(call, png)
  expect((await put(origin, photo.path, png)).status).toBe(204)
  const added = await send(call, '/api/pieces', 'POST', {
    operationId: 'native-farewell-1',
    uploadId: photo.uploadId,
    type: 'dresses',
  })
  expect(added.status).toBe(200)
  const key = `accounts/native-farewell/uploads/${photo.uploadId}`
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: true })
  // A change from anywhere but the website itself is refused before it runs.
  const bare = (method: string, path: string) =>
    fetch(`${origin}${path}`, {
      ...withOperation(path, { method }),
      headers: { cookie, 'content-type': 'application/json' },
    })
  expect((await bare('DELETE', '/api/me')).status).toBe(403)
  expect(
    (
      await fetch(`${origin}/api/me`, {
        ...withOperation('/api/me', { method: 'DELETE' }),
        headers: {
          cookie,
          origin: 'https://evil.invalid',
          [csrf.header]: csrf.value,
          'content-type': 'application/json',
        },
      })
    ).status,
  ).toBe(403)
  const unadmitted = await fetch(`${origin}/api/uploads`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ operationId: 'native-unadmitted-upload', contentType: 'image/png', bytes: png.byteLength }),
  })
  expect(unadmitted.status).toBe(403)
  expect((await call('/api/pieces')).status).toBe(200)
  expect((await call('/api/me', { method: 'DELETE' })).status).toBe(204)
  expect((await call('/api/pieces')).status).toBe(401)
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: false })
  const again = await fetch(`${origin}/api/auth/signIn`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', [csrf.header]: csrf.value },
    body: JSON.stringify(signInBody('native-farewell')),
  })
  expect(await again.json()).toMatchObject({ _tag: 'Failure' })
}
