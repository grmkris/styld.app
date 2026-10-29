import { expect } from 'bun:test'
import { Schema } from 'effect'

/** A 1x1 PNG: the smallest photo the upload checks accept. */
const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
)

const signIn = async (origin: string, id: string) => {
  const response = await fetch(`${origin}/api/auth/signIn`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-effect-auth-csrf': '1' },
    body: JSON.stringify({ payload: { email: `${id}@example.invalid`, password: 'native-identity-password-52' } }),
  })
  expect(response.status).toBe(200)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

const client =
  (origin: string, cookie: string) =>
  (path: string, init: RequestInit = {}) => {
    const headers = new Headers({ origin, cookie, 'x-effect-auth-csrf': '1', 'content-type': 'application/json' })
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value)
    return fetch(`${origin}${path}`, { ...init, headers })
  }

type Call = ReturnType<typeof client>

const json = (call: Call, path: string, method: string, body: unknown) =>
  call(path, { method, body: JSON.stringify(body) })

const upload = async (call: Call, bytes: Uint8Array<ArrayBuffer>, contentType = 'image/png') => {
  const created = await json(call, '/api/uploads', 'POST', { contentType, bytes: bytes.byteLength })
  expect(created.status).toBe(200)
  const { uploadId, path } = Schema.decodeUnknownSync(Schema.Struct({ uploadId: Schema.String, path: Schema.String }))(
    await created.json(),
  )
  return { uploadId, path }
}

const put = (origin: string, path: string, bytes: Uint8Array<ArrayBuffer>, contentType = 'image/png') =>
  fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': contentType }, body: new Blob([bytes]) })

const waitUntilReady = async (call: Call, pieceId: string) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { status } = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }))(
      await (await call(`/api/pieces/${pieceId}`)).json(),
    )
    if (status !== 'processing') return status
    await Bun.sleep(250)
  }
  return 'processing'
}

/** A photo goes up, becomes a piece, is processed by the queue and shown through the Images
 * binding, only to its owner; edits, replays and deletion behave as the protocol says. */
export const verifyWardrobe = async (origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-wardrobe`, { method: 'POST' })).status).toBe(204)
  const owner = client(origin, await signIn(origin, 'native-wardrobe'))
  const other = client(origin, await signIn(origin, 'native-wardrobe-other'))
  expect((await fetch(`${origin}/api/pieces`)).status).toBe(401)
  expect(await (await owner('/api/pieces')).json()).toEqual({ pieces: [] })

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

  const add = {
    operationId: 'native-add-0001',
    uploadId: photo.uploadId,
    category: 'top',
    colours: ['navy'],
    name: 'Cable knit',
  }
  expect((await json(owner, '/api/pieces', 'POST', { ...add, subcategory: 'jeans' })).status).toBe(422)
  const added = await json(owner, '/api/pieces', 'POST', { ...add, subcategory: 'long_sleeve' })
  expect(added.status).toBe(200)
  const addedBody: unknown = await added.json()
  expect(addedBody).toMatchObject({ status: 'processing', source: 'website', subcategory: 'long_sleeve' })
  const piece = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(addedBody)
  // Repeating the operation repeats its answer; reusing its id for another change is refused.
  expect(await (await json(owner, '/api/pieces', 'POST', { ...add, subcategory: 'long_sleeve' })).json()).toMatchObject(
    { id: piece.id },
  )
  expect((await json(owner, '/api/pieces', 'POST', { ...add, name: 'Other' })).status).toBe(409)
  expect((await json(owner, '/api/pieces', 'POST', { ...add, operationId: 'native-add-0002' })).status).toBe(422)

  expect(await waitUntilReady(owner, piece.id)).toBe('ready')
  const thumb = await owner(`/cdn/pieces/${piece.id}/thumb`)
  expect(thumb.status).toBe(200)
  expect(thumb.headers.get('content-type')).toMatch(/^image\//)
  expect(thumb.headers.get('cache-control')).toContain('private')
  const etag = thumb.headers.get('etag') ?? ''
  expect((await owner(`/cdn/pieces/${piece.id}/thumb`, { headers: { 'if-none-match': etag } })).status).toBe(304)

  // Another account cannot see, change, show or delete the piece.
  expect((await other(`/api/pieces/${piece.id}`)).status).toBe(404)
  expect((await other(`/cdn/pieces/${piece.id}/full`)).status).toBe(404)
  expect(await (await other('/api/pieces')).json()).toEqual({ pieces: [] })
  expect((await json(other, `/api/pieces/${piece.id}`, 'PATCH', { name: 'Mine now' })).status).toBe(404)
  expect((await other(`/api/pieces/${piece.id}`, { method: 'DELETE' })).status).toBe(404)
  expect(
    (await other('/api/pieces', { method: 'POST', body: JSON.stringify({ ...add, operationId: 'native-add-0003' }) }))
      .status,
  ).toBe(422)

  // A new category drops a subcategory it does not have.
  const edited = await json(owner, `/api/pieces/${piece.id}`, 'PATCH', { name: 'Navy jumper', category: 'outerwear' })
  expect(await edited.json()).toMatchObject({ name: 'Navy jumper', category: 'outerwear', subcategory: null })

  const me = Schema.decodeUnknownSync(Schema.Struct({ accountId: Schema.String }))(
    await (await owner('/api/me')).json(),
  )
  const key = `accounts/${me.accountId}/uploads/${photo.uploadId}`
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: true })
  expect((await owner(`/api/pieces/${piece.id}`, { method: 'DELETE' })).status).toBe(204)
  expect((await owner(`/api/pieces/${piece.id}`)).status).toBe(404)
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: false })
}

/** Deleting an account ends its access at once and removes its pieces and photos; the email and
 * password no longer sign in. Runs after `verifyWardrobe`, which seeds the account. */
export const verifyAccountDeletion = async (origin: string, fixtures: string): Promise<void> => {
  const cookie = await signIn(origin, 'native-farewell')
  const call = client(origin, cookie)
  const photo = await upload(call, png)
  expect((await put(origin, photo.path, png)).status).toBe(204)
  const added = await json(call, '/api/pieces', 'POST', {
    operationId: 'native-farewell-1',
    uploadId: photo.uploadId,
    category: 'dress',
  })
  expect(added.status).toBe(200)
  const key = `accounts/native-farewell/uploads/${photo.uploadId}`
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: true })
  // A change from anywhere but the website itself is refused before it runs.
  const bare = (method: string, path: string) => fetch(`${origin}${path}`, { method, headers: { cookie } })
  expect((await bare('DELETE', '/api/me')).status).toBe(403)
  expect(
    (
      await fetch(`${origin}/api/me`, {
        method: 'DELETE',
        headers: { cookie, origin: 'https://evil.invalid', 'x-effect-auth-csrf': '1' },
      })
    ).status,
  ).toBe(403)
  const unadmitted = await fetch(`${origin}/api/uploads`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ contentType: 'image/png', bytes: png.byteLength }),
  })
  expect(unadmitted.status).toBe(403)
  expect((await call('/api/me')).status).toBe(200)
  expect((await call('/api/me', { method: 'DELETE' })).status).toBe(204)
  expect((await call('/api/me')).status).toBe(401)
  expect((await call('/api/pieces')).status).toBe(401)
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: false })
  const again = await fetch(`${origin}/api/auth/signIn`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'x-effect-auth-csrf': '1' },
    body: JSON.stringify({
      payload: { email: 'native-farewell@example.invalid', password: 'native-identity-password-52' },
    }),
  })
  expect(await again.json()).toMatchObject({ _tag: 'Failure' })
}
