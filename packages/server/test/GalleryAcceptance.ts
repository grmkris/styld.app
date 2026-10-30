import { expect } from 'bun:test'
import { Schema } from 'effect'
import { type Call, client, receivedPhoto, signIn } from './WardrobeAcceptance.ts'

/** Test-only acceptance: Gallery 2's boards, worn days and looks made on the website, through the public edge. */

const send = (call: Call, path: string, method: string, body: unknown) =>
  call(path, { method, body: JSON.stringify(body) })

const Identified = Schema.Struct({ id: Schema.String })
const idOf = async (response: Response) => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Identified)(await response.json()).id
}

/** A piece added from a received photo: its id. */
const addedPiece = async (origin: string, call: Call, operationId: string) =>
  idOf(
    await send(call, '/api/pieces', 'POST', {
      operationId,
      uploadId: await receivedPhoto(origin, call),
      category: 'top',
    }),
  )

const itemId = (letter: string) => `bi_${letter.repeat(22)}`
const placement = { x: 500, y: 625, size: 320, turn: -4.5, flipped: false }

/** A table is saved whole from the version its editor loaded; a stale version, another account's piece, a
 * picture that is not on the board and a repeated id are refused, and nothing changes. */
const saveTables = async (owner: Call, boardId: string, pieceId: string, strangerPieceId: string) => {
  const pieceItem = { _tag: 'PieceItem', id: itemId('a'), ...placement, z: 0, pieceId }
  const textItem = {
    _tag: 'TextItem',
    id: itemId('b'),
    ...placement,
    z: 1,
    flipped: true,
    text: 'Weekend',
    style: 'headline',
  }
  const items = [pieceItem, textItem]
  const path = `/api/boards/${boardId}/items`
  const saved = await send(owner, path, 'PUT', { version: 0, items })
  expect(saved.status).toBe(200)
  expect(await saved.json()).toMatchObject({ id: boardId, version: 1, items })
  const stale = await send(owner, path, 'PUT', { version: 0, items: [] })
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ _tag: 'BoardVersionConflict', version: 1 })
  const refusal = async (table: ReadonlyArray<object>, reason: string) => {
    const refused = await send(owner, path, 'PUT', { version: 1, items: table })
    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ _tag: 'BoardItemRefused', reason })
  }
  await refusal([{ ...pieceItem, pieceId: strangerPieceId }], 'pieceNotFound')
  await refusal([pieceItem, { ...textItem, id: itemId('a') }], 'duplicateId')
  await refusal(
    [{ _tag: 'ImageItem', id: itemId('c'), ...placement, z: 2, imageId: `bm_${'z'.repeat(22)}` }],
    'imageNotFound',
  )
  expect(await (await owner(`/api/boards/${boardId}`)).json()).toMatchObject({ version: 1, items })
  return items
}

/** Two editors save from the same version at once: exactly one table lands, and the other save learns the new
 * version, whether it lost before or inside its write. */
const raceSaves = async (
  owner: Call,
  boardId: string,
  version: number,
  tables: readonly [ReadonlyArray<object>, ReadonlyArray<object>],
) => {
  const path = `/api/boards/${boardId}/items`
  const answers = await Promise.all(tables.map((items) => send(owner, path, 'PUT', { version, items })))
  expect(answers.map(({ status }) => status).toSorted((a, b) => a - b)).toEqual([200, 409])
  const won = answers.findIndex(({ status }) => status === 200)
  expect(await answers[1 - won]?.json()).toMatchObject({ _tag: 'BoardVersionConflict', version: version + 1 })
  expect(await (await owner(`/api/boards/${boardId}`)).json()).toMatchObject({
    version: version + 1,
    items: tables[won] ?? [],
  })
}

/** A received photo becomes a picture on the board once per operation, shown only to its owner. */
const addPicture = async (origin: string, owner: Call, other: Call, boardId: string) => {
  const add = { operationId: 'native-board-image-1', uploadId: await receivedPhoto(origin, owner) }
  const path = `/api/boards/${boardId}/images`
  const added = await send(owner, path, 'POST', add)
  expect(added.status).toBe(200)
  const { imageId } = Schema.decodeUnknownSync(Schema.Struct({ imageId: Schema.String }))(await added.json())
  expect(await (await send(owner, path, 'POST', add)).json()).toEqual({ imageId })
  expect((await send(owner, path, 'POST', { ...add, uploadId: await receivedPhoto(origin, owner) })).status).toBe(409)
  const again = await send(owner, path, 'POST', { ...add, operationId: 'native-board-image-2' })
  expect(await again.json()).toMatchObject({ _tag: 'UploadRefused', reason: 'alreadyUsed' })
  // Another account can neither add to the board nor use the upload.
  expect((await send(other, path, 'POST', { ...add, operationId: 'native-board-image-3' })).status).toBe(404)

  const thumb = await owner(`/cdn/boards/images/${imageId}/thumb`)
  expect(thumb.status).toBe(200)
  expect(thumb.headers.get('content-type')).toMatch(/^image\//)
  expect(thumb.headers.get('cache-control')).toContain('private')
  const etag = thumb.headers.get('etag') ?? ''
  expect((await owner(`/cdn/boards/images/${imageId}/thumb`, { headers: { 'if-none-match': etag } })).status).toBe(304)
  expect((await other(`/cdn/boards/images/${imageId}/thumb`)).status).toBe(404)
  expect((await other(`/cdn/boards/images/${imageId}/full`)).status).toBe(404)
  expect((await fetch(`${origin}/cdn/boards/images/${imageId}/thumb`)).status).toBe(401)
  return { imageId, uploadId: add.uploadId }
}

/** Boards: created once per operation, listed, saved whole with a version, renamed, given pictures, private to
 * their owner, and deleted with their pictures' bytes. */
const verifyBoards = async (
  origin: string,
  fixtures: string,
  accounts: { readonly owner: Call; readonly other: Call },
  pieces: { readonly pieceId: string; readonly strangerPieceId: string },
) => {
  const { owner, other } = accounts
  expect((await fetch(`${origin}/api/boards`)).status).toBe(401)
  expect(await (await owner('/api/boards')).json()).toEqual({ boards: [] })
  const create = { operationId: 'native-board-0001', name: 'Autumn' }
  const created = await send(owner, '/api/boards', 'POST', create)
  const createdBody: unknown = await created.clone().json()
  expect(createdBody).toMatchObject({ name: 'Autumn', paper: 'paper', version: 0, items: [] })
  const boardId = await idOf(created)
  expect(await idOf(await send(owner, '/api/boards', 'POST', create))).toBe(boardId)
  expect((await send(owner, '/api/boards', 'POST', { ...create, name: 'Winter' })).status).toBe(409)

  const items = await saveTables(owner, boardId, pieces.pieceId, pieces.strangerPieceId)
  const renamed = await send(owner, `/api/boards/${boardId}`, 'PATCH', { name: 'Late autumn', paper: 'sage' })
  expect(await renamed.json()).toMatchObject({ name: 'Late autumn', paper: 'sage', version: 1, items })

  const { imageId, uploadId } = await addPicture(origin, owner, other, boardId)
  const table = [...items, { _tag: 'ImageItem', id: itemId('c'), ...placement, z: 2, imageId }]
  const saved = await send(owner, `/api/boards/${boardId}/items`, 'PUT', { version: 1, items: table })
  expect(await saved.json()).toMatchObject({ version: 2, items: table })
  expect(await (await owner('/api/boards')).json()).toMatchObject({ boards: [{ id: boardId, version: 2 }] })
  await raceSaves(owner, boardId, 2, [table, items])
  await raceSaves(owner, boardId, 3, [[], []])

  // Another account cannot see, change or delete the board.
  expect(await (await other('/api/boards')).json()).toEqual({ boards: [] })
  expect((await other(`/api/boards/${boardId}`)).status).toBe(404)
  expect((await send(other, `/api/boards/${boardId}`, 'PATCH', { name: 'Mine now' })).status).toBe(404)
  expect((await send(other, `/api/boards/${boardId}/items`, 'PUT', { version: 2, items: [] })).status).toBe(404)
  expect((await other(`/api/boards/${boardId}`, { method: 'DELETE' })).status).toBe(404)

  const key = `accounts/native-boards/uploads/${uploadId}`
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: true })
  expect((await owner(`/api/boards/${boardId}`, { method: 'DELETE' })).status).toBe(204)
  expect((await owner(`/api/boards/${boardId}`)).status).toBe(404)
  expect((await owner(`/cdn/boards/images/${imageId}/thumb`)).status).toBe(404)
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: false })

  // Two copies of one create at once make one board.
  const twice = { operationId: 'native-board-0002', name: 'Twice' }
  const copies = await Promise.all([
    send(owner, '/api/boards', 'POST', twice),
    send(owner, '/api/boards', 'POST', twice),
  ])
  expect(new Set(await Promise.all(copies.map(idOf))).size).toBe(1)
  expect(await (await owner('/api/boards')).json()).toMatchObject({ boards: [{ name: 'Twice' }] })
}

/** Worn days: "Wear this" replaces a day's outfit with the account's own pieces, a range reads the days in it,
 * a day clears, and a deleted piece leaves the days it was worn. */
const verifyWorn = async (owner: Call, other: Call, pieceIds: ReadonlyArray<string>, strangerPieceId: string) => {
  const [first = '', second = ''] = pieceIds
  const october = '/api/worn?from=2026-10-01&to=2026-10-31'
  expect(await (await owner(october)).json()).toEqual({ days: [] })
  const worn = await send(owner, '/api/worn/2026-10-30', 'PUT', { pieceIds: [first, second] })
  expect(await worn.json()).toEqual({ day: '2026-10-30', pieceIds: [first, second] })
  const foreign = await send(owner, '/api/worn/2026-10-29', 'PUT', { pieceIds: [first, strangerPieceId] })
  expect(foreign.status).toBe(404)
  expect((await send(owner, '/api/worn/2026-10-28', 'PUT', { pieceIds: [second] })).status).toBe(200)
  expect((await send(owner, '/api/worn/2026-10-30', 'PUT', { pieceIds: [second, first] })).status).toBe(200)
  expect(await (await owner(october)).json()).toEqual({
    days: [
      { day: '2026-10-28', pieceIds: [second] },
      { day: '2026-10-30', pieceIds: [second, first] },
    ],
  })
  // Both ends are included; a range that runs backwards or spans more than 62 days reads as none.
  expect(await (await owner('/api/worn?from=2026-10-30&to=2026-10-30')).json()).toMatchObject({ days: [{}] })
  expect(await (await owner('/api/worn?from=2026-10-31&to=2026-10-01')).json()).toEqual({ days: [] })
  expect(await (await owner('/api/worn?from=2026-08-01&to=2026-10-31')).json()).toEqual({ days: [] })
  expect(await (await other(october)).json()).toEqual({ days: [] })
  expect((await owner('/api/worn/2026-10-30', { method: 'DELETE' })).status).toBe(204)
  expect((await owner(`/api/pieces/${second}`, { method: 'DELETE' })).status).toBe(204)
  expect(await (await owner(october)).json()).toEqual({ days: [] })
}

/** A look the website makes from a board or today's table: once per operation, from the account's own pieces,
 * and only when the website itself asks. */
const verifyWebLook = async (origin: string, cookie: string, pieceId: string, strangerPieceId: string) => {
  const owner = client(origin, cookie)
  const create = { operationId: 'native-web-look-1', name: 'Board look', pieceIds: [pieceId] }
  const created = await send(owner, '/api/looks', 'POST', create)
  const createdBody: unknown = await created.clone().json()
  expect(createdBody).toMatchObject({ name: 'Board look', occasion: null, pieces: [{ id: pieceId }] })
  const lookId = await idOf(created)
  expect(await idOf(await send(owner, '/api/looks', 'POST', create))).toBe(lookId)
  expect((await send(owner, '/api/looks', 'POST', { ...create, name: 'Other' })).status).toBe(409)
  const foreign = { ...create, operationId: 'native-web-look-2', pieceIds: [strangerPieceId] }
  expect((await send(owner, '/api/looks', 'POST', foreign)).status).toBe(404)
  const unadmitted = await fetch(`${origin}/api/looks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ ...create, operationId: 'native-web-look-3' }),
  })
  expect(unadmitted.status).toBe(403)
  expect(await (await owner('/api/looks')).json()).toMatchObject({ looks: [{ id: lookId }] })
}

/** Deleting the account takes its boards, pictures and worn days with it, the pictures' bytes included. */
const verifyAccountDeletion = async (origin: string, fixtures: string, owner: Call, pieceId: string) => {
  const { boards } = Schema.decodeUnknownSync(Schema.Struct({ boards: Schema.Array(Identified) }))(
    await (await owner('/api/boards')).json(),
  )
  const boardId = boards[0]?.id ?? ''
  const uploadId = await receivedPhoto(origin, owner)
  const add = { operationId: 'native-board-image-9', uploadId }
  expect((await send(owner, `/api/boards/${boardId}/images`, 'POST', add)).status).toBe(200)
  expect((await send(owner, '/api/worn/2026-10-31', 'PUT', { pieceIds: [pieceId] })).status).toBe(200)
  const key = `accounts/native-boards/uploads/${uploadId}`
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: true })
  expect((await owner('/api/me', { method: 'DELETE' })).status).toBe(204)
  expect((await owner('/api/boards')).status).toBe(401)
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: false })
}

/** Gallery 2 on the server: boards, worn days and looks made on the website, each private to its account. */
export const verifyGallery = async (origin: string, fixtures: string): Promise<void> => {
  expect((await fetch(`${fixtures}/test/identity/seed-boards`, { method: 'POST' })).status).toBe(204)
  const cookie = await signIn(origin, 'native-boards')
  const owner = client(origin, cookie)
  const other = client(origin, await signIn(origin, 'native-boards-other'))
  const pieceId = await addedPiece(origin, owner, 'native-board-piece-1')
  const secondPieceId = await addedPiece(origin, owner, 'native-board-piece-2')
  const strangerPieceId = await addedPiece(origin, other, 'native-board-piece-3')
  await verifyBoards(origin, fixtures, { owner, other }, { pieceId, strangerPieceId })
  await verifyWebLook(origin, cookie, pieceId, strangerPieceId)
  await verifyWorn(owner, other, [pieceId, secondPieceId], strangerPieceId)
  await verifyAccountDeletion(origin, fixtures, owner, pieceId)
}
