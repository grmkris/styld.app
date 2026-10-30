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

/** A page as a link preview reads it: its HTML, with what its head says. */
const previewOf = async (origin: string, path: string) => {
  const page = await fetch(`${origin}${path}`, { headers: { 'user-agent': 'facebookexternalhit/1.1' } })
  expect(page.status).toBe(200)
  expect(page.headers.get('x-robots-tag')).toBe('noindex')
  return page.text()
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
  const board = await previewOf(origin, `/boards/${boardId}`)
  expect(board).toContain('<meta property="og:title" content="Coats on Styld">')
  expect(board).toContain(`<meta property="og:image" content="${origin}/cdn/public/`)
  expect(board).toContain(`<link rel="canonical" href="${origin}/boards/${boardId}">`)
  expect(await previewOf(origin, '/@nika.kovac')).toContain('content="Nika Kovač (@nika.kovac) on Styld"')
  const moved = await fetch(`${origin}/share/board/${boardId}`, { redirect: 'manual' })
  expect(moved.status).toBe(301)
  expect(moved.headers.get('location')).toBe(`${origin}/boards/${boardId}`)
  const page = Schema.decodeUnknownSync(Schema.Struct({ piece: Schema.Record(Schema.String, Schema.Unknown) }))(
    await (await anyone(`/api/public/pieces/${pieceId}`)).json(),
  )
  expect(Object.keys(page.piece).toSorted()).toEqual(['category', 'colours', 'id', 'name', 'subcategory'])
  await send(owner, visibility, 'PUT', { visibility: 'private' })
  expect((await anyone(`/api/public/boards/${boardId}`)).status).toBe(404)
  expect(await previewOf(origin, `/boards/${boardId}`)).not.toContain('og:title')
  expect((await anyone(`/cdn/public/pictures/${imageId}/thumb`)).status).toBe(404)
  expect((await anyone(`/cdn/public/pieces/${pieceId}/thumb`)).status).toBe(200)
  await send(owner, '/api/profile', 'PATCH', { wardrobeShown: false })
  expect((await anyone(`/cdn/public/pieces/${pieceId}/thumb`)).status).toBe(404)
  expect(await (await anyone('/api/public/profiles/nika.kovac')).json()).toMatchObject({ boards: [], pieces: null })
  await send(owner, '/api/profile/published', 'PUT', { published: false })
  expect((await anyone('/api/public/profiles/nika.kovac')).status).toBe(404)
}

const Feed = Schema.Struct({ items: Schema.Array(Schema.Struct({ _tag: Schema.String })) })

/** Saves, follows, the feed, blocks both ways and reports: what one person does with another's public things. */
const verifyPeople = async (origin: string, owner: Call, other: Call, reporters: ReadonlyArray<Call>) => {
  await send(owner, '/api/profile/published', 'PUT', { published: true })
  const boardId = await idOf(
    await send(owner, '/api/boards', 'POST', { operationId: 'native-social-9', name: 'Knits' }),
  )
  await send(owner, `/api/boards/${boardId}/visibility`, 'PUT', { visibility: 'public' })
  await send(other, '/api/profile', 'PATCH', { handle: 'luka.other', name: 'Luka' })
  await send(other, '/api/profile/published', 'PUT', { published: true })
  const board = { _tag: 'SavedBoard', boardId }
  await refusal(await send(owner, '/api/saved', 'PUT', { target: board, saved: true }), 422, 'NotWithYourself')
  expect(await (await send(other, '/api/saved', 'PUT', { target: board, saved: true })).json()).toEqual({ saved: true })
  expect(await (await other('/api/saved')).json()).toMatchObject({
    saved: [{ _tag: 'SavedBoard', board: { id: boardId, name: 'Knits' }, by: { handle: 'nika.kovac' } }],
  })
  const following = await send(other, '/api/people/nika.kovac/following', 'PUT', { following: true })
  expect(await following.json()).toEqual({ handle: 'nika.kovac', following: true, blocked: false })
  expect(await (await other('/api/following')).json()).toMatchObject({ people: [{ handle: 'nika.kovac' }] })
  const feed = Schema.decodeUnknownSync(Feed)(await (await other('/api/feed')).json())
  expect(feed.items.map(({ _tag }) => _tag)).toContain('BoardWentPublic')
  // A block hides each from the other, ends the follow and drops the save from view; signed out, all still shows.
  expect(await (await send(owner, '/api/people/luka.other/blocked', 'PUT', { blocked: true })).json()).toMatchObject({
    blocked: true,
  })
  expect((await other('/api/people/nika.kovac')).status).toBe(404)
  expect((await other('/api/public/profiles/nika.kovac')).status).toBe(404)
  expect((await fetch(`${origin}/api/public/profiles/nika.kovac`)).status).toBe(200)
  expect(await (await other('/api/following')).json()).toEqual({ people: [] })
  expect(await (await other('/api/saved')).json()).toEqual({ saved: [] })
  await send(owner, '/api/people/luka.other/blocked', 'PUT', { blocked: false })
  expect(await (await other('/api/saved')).json()).toMatchObject({ saved: [{ _tag: 'SavedBoard' }] })
  // Three people's reports hide the board from everyone; one's own cannot be reported.
  const reported = { target: { _tag: 'ReportedBoard', boardId }, reason: 'spam' }
  await refusal(await send(owner, '/api/reports', 'POST', reported), 422, 'NotWithYourself')
  for (const reporter of [other, ...reporters])
    expect((await send(reporter, '/api/reports', 'POST', reported)).status).toBe(204)
  expect((await fetch(`${origin}/api/public/boards/${boardId}`)).status).toBe(404)
  expect(await (await owner(`/api/boards/${boardId}`)).json()).toMatchObject({ check: { hidden: true } })
}

const Found = Schema.Struct({
  people: Schema.Array(Schema.Struct({ handle: Schema.String })),
  boards: Schema.Array(Schema.Struct({ board: Schema.Struct({ id: Schema.String }) })),
})
const Newest = Schema.Struct({ newest: Schema.Array(Schema.Struct({ board: Schema.Struct({ id: Schema.String }) })) })

/** Search and Explore, signed out: people by name and handle, boards by name; a board the check is unsure of stays
 * on its link and leaves discovery. */
const verifyDiscovery = async (origin: string, owner: Call) => {
  const boardId = await idOf(
    await send(owner, '/api/boards', 'POST', { operationId: 'native-social-10', name: 'Rainy walks' }),
  )
  await send(owner, `/api/boards/${boardId}/visibility`, 'PUT', { visibility: 'public' })
  const search = async (q: string) =>
    Schema.decodeUnknownSync(Found)(
      await (await fetch(`${origin}/api/public/search?q=${encodeURIComponent(q)}`)).json(),
    )
  expect((await search('kovač')).people.map(({ handle }) => handle)).toContain('nika.kovac')
  expect((await search('rainy')).boards.map(({ board }) => board.id)).toEqual([boardId])
  const newest = async (mood = '') =>
    Schema.decodeUnknownSync(Newest)(await (await fetch(`${origin}/api/public/explore${mood}`)).json()).newest.map(
      ({ board }) => board.id,
    )
  expect(await newest()).toContain(boardId)
  expect(
    await (await send(owner, `/api/boards/${boardId}`, 'PATCH', { moods: ['office', 'rain'] })).json(),
  ).toMatchObject({
    moods: ['office', 'rain'],
  })
  expect(await newest('?mood=office')).toContain(boardId)
  expect(await newest('?mood=sport')).not.toContain(boardId)
  await send(owner, `/api/boards/${boardId}`, 'PATCH', { name: 'Rainy walks [[unsure]]' })
  await settled(() => owner(`/api/boards/${boardId}`), 'unsure')
  expect((await search('rainy')).boards).toEqual([])
  expect((await fetch(`${origin}/api/public/boards/${boardId}`)).status).toBe(200)
}

/** Profiles and what other people may see of each account. */
export const verifySocial = async (origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-social`, { method: 'POST' })).status).toBe(204)
  const owner = client(origin, await signIn(origin, 'native-social'))
  const other = client(origin, await signIn(origin, 'native-social-other'))
  await verifyProfiles(origin, owner, other)
  await verifyChecks(origin, owner)
  await verifyPublicPages(origin, fixtures, owner)
  const third = client(origin, await signIn(origin, 'native-social-third'))
  const reporters = [third, client(origin, await signIn(origin, 'native-social-fourth'))]
  await verifyPeople(origin, owner, other, reporters)
  await verifyDiscovery(origin, owner)
}
