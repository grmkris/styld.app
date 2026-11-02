import { captures, photoGarments } from '@styld/db'
import { and, eq, inArray } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'

/** My Gallery's statements for another module's batch: a garment offered to the tray (the capture that names it)
 * confirmed as the piece kept from it. */
export const GarmentRows = {
  confirm: (db: ReturnType<typeof drizzle>, captureId: string, pieceId: string) =>
    db
      .update(photoGarments)
      .set({ pieceId, state: 'confirmed' })
      .where(
        and(
          inArray(
            photoGarments.id,
            db.select({ id: captures.garmentId }).from(captures).where(eq(captures.id, captureId)),
          ),
          eq(photoGarments.state, 'offered'),
        ),
      ),
}
