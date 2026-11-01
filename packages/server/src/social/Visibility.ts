import { contentChecks, piecePictures, pieces } from '@styld/db'
import type { CheckStatus } from '@styld/protocol'
import { and, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { Option } from 'effect'
import type { Database } from '../kernel/Db.ts'
import { shownImage } from '../wardrobe/Shown.ts'
import type { PictureRow, PieceRow } from '../wardrobe/Store.ts'

// Who may see a public thing is decided here, once, for every page, list, feed, search, assistant answer and pin. Two
// reaches: its own links (a profile, a shared board or look), and discovery (Explore, feeds, search). The owner always
// sees their own; blocks apply on top, in both directions, where people are read.

/** How far a thing reaches others: its own links, or discovery. */
export type Reach = 'link' | 'discovery'

/** The check states others may see past at each reach: an unsure check stays on its own links. */
const states = {
  link: ['passed', 'unsure'],
  discovery: ['passed'],
} as const satisfies Record<Reach, ReadonlyArray<CheckStatus['state']>>

/** Whether others may see a thing at this reach, by its check: one that let them and that nobody hid. */
export const visibleAt = (reach: Reach, check: CheckStatus | undefined) =>
  check !== undefined && !check.hidden && states[reach].some((state) => state === check.state)

/** The same rule in SQL, for a target kind and its id column: its check lets others see it at this reach. */
export const checkLets = (reach: Reach, kind: 'board' | 'look', id: SQL | AnySQLiteColumn) =>
  and(
    eq(contentChecks.targetKind, kind),
    eq(contentChecks.targetId, id),
    inArray(contentChecks.state, [...states[reach]]),
    isNull(contentChecks.hidden),
  )

/** The board picture origin others never see: an outfit photo from the owner's own gallery. */
export const heldBackOrigin = 'photo'

/** Whether a board picture of this origin is held back from everyone but its owner. */
export const heldBack = (origin: string | null) => origin === heldBackOrigin

/** A piece with the clean picture it may show. */
export interface PieceWithPicture {
  readonly piece: PieceRow
  readonly picture: PictureRow | null
}

/** Pieces with their clean pictures, newest first: what both the public pages and the check judge read. */
export const piecesWithPictures = (db: Database['Service'], where: SQL | undefined) =>
  db
    .select({ piece: pieces, picture: piecePictures })
    .from(pieces)
    .leftJoin(piecePictures, eq(piecePictures.pieceId, pieces.id))
    .where(where)
    .orderBy(desc(pieces.createdAt))

/** The picture a piece shows others: its cut-out or its clean drawing, never the photo it came from. A piece without
 * one is never shown to others, so this is also all the check judge reads of it. */
export const publicImage = ({ piece, picture }: PieceWithPicture) => {
  const image = shownImage(piece, picture ?? undefined)
  return image.key === piece.originalKey ? Option.none() : Option.some(image)
}
