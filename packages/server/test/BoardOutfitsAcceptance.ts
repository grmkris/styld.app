import { expect } from 'bun:test'
import { Schema } from 'effect'
import {
  Board,
  type BoardOutfit,
  boardHeight,
  boardWidth,
  KeptLook,
  layoutFor,
  LookPin,
  Looks,
  outfitKeyOf,
  outfitsIn,
  PieceItem,
  PiecePin,
} from '@styld/protocol'
import { type Call, client, seedAccounts, send, signIn } from './Accounts.ts'
import { addedPiece } from './GalleryAcceptance.ts'
import { ready } from './OutfitAcceptance.ts'

/** Test-only acceptance: outfits put together on a board and kept as looks pinned on it (T-16), through the public
 * edge. */

const keptOf = async (response: Response) => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(KeptLook)(await response.json())
}

const boardOf = async (response: Response) => {
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Board)(await response.json())
}

const looksOf = async (owner: Call) => {
  const response = await owner('/api/looks')
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Looks)(await response.json()).looks
}

/** The ids of the looks pinned on a board. */
const pinnedLooks = (board: Board) => board.pins.filter(Schema.is(LookPin)).map((pin) => pin.look.id)

/** Keep: the look and its pin are made together, once per operation id; another account's piece or board is not
 * found and leaves nothing behind; deleting the look unpins it and spends the id. */
const verifyKeep = async (
  { owner, other }: { readonly owner: Call; readonly other: Call },
  { pieceIds, strangerPieceId }: { readonly pieceIds: ReadonlyArray<string>; readonly strangerPieceId: string },
) => {
  const board = await boardOf(
    await send(owner, '/api/boards', 'POST', { operationId: 'native-keep-board', name: 'Weekend' }),
  )
  const path = `/api/boards/${board.id}/looks`
  const keep = { operationId: 'native-keep-0001', name: 'Weekend · 1', pieceIds }
  const kept = await keptOf(await send(owner, path, 'POST', keep))
  expect(kept.look).toMatchObject({ name: 'Weekend · 1', shared: false })
  const keptPieces: ReadonlyArray<string> = kept.look.pieces.map(({ id }) => id)
  expect(keptPieces).toEqual(pieceIds)
  expect(pinnedLooks(kept.board)).toEqual([kept.look.id])
  expect((await looksOf(owner)).map(({ id }) => id)).toEqual([kept.look.id])

  // A repeat answers the same look and makes nothing more; the id used for another keep is a conflict.
  const again = await keptOf(await send(owner, path, 'POST', keep))
  expect(again.look.id).toBe(kept.look.id)
  expect(pinnedLooks(again.board)).toEqual([kept.look.id])
  expect((await send(owner, path, 'POST', { ...keep, name: 'Other' })).status).toBe(409)

  // Another account's piece, or the owner's board kept by someone else, is not found, and nothing is made.
  const stranger = { operationId: 'native-keep-0002', name: 'Mixed', pieceIds: [...pieceIds, strangerPieceId] }
  expect((await send(owner, path, 'POST', stranger)).status).toBe(404)
  const intruder = { operationId: 'native-keep-0003', name: 'Theirs', pieceIds: [strangerPieceId] }
  expect((await send(other, path, 'POST', intruder)).status).toBe(404)
  expect((await looksOf(owner)).map(({ id }) => id)).toEqual([kept.look.id])
  expect(await looksOf(other)).toEqual([])

  // Kept from a proposal of the outfit engine: counted, and kept like any other.
  const proposal = { session: `os_${'p'.repeat(22)}`, mode: 'fast', position: 2, edited: false }
  const proposed = await keptOf(
    await send(owner, path, 'POST', { operationId: 'native-keep-0004', name: 'Weekend · 2', pieceIds, proposal }),
  )
  expect(pinnedLooks(proposed.board)).toEqual([proposed.look.id, kept.look.id])

  // Deleting the look unpins it; the keep that made it cannot make it again.
  const deleted = await send(owner, `/api/looks/${kept.look.id}`, 'DELETE', { operationId: 'native-keep-delete' })
  expect(deleted.status).toBe(204)
  expect(pinnedLooks(await boardOf(await owner(`/api/boards/${board.id}`)))).toEqual([proposed.look.id])
  expect((await send(owner, path, 'POST', keep)).status).toBe(409)
}

/** The pieces of a ready wardrobe for outfits around a pair of jeans, by kind. */
interface Wardrobe {
  readonly jeans: string
  readonly tops: ReadonlyArray<string>
  readonly shoes: ReadonlyArray<string>
  readonly accessories: ReadonlyArray<string>
}

/** An outfit around the jeans is complete: the jeans, one top, one pair of shoes (always: Eva, 4 November 2026) and one
 * to three accessories. */
const expectComplete = (outfit: BoardOutfit, wardrobe: Wardrobe) => {
  const ids: ReadonlyArray<string> = outfit.pieces.map(({ id }) => id)
  expect(ids).toContain(wardrobe.jeans)
  expect(ids.filter((id) => wardrobe.tops.includes(id))).toHaveLength(1)
  expect(ids.filter((id) => wardrobe.shoes.includes(id))).toHaveLength(1)
  const accessories = ids.filter((id) => wardrobe.accessories.includes(id)).length
  expect(accessories).toBeGreaterThanOrEqual(1)
  expect(accessories).toBeLessThanOrEqual(3)
}

const keyOf = (outfit: BoardOutfit) => outfitKeyOf(outfit.pieces.map(({ id }) => id))
const outfitsOf = (board: Board) => board.outfitsAround?.outfits ?? []
const anchorsOn = (board: Board, anchorId: string) =>
  board.items.filter((item) => Schema.is(PieceItem)(item) && item.pieceId === anchorId).length

/** The table of a template board in its layout: the anchor large in the centre, the largest thing on it, then once in
 * every outfit; every piece of every outfit on it. */
const expectLaidOut = (board: Board, anchorId: string) => {
  const outfits = outfitsOf(board)
  expect(anchorsOn(board, anchorId)).toBe(outfits.length + 1)
  expect(board.items).toHaveLength(outfits.reduce((sum, outfit) => sum + outfit.pieces.length, 0) + 1)
  const largest = board.items.toSorted((a, b) => b.size - a.size)[0]
  expect(largest).toMatchObject({ pieceId: anchorId, x: boardWidth / 2, y: boardHeight / 2 })
}

/** "One piece, many outfits" (T-10): with no bottom in the wardrobe a top makes no board and says what is missing;
 * around the jeans as many complete outfits as the board's layout holds are laid out on sand paper, once per operation
 * id, the jeans large in the centre and in each cluster; another account's piece is not found. */
const verifyOutfitBoard = async (origin: string, { owner, other }: { readonly owner: Call; readonly other: Call }) => {
  const tee = await ready(origin, owner, 'native-ob-tee', 'shortSleeveTops')
  const trainers = await ready(origin, owner, 'native-ob-trainers', 'trainers')
  const lonely = await send(owner, '/api/boards/outfits', 'POST', {
    operationId: 'native-ob-none',
    name: 'Tee: six outfits',
    anchorPieceId: tee,
  })
  expect(lonely.status).toBe(422)
  expect(await lonely.json()).toMatchObject({ _tag: 'OutfitRefused', reason: 'noOutfits', missing: ['bottom'] })
  const wardrobe: Wardrobe = {
    jeans: await ready(origin, owner, 'native-ob-jeans', 'jeans'),
    tops: [tee, await ready(origin, owner, 'native-ob-shirt', 'shirts')],
    shoes: [trainers, await ready(origin, owner, 'native-ob-boots', 'boots')],
    accessories: [
      await ready(origin, owner, 'native-ob-bag', 'bags'),
      await ready(origin, owner, 'native-ob-belt', 'belts'),
      await ready(origin, owner, 'native-ob-ring', 'jewellery'),
    ],
  }
  const create = { operationId: 'native-ob-board', name: 'Jeans: outfits', anchorPieceId: wardrobe.jeans }
  const board = await boardOf(await send(owner, '/api/boards/outfits', 'POST', create))
  expect<string | undefined>(board.outfitsAround?.anchor?.id).toBe(wardrobe.jeans)
  // The layout is the operation's chance: six in a ring for this id.
  expect(board.outfitsAround?.layout).toBe(layoutFor(create.operationId))
  expect(board.outfitsAround?.layout).toBe('ring')
  expect(outfitsOf(board)).toHaveLength(outfitsIn('ring'))
  for (const outfit of outfitsOf(board)) expectComplete(outfit, wardrobe)
  expect(new Set(outfitsOf(board).map(keyOf)).size).toBe(outfitsIn('ring'))
  expect(board.paper).toBe('sand')
  expectLaidOut(board, wardrobe.jeans)
  const pinned = new Set(board.pins.filter(Schema.is(PiecePin)).map((pin) => pin.piece.id))
  for (const outfit of outfitsOf(board)) for (const { id } of outfit.pieces) expect(pinned.has(id)).toBe(true)
  // A repeat answers the same board; another account's piece is not found.
  expect((await boardOf(await send(owner, '/api/boards/outfits', 'POST', create))).id).toBe(board.id)
  const theirs = { ...create, operationId: 'native-ob-theirs' }
  expect((await send(other, '/api/boards/outfits', 'POST', theirs)).status).toBe(404)
  return { board, wardrobe }
}

/** Another outfit in place of one, none of those shown, its cluster replaced where it was even after the table was
 * saved by hand; a kept outfit is a look and stays; deleting the look makes it keepable again; deleting the jeans
 * leaves the board without its anchor; deleting the board removes it. */
const verifyOutfitCards = async (owner: Call, start: { readonly board: Board; readonly wardrobe: Wardrobe }) => {
  const { wardrobe } = start
  const path = `/api/boards/${start.board.id}`
  const [first, second, third] = outfitsOf(start.board)
  if (first === undefined || second === undefined || third === undefined) throw new Error('Six outfits were made')
  const shown = outfitsOf(start.board).map(keyOf)
  const another = await boardOf(
    await send(owner, `${path}/outfits/${second.id}/another`, 'POST', { operationId: 'native-ob-another', seen: [] }),
  )
  const replaced = outfitsOf(another).find(({ id }) => id === second.id)
  if (replaced === undefined) throw new Error('The outfit keeps its place')
  expectComplete(replaced, wardrobe)
  expect(shown).not.toContain(keyOf(replaced))
  expect(another.version).toBe(start.board.version + 1)
  expectLaidOut(another, wardrobe.jeans)

  // A save of the table by hand keeps each item in its cluster: another outfit still replaces exactly one.
  const saved = await boardOf(
    await send(owner, `${path}/items`, 'PUT', {
      operationId: 'native-ob-save',
      version: another.version,
      items: another.items,
    }),
  )
  const again = await boardOf(
    await send(owner, `${path}/outfits/${third.id}/another`, 'POST', {
      operationId: 'native-ob-another-2',
      seen: [...shown, keyOf(replaced)],
    }),
  )
  expect(again.version).toBe(saved.version + 1)
  expectLaidOut(again, wardrobe.jeans)

  const keep = {
    operationId: 'native-ob-keep',
    name: 'Jeans: outfits · 1',
    pieceIds: first.pieces.map(({ id }) => id),
    outfitId: first.id,
    proposal: { session: first.session, mode: first.mode, position: 0, edited: false },
  }
  const kept = await keptOf(await send(owner, `${path}/looks`, 'POST', keep))
  expect(outfitsOf(kept.board).find(({ id }) => id === first.id)?.lookId).toBe(kept.look.id)
  const keptAgain = await send(owner, `${path}/looks`, 'POST', { ...keep, operationId: 'native-ob-keep-2' })
  expect(keptAgain.status).toBe(422)
  expect(await keptAgain.json()).toMatchObject({ _tag: 'OutfitRefused', reason: 'kept' })
  await verifyAnotherLayout(owner, path, { kept: first.id, wardrobe })
  const refused = await send(owner, `${path}/outfits/${first.id}/another`, 'POST', {
    operationId: 'native-ob-another-kept',
    seen: [],
  })
  expect(refused.status).toBe(422)
  expect(await refused.json()).toMatchObject({ reason: 'kept' })
  expect((await send(owner, `/api/looks/${kept.look.id}`, 'DELETE', { operationId: 'native-ob-unkeep' })).status).toBe(
    204,
  )
  expect(outfitsOf(await boardOf(await owner(path))).find(({ id }) => id === first.id)?.lookId).toBeNull()

  expect((await owner(`/api/pieces/${wardrobe.jeans}`, { method: 'DELETE' })).status).toBe(204)
  const orphaned = await boardOf(await owner(path))
  expect(orphaned.outfitsAround?.anchor).toBeNull()
  expect(anchorsOn(orphaned, wardrobe.jeans)).toBe(0)
  const gone = await send(owner, `${path}/outfits/${second.id}/another`, 'POST', {
    operationId: 'native-ob-another-gone',
    seen: [],
  })
  expect(gone.status).toBe(422)
  expect(await gone.json()).toMatchObject({ reason: 'anchorGone' })
  expect((await send(owner, path, 'DELETE', { operationId: 'native-ob-delete' })).status).toBe(204)
  expect((await owner(path)).status).toBe(404)
}

/** Another layout: the ring of six becomes eight around, with two new complete outfits, and then six flanking, the last
 * two not kept leaving; the kept outfit stays through both, once per operation id. */
const verifyAnotherLayout = async (
  owner: Call,
  path: string,
  { kept, wardrobe }: { readonly kept: string; readonly wardrobe: Wardrobe },
) => {
  const before = await boardOf(await owner(path))
  const shown = outfitsOf(before).map(keyOf)
  const ask = { operationId: 'native-ob-layout' }
  const around = await boardOf(await send(owner, `${path}/layout`, 'POST', ask))
  expect(around.outfitsAround?.layout).toBe('around')
  expect(around.version).toBe(before.version + 1)
  expect(outfitsOf(around)).toHaveLength(outfitsIn('around'))
  expect(outfitsOf(around).slice(0, shown.length).map(keyOf)).toEqual(shown)
  for (const outfit of outfitsOf(around).slice(shown.length)) {
    expectComplete(outfit, wardrobe)
    expect(shown).not.toContain(keyOf(outfit))
  }
  expect(outfitsOf(around).find(({ id }) => id === kept)?.lookId).not.toBeNull()
  expectLaidOut(around, wardrobe.jeans)
  // A repeat answers the board as it is, laid out once.
  expect((await boardOf(await send(owner, `${path}/layout`, 'POST', ask))).version).toBe(around.version)
  const flanking = await boardOf(await send(owner, `${path}/layout`, 'POST', { operationId: 'native-ob-layout-2' }))
  expect(flanking.outfitsAround?.layout).toBe('flanking')
  expect(outfitsOf(flanking).map(({ id }) => id)).toEqual(
    outfitsOf(around)
      .slice(0, outfitsIn('flanking'))
      .map(({ id }) => id),
  )
  expect(outfitsOf(flanking).find(({ id }) => id === kept)?.lookId).not.toBeNull()
  expectLaidOut(flanking, wardrobe.jeans)
}

/** Board outfits on the server: looks kept on a board, and "One piece, many outfits" boards. */
export const verifyBoardOutfits = async (origin: string, fixtures: string): Promise<void> => {
  await seedAccounts(fixtures, 'native-keep', 'native-keep-other')
  const owner = client(origin, await signIn(origin, 'native-keep'))
  const other = client(origin, await signIn(origin, 'native-keep-other'))
  const pieceIds = [
    await addedPiece(origin, owner, 'native-keep-piece-1'),
    await addedPiece(origin, owner, 'native-keep-piece-2'),
  ]
  const strangerPieceId = await addedPiece(origin, other, 'native-keep-piece-3')
  await verifyKeep({ owner, other }, { pieceIds, strangerPieceId })
  // Its own wardrobe, so every piece in it is known.
  await seedAccounts(fixtures, 'native-outfit-board')
  const styler = client(origin, await signIn(origin, 'native-outfit-board'))
  await verifyOutfitCards(styler, await verifyOutfitBoard(origin, { owner: styler, other }))
}
