import { captures, detections } from '@styld/db'
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
