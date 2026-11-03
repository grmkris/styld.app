import { verifySignedImage } from './SignedMediaAcceptance.ts'
import { expect } from 'bun:test'
import { Schema } from 'effect'
import { Board, BoardImage, PieceItem, TextItem } from '@styld/protocol'
import { receivedPhoto } from './WardrobeAcceptance.ts'
import { type Call, client, seedAccounts, send, signIn } from './Accounts.ts'

/** Test-only acceptance: Gallery 2's boards, worn days and looks made on the website, through the public edge. */

const Identified = Schema.Struct({ id: Schema.String })
export const idOf = async (response: Response) => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Identified)(await response.json()).id
}

/** A piece added from a received photo: its id. */
export const addedPiece = async (origin: string, call: Call, operationId: string) =>
  idOf(
    await send(call, '/api/pieces', 'POST', {
      operationId,
      uploadId: await receivedPhoto(origin, call),
      type: 'tops',
    }),
  )

const itemId = (letter: string) => `bi_${letter.repeat(22)}`
const placement = { x: 500, y: 625, size: 320, turn: -4.5, flipped: false }

let saves = 0
/** Save a board's table from a version, each call under a fresh operation id. */
const putTable = (call: Call, boardId: string, version: number, items: ReadonlyArray<object>) => {
  saves += 1
  return send(call, `/api/boards/${boardId}/items`, 'PUT', { operationId: `native-table-${saves}`, version, items })
}

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
  const save = { operationId: 'native-table-first', version: 0, items }
  const saved = await send(owner, path, 'PUT', save)
  expect(saved.status).toBe(200)
  // Placing a piece pins it on the board.
  expect(await saved.json()).toMatchObject({
    id: boardId,
    version: 1,
    items,
    pins: [{ _tag: 'PiecePin', piece: { id: pieceId } }],
  })
  // The same save again answers the board as it is; the same operation id for another table is a conflict.
  expect(await (await send(owner, path, 'PUT', save)).json()).toMatchObject({ version: 1, items })
  expect((await send(owner, path, 'PUT', { ...save, items: [] })).status).toBe(409)
  const stale = await putTable(owner, boardId, 0, [])
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ _tag: 'BoardVersionConflict', version: 1 })
  const refusal = async (table: ReadonlyArray<object>, reason: string) => {
    const refused = await putTable(owner, boardId, 1, table)
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
  const answers = await Promise.all(tables.map((items) => putTable(owner, boardId, version, items)))
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
  const result = Schema.decodeUnknownSync(BoardImage)(await added.json())
  const { imageId, image } = result
  expect(image).toBeDefined()
  expect(await (await send(owner, path, 'POST', add)).json()).toEqual(result)
  expect((await send(owner, path, 'POST', { ...add, uploadId: await receivedPhoto(origin, owner) })).status).toBe(409)
  const again = await send(owner, path, 'POST', { ...add, operationId: 'native-board-image-2' })
  expect(await again.json()).toMatchObject({ _tag: 'UploadRefused', reason: 'alreadyUsed' })
  // Another account can neither add to the board nor use the upload.
  expect((await send(other, path, 'POST', { ...add, operationId: 'native-board-image-3' })).status).toBe(404)

  await verifySignedImage(origin, image?.thumb ?? '')
  expect((await fetch(`${origin}/cdn/boards/images/${imageId}/thumb`)).status).toBe(404)
  return { imageId, uploadId: add.uploadId, full: image?.full ?? '' }
}

const Pinned = Schema.Struct({
  version: Schema.Int,
  items: Schema.Array(Schema.Struct({ _tag: Schema.String })),
  pins: Schema.Array(
    Schema.Struct({
      _tag: Schema.String,
      id: Schema.String,
      piece: Schema.optionalKey(Identified),
      look: Schema.optionalKey(Identified),
      imageId: Schema.optionalKey(Schema.String),
    }),
  ),
})
const pinnedOf = async (response: Response) => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Pinned)(await response.json())
}
/** What a board's pins hold, newest first. */
const held = (board: typeof Pinned.Type) =>
  board.pins.map((pin) => pin.piece?.id ?? pin.look?.id ?? pin.imageId ?? pin.id)

/** Pins: the account's pieces and looks pinned once each per operation, newest first, without moving the
 * table's version; a piece placed on the table is pinned with it; taking a pin off takes its piece off the
 * table, and a picture taken off is deleted with its bytes. */
const verifyPins = async (
  origin: string,
  fixtures: string,
  accounts: { readonly owner: Call; readonly other: Call },
  boardId: string,
  ids: {
    readonly pieceId: string
    readonly secondPieceId: string
    readonly strangerPieceId: string
    readonly imageId: string
  },
) => {
  const { owner, other } = accounts
  const { pieceId, secondPieceId, strangerPieceId, imageId } = ids
  const path = `/api/boards/${boardId}/pins`
  const before = await pinnedOf(await owner(`/api/boards/${boardId}`))
  expect(held(before)).toEqual([imageId, pieceId])

  const pin = { operationId: 'native-pins-0001', pieceIds: [secondPieceId, pieceId] }
  const pinned = await pinnedOf(await send(owner, path, 'POST', pin))
  expect(held(pinned)).toEqual([secondPieceId, imageId, pieceId])
  expect(pinned.version).toBe(before.version)
  expect(held(await pinnedOf(await send(owner, path, 'POST', pin)))).toEqual(held(pinned))
  expect((await send(owner, path, 'POST', { ...pin, pieceIds: [pieceId] })).status).toBe(409)
  const refused = async (body: object, reason: string) => {
    const answer = await send(owner, path, 'POST', body)
    expect(answer.status).toBe(422)
    expect(await answer.json()).toMatchObject({ _tag: 'PinRefused', reason })
  }
  await refused({ operationId: 'native-pins-0002', pieceIds: [strangerPieceId] }, 'pieceNotFound')
  await refused({ operationId: 'native-pins-0003', pieceIds: [] }, 'nothingToPin')
  await refused({ operationId: 'native-pins-0004', lookIds: [`lk_${'z'.repeat(22)}`] }, 'lookNotFound')

  const lookId = await idOf(
    await send(owner, '/api/looks', 'POST', { operationId: 'native-pins-look', name: 'Pinned', pieceIds: [pieceId] }),
  )
  const withLook = await pinnedOf(
    await send(owner, path, 'POST', { operationId: 'native-pins-0005', lookIds: [lookId] }),
  )
  expect(held(withLook)).toEqual([lookId, secondPieceId, imageId, pieceId])

  // A second picture, placed with the second piece, then both taken off.
  const add = { operationId: 'native-pins-image', uploadId: await receivedPhoto(origin, owner) }
  const { imageId: pictureId, image: picture } = Schema.decodeUnknownSync(BoardImage)(
    await (await send(owner, `/api/boards/${boardId}/images`, 'POST', add)).json(),
  )
  const table = [
    { _tag: 'PieceItem', id: itemId('p'), ...placement, z: 1, pieceId: secondPieceId },
    { _tag: 'ImageItem', id: itemId('q'), ...placement, z: 2, imageId: pictureId },
  ]
  const placed = await pinnedOf(await putTable(owner, boardId, withLook.version, table))
  expect(placed.items).toHaveLength(2)
  expect(held(placed)).toEqual([pictureId, lookId, secondPieceId, imageId, pieceId])
  const off = placed.pins.filter((each) => each.piece?.id === secondPieceId || each.imageId === pictureId)
  const removal = { operationId: 'native-pins-off', pinIds: off.map((each) => each.id) }
  const removed = await pinnedOf(await send(owner, `${path}/remove`, 'POST', removal))
  expect(removed.items).toEqual([])
  expect(removed.version).toBe(placed.version + 1)
  expect(held(removed)).toEqual([lookId, imageId, pieceId])
  expect(held(await pinnedOf(await send(owner, `${path}/remove`, 'POST', removal)))).toEqual(held(removed))
  expect((await fetch(new URL(picture?.full ?? '', origin))).status).toBe(404)
  const key = `accounts/native-boards/uploads/${add.uploadId}`
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: false })
  expect((await send(other, `${path}/remove`, 'POST', { ...removal, operationId: 'native-pins-y' })).status).toBe(404)
  expect(await (await owner('/api/boards')).json()).toMatchObject({ boards: [{ id: boardId, pinCount: 3 }] })
}

/** Saving from elsewhere places pieces immediately and preserves the existing layout, even on retry. */
const verifyPlacedPins = async (
  owner: Call,
  other: Call,
  boardId: string,
  pieceId: string,
  secondPieceId: string,
  strangerPieceId: string,
) => {
  const before = Schema.decodeUnknownSync(Board)(await (await owner(`/api/boards/${boardId}`)).json())
  const label = { _tag: 'TextItem', id: itemId('s'), ...placement, z: 1, text: 'Keep this layout', style: 'label' }
  const initial = Schema.decodeUnknownSync(Board)(
    await (await putTable(owner, boardId, before.version, [label])).json(),
  )
  const lookId = await idOf(
    await send(owner, '/api/looks', 'POST', { name: 'Board placement', pieceIds: [pieceId, secondPieceId] }),
  )
  const input = { operationId: 'native-place-pins-1', pieceIds: [pieceId], lookIds: [lookId], placeOnTable: true }
  const path = `/api/boards/${boardId}/pins`
  const answers = await Promise.all([send(owner, path, 'POST', input), send(owner, path, 'POST', input)])
  expect(answers.map((answer) => answer.status)).toEqual([200, 200])
  const placed = Schema.decodeUnknownSync(Board)(await answers[0]?.json())
  expect(placed.version).toBe(initial.version + 1)
  expect(placed.items).toHaveLength(3)
  expect(Schema.decodeUnknownSync(TextItem)(placed.items[0])).toEqual(Schema.decodeUnknownSync(TextItem)(label))
  expect(
    placed.items
      .filter(Schema.is(PieceItem))
      .map((item) => String(item.pieceId))
      .toSorted(),
  ).toEqual([pieceId, secondPieceId].toSorted())
  expect(placed.items.map((item) => item.z)).toEqual([1, 2, 3])
  expect(
    (
      await send(owner, `/api/boards/${boardId}/items`, 'PUT', {
        operationId: 'native-place-stale',
        version: initial.version,
        items: [],
      })
    ).status,
  ).toBe(409)
  const again = Schema.decodeUnknownSync(Board)(
    await (await send(owner, path, 'POST', { ...input, operationId: 'native-place-pins-2' })).json(),
  )
  expect(again.items).toEqual(placed.items)
  expect(
    (
      await send(owner, path, 'POST', {
        ...input,
        operationId: 'native-place-foreign-piece',
        pieceIds: [strangerPieceId],
        lookIds: [],
      })
    ).status,
  ).toBe(422)
  expect((await send(other, path, 'POST', input)).status).toBe(404)
  expect((await send(owner, path, 'POST', { ...input, placeOnTable: false })).status).toBe(409)
}

/** Boards: created once per operation, listed, saved whole with a version, renamed, given pictures, private to
 * their owner, and deleted with their pictures' bytes. */
const verifyBoards = async (
  origin: string,
  fixtures: string,
  accounts: { readonly owner: Call; readonly other: Call },
  pieces: { readonly pieceId: string; readonly secondPieceId: string; readonly strangerPieceId: string },
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

  const { imageId, uploadId, full } = await addPicture(origin, owner, other, boardId)
  const table = [...items, { _tag: 'ImageItem', id: itemId('c'), ...placement, z: 2, imageId }]
  const saved = await putTable(owner, boardId, 1, table)
  expect(await saved.json()).toMatchObject({ version: 2, items: table })
  expect(await (await owner('/api/boards')).json()).toMatchObject({ boards: [{ id: boardId, pinCount: 2 }] })
  await raceSaves(owner, boardId, 2, [table, items])
  await raceSaves(owner, boardId, 3, [[], []])
  await verifyPins(origin, fixtures, { owner, other }, boardId, { ...pieces, imageId })

  await verifyPlacedPins(owner, other, boardId, pieces.pieceId, pieces.secondPieceId, pieces.strangerPieceId)

  // Another account cannot see, change or delete the board.
  expect(await (await other('/api/boards')).json()).toEqual({ boards: [] })
  expect((await other(`/api/boards/${boardId}`)).status).toBe(404)
  expect((await send(other, `/api/boards/${boardId}`, 'PATCH', { name: 'Mine now' })).status).toBe(404)
  expect((await putTable(other, boardId, 2, [])).status).toBe(404)
  expect(
    (await send(other, `/api/boards/${boardId}/pins`, 'POST', { operationId: 'native-pins-x', pieceIds: [] })).status,
  ).toBe(404)
  expect((await other(`/api/boards/${boardId}`, { method: 'DELETE' })).status).toBe(404)

  const key = `accounts/native-boards/uploads/${uploadId}`
  expect(await (await fetch(`${fixtures}/test/identity/media?key=${key}`)).json()).toEqual({ exists: true })
  expect((await owner(`/api/boards/${boardId}`, { method: 'DELETE' })).status).toBe(204)
  expect((await owner(`/api/boards/${boardId}`)).status).toBe(404)
  expect((await fetch(new URL(full, origin))).status).toBe(404)
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
  const { looks } = Schema.decodeUnknownSync(Schema.Struct({ looks: Schema.Array(Identified) }))(
    await (await owner('/api/looks')).json(),
  )
  expect(looks.map(({ id }) => id)).toContain(lookId)
  // The piece's page lists the looks it is in; a piece that is not the person's is in none of theirs.
  const inLooks = Schema.decodeUnknownSync(Schema.Struct({ looks: Schema.Array(Identified) }))
  const ofPiece = inLooks(await (await owner(`/api/pieces/${pieceId}/looks`)).json())
  expect(ofPiece.looks.map(({ id }) => id)).toContain(lookId)
  expect(inLooks(await (await owner(`/api/pieces/${strangerPieceId}/looks`)).json()).looks).toEqual([])
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
  await seedAccounts(fixtures, 'native-boards', 'native-boards-other')
  const cookie = await signIn(origin, 'native-boards')
  const owner = client(origin, cookie)
  const other = client(origin, await signIn(origin, 'native-boards-other'))
  const pieceId = await addedPiece(origin, owner, 'native-board-piece-1')
  const secondPieceId = await addedPiece(origin, owner, 'native-board-piece-2')
  const strangerPieceId = await addedPiece(origin, other, 'native-board-piece-3')
  await verifyBoards(origin, fixtures, { owner, other }, { pieceId, secondPieceId, strangerPieceId })
  await verifyWebLook(origin, cookie, pieceId, strangerPieceId)
  await verifyWorn(owner, other, [pieceId, secondPieceId], strangerPieceId)
  await verifyAccountDeletion(origin, fixtures, owner, pieceId)
}
