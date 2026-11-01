import { photoGarments } from '@styld/db'
import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'

/** My Gallery's statements for another module's batch: a garment offered to the tray confirmed as the piece kept from
 * it. */
export const GarmentRows = {
  confirm: (db: ReturnType<typeof drizzle>, captureId: string, pieceId: string) =>
    db
      .update(photoGarments)
      .set({ pieceId, state: 'confirmed' })
      .where(and(eq(photoGarments.captureId, captureId), eq(photoGarments.state, 'offered'))),
}
