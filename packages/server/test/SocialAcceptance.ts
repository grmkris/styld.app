import { expect } from 'bun:test'
import { Schema } from 'effect'
import { addedPiece, idOf } from './GalleryAcceptance.ts'
import { type Call, client, receivedPhoto, signIn, waitUntilReady } from './WardrobeAcceptance.ts'

/** Test-only acceptance: profiles and what other people may see, through the public edge. */

const send = (call: Call, path: string, method: string, body: unknown) =>
  call(path, { method, body: JSON.stringify(body) })

const refusal = async (response: Response, status: number, tag: string) => {
  expect(response.status).toBe(status)
  expect(await response.json()).toMatchObject({ _tag: tag })
}

/** A profile: unpublished on the name the account signed up with until it is saved, a handle that must be free and
 * not reserved, and published only with one. */
const verifyProfiles = async (origin: string, owner: Call, other: Call) => {
  expect((await fetch(`${origin}/api/profile`)).status).toBe(401)
  expect(await (await owner('/api/profile')).json()).toMatchObject({
    handle: null,
    name: 'Native Identity',
    published: false,
    wardrobeShown: true,
  })
  await refusal(await send(owner, '/api/profile/published', 'PUT', { published: true }), 422, 'ProfileNeedsHandle')
  await refusal(await send(owner, '/api/profile', 'PATCH', { handle: 'styld' }), 422, 'HandleReserved')
  expect((await send(owner, '/api/profile', 'PATCH', { handle: 'Not A Handle' })).status).toBe(400)
  const nika = { handle: 'nika.kovac', name: 'Nika Kovač', city: 'Maribor', bio: 'Red, black and one good coat.' }
  const saved = await send(owner, '/api/profile', 'PATCH', { ...nika, tone: 'clay' })
  expect(saved.status).toBe(200)
  expect(await saved.json()).toMatchObject({ ...nika, tone: 'clay', published: false })
  await refusal(await send(other, '/api/profile', 'PATCH', { handle: 'nika.kovac' }), 409, 'HandleTaken')
  const published = await send(owner, '/api/profile/published', 'PUT', { published: true })
  expect(await published.json()).toMatchObject({ handle: 'nika.kovac', published: true })
  expect(await (await send(owner, '/api/profile', 'PATCH', { city: null })).json()).toMatchObject({
    city: null,
    published: true,
  })
  const hidden = await send(owner, '/api/profile/published', 'PUT', { published: false })
  expect(await hidden.json()).toMatchObject({ published: false })
}

const Checked = Schema.Struct({ check: Schema.NullOr(Schema.Struct({ state: Schema.String })) })

/** Read until the check is in this state: the queue answers checks of edits a moment later. */
const settled = async (read: () => Promise<Response>, state: string) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const { check } = Schema.decodeUnknownSync(Checked)(await (await read()).json())
    if (check?.state === state) return
    await Bun.sleep(250)
  }
  throw new Error(`The check never became ${state}`)
}

/** Nothing goes public unchecked: a board goes public only from a published profile, and publishing checks it at
 * once. An edit while public is checked again through the queue, and a check outlives going private. The stand-in
 * judge fails words with `[[fail]]` and is unsure of `[[unsure]]`. */
const verifyChecks = async (origin: string, owner: Call) => {
  const boardId = await idOf(await send(owner, '/api/boards', 'POST', { operationId: 'native-social-1', name: 'Rain' }))
  const visibility = `/api/boards/${boardId}/visibility`
  await refusal(await send(owner, visibility, 'PUT', { visibility: 'public' }), 422, 'ProfileNotPublished')
  const published = await send(owner, '/api/profile/published', 'PUT', { published: true })
  expect(await published.json()).toMatchObject({ published: true, check: { state: 'passed', hidden: false } })
  expect(await (await send(owner, visibility, 'PUT', { visibility: 'public' })).json()).toMatchObject({
    visibility: 'public',
    check: { state: 'passed' },
  })
  const renamed = await send(owner, `/api/boards/${boardId}`, 'PATCH', { name: 'Rain [[fail]]' })
  expect(await renamed.json()).toMatchObject({ name: 'Rain [[fail]]', visibility: 'public' })
  await settled(() => owner(`/api/boards/${boardId}`), 'failed')
  expect(await (await send(owner, visibility, 'PUT', { visibility: 'private' })).json()).toMatchObject({
    visibility: 'private',
    check: { state: 'failed', reason: 'other' },
  })
  const bio = await send(owner, '/api/profile', 'PATCH', { bio: 'Ask me first [[unsure]]' })
  expect(await bio.json()).toMatchObject({ check: { state: 'unsure', reason: 'other' } })
  const pieceId = await addedPiece(origin, owner, 'native-social-2')
  const look = { operationId: 'native-social-3', name: 'Monday', pieceIds: [pieceId] }
  const lookId = await idOf(await send(owner, '/api/looks', 'POST', look))
  const shared = `/api/looks/${lookId}/shared`
  expect(await (await send(owner, shared, 'PUT', { shared: true })).json()).toMatchObject({
    shared: true,
    check: { state: 'passed' },
  })
  expect(await (await send(owner, shared, 'PUT', { shared: false })).json()).toMatchObject({ shared: false })
  await send(owner, '/api/profile/published', 'PUT', { published: false })
  await refusal(await send(owner, visibility, 'PUT', { visibility: 'public' }), 422, 'ProfileNotPublished')
  await refusal(await send(owner, shared, 'PUT', { shared: true }), 422, 'ProfileNotPublished')
}

const Tagged = Schema.Struct({ pins: Schema.Array(Schema.Struct({ _tag: Schema.String })) })

/** The kinds of pin anyone sees on a public board, once a queued check has answered. */
const publicPins = async (origin: string, boardId: string, until: (tags: ReadonlyArray<string>) => boolean) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${origin}/api/public/boards/${boardId}`)
    const tags = response.ok ? Schema.decodeUnknownSync(Tagged)(await response.json()).pins.map(({ _tag }) => _tag) : []
    if (until(tags)) return tags
    await Bun.sleep(250)
  }
  throw new Error('The public board never showed its pins')
}

const Shown = Schema.Struct({ pieces: Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.String }))) })

/** The pieces anyone sees on the published profile, once a queued check has answered. */
const shownPieces = async (origin: string, until: (ids: ReadonlyArray<string>) => boolean) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${origin}/api/public/profiles/nika.kovac`)
    const ids = response.ok
      ? (Schema.decodeUnknownSync(Shown)(await response.json()).pieces ?? []).map(({ id }) => id)
      : []
    if (until(ids)) return ids
    await Bun.sleep(250)
  }
  throw new Error('The profile never showed its pieces')
}

/** A public board, read signed out: pictures shown, a piece only once it has a cut-out (its photo never goes
 * public), nothing private on it, and everything gone the moment it goes private or the wardrobe is hidden. */
const verifyPublicPages = async (origin: string, fixtures: string, owner: Call) => {
  const anyone = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, init)
  expect((await anyone('/api/public/profiles/nika.kovac')).status).toBe(404)
  await send(owner, '/api/profile', 'PATCH', { bio: 'Red, black and one good coat.' })
  await send(owner, '/api/profile/published', 'PUT', { published: true })
  const pieceId = await addedPiece(origin, owner, 'native-social-4')
  expect(await waitUntilReady(owner, pieceId)).toBe('ready')
  const boardId = await idOf(
    await send(owner, '/api/boards', 'POST', { operationId: 'native-social-5', name: 'Coats' }),
  )
  await send(owner, `/api/boards/${boardId}/pins`, 'POST', { operationId: 'native-social-6', pieceIds: [pieceId] })
  const picture = { operationId: 'native-social-7', uploadId: await receivedPhoto(origin, owner) }
  const { imageId } = Schema.decodeUnknownSync(Schema.Struct({ imageId: Schema.String }))(
    await (await send(owner, `/api/boards/${boardId}/images`, 'POST', picture)).json(),
  )
  const visibility = `/api/boards/${boardId}/visibility`
  expect(await (await send(owner, visibility, 'PUT', { visibility: 'public' })).json()).toMatchObject({
    check: { state: 'passed' },
  })
  expect(await publicPins(origin, boardId, (tags) => tags.length > 0)).toEqual(['PublicPicturePin'])
  const shown = await anyone(`/cdn/public/pictures/${imageId}/thumb`)
  expect(shown.status).toBe(200)
  expect(shown.headers.get('content-type')).toBe('image/webp')
  expect(shown.headers.get('cache-control')).toBe('public, no-cache')
  expect((await anyone(`/cdn/public/pieces/${pieceId}/thumb`)).status).toBe(404)
  expect((await fetch(`${fixtures}/test/social/cutout/${pieceId}`, { method: 'POST' })).status).toBe(204)
  expect(await publicPins(origin, boardId, (tags) => tags.length > 1)).toEqual(['PublicPicturePin', 'PublicPiecePin'])
  const thumb = await anyone(`/cdn/public/pieces/${pieceId}/thumb`)
  expect(thumb.headers.get('content-type')).toBe('image/webp')
  const etag = thumb.headers.get('etag') ?? ''
  expect((await anyone(`/cdn/public/pieces/${pieceId}/thumb`, { headers: { 'if-none-match': etag } })).status).toBe(304)
  expect(await (await anyone('/api/public/profiles/nika.kovac')).json()).toMatchObject({
    handle: 'nika.kovac',
    boards: [{ id: boardId, pinCount: 2 }],
    pieces: [{ id: pieceId }],
  })
  // A piece added once the profile is published is checked as it becomes ready, then shows in the wardrobe.
  const later = await addedPiece(origin, owner, 'native-social-8')
  expect(await waitUntilReady(owner, later)).toBe('ready')
  expect((await fetch(`${fixtures}/test/social/cutout/${later}`, { method: 'POST' })).status).toBe(204)
  expect(await shownPieces(origin, (ids) => ids.includes(later))).toEqual([later, pieceId])
  const page = Schema.decodeUnknownSync(Schema.Struct({ piece: Schema.Record(Schema.String, Schema.Unknown) }))(
    await (await anyone(`/api/public/pieces/${pieceId}`)).json(),
  )
  expect(Object.keys(page.piece).toSorted()).toEqual(['category', 'colours', 'id', 'name', 'subcategory'])
  await send(owner, visibility, 'PUT', { visibility: 'private' })
  expect((await anyone(`/api/public/boards/${boardId}`)).status).toBe(404)
  expect((await anyone(`/cdn/public/pictures/${imageId}/thumb`)).status).toBe(404)
  expect((await anyone(`/cdn/public/pieces/${pieceId}/thumb`)).status).toBe(200)
  await send(owner, '/api/profile', 'PATCH', { wardrobeShown: false })
  expect((await anyone(`/cdn/public/pieces/${pieceId}/thumb`)).status).toBe(404)
  expect(await (await anyone('/api/public/profiles/nika.kovac')).json()).toMatchObject({ boards: [], pieces: null })
  await send(owner, '/api/profile/published', 'PUT', { published: false })
  expect((await anyone('/api/public/profiles/nika.kovac')).status).toBe(404)
}

/** Profiles and what other people may see of each account. */
export const verifySocial = async (origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-social`, { method: 'POST' })).status).toBe(204)
  const owner = client(origin, await signIn(origin, 'native-social'))
  const other = client(origin, await signIn(origin, 'native-social-other'))
  await verifyProfiles(origin, owner, other)
  await verifyChecks(origin, owner)
  await verifyPublicPages(origin, fixtures, owner)
}
