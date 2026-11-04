import { expect } from 'bun:test'
import { Schema } from 'effect'
import { Board, KeptLook, LookPin, Looks } from '@styld/protocol'
import { type Call, client, seedAccounts, send, signIn } from './Accounts.ts'
import { addedPiece } from './GalleryAcceptance.ts'

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

/** Board outfits on the server: looks kept on a board. */
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
}
