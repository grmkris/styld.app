import { boards } from '@styld/db'
import { eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'

/** The boards' statement for curation: a board featured in Explore since `featuredAt`, or no longer featured (`null`).
 * The statement returns the board it changed. */
export const BoardRows = {
  feature: (db: ReturnType<typeof drizzle>, boardId: string, featuredAt: Date | null) =>
    db.update(boards).set({ featuredAt }).where(eq(boards.id, boardId)).returning({ id: boards.id }),
}
