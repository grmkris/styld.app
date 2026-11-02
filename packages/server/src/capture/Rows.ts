import { captures, detections, piecePictures } from '@styld/db'
import { and, eq, inArray } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'

/** Capture's statements for another module's batch: a garment offered from an outfit photo, as a capture of its own
 * with its one detection waiting in the tray. */
export const OfferedRows = {
  insert: (
    db: ReturnType<typeof drizzle>,
    capture: typeof captures.$inferInsert,
    detection: typeof detections.$inferInsert,
  ) => [db.insert(captures).values(capture), db.insert(detections).values(detection)] as const,
}

/** Capture's statement for the wardrobe: which picture a piece shows, its clean drawing or its photo, as its owner
 * chose. Only a drawing that is ready or proposed can be chosen; the statement returns the picture it changed. */
export const PictureRows = {
  show: (db: ReturnType<typeof drizzle>, accountId: string, pieceId: string, shown: 'clean' | 'photo', at: Date) =>
    db
      .update(piecePictures)
      .set({ shown, updatedAt: at })
      .where(
        and(
          eq(piecePictures.pieceId, pieceId),
          eq(piecePictures.accountId, accountId),
          inArray(piecePictures.state, ['ready', 'proposed']),
        ),
      )
      .returning(),
}
