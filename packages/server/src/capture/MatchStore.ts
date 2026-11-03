import type { PieceType } from '@styld/protocol'
import { captures, detections, pieces } from '@styld/db'
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { Effect, Option } from 'effect'
import { query } from '../kernel/Db.ts'

type Database = ReturnType<typeof drizzle>
type DetectionRow = typeof detections.$inferSelect

/** The captures whose sightings are compared with each other: every capture of an import, or one on its own. */
export interface MatchScope {
  readonly accountId: string
  readonly captureId: string
  readonly importId: string | null
}

const inScope = (db: Database, scope: MatchScope) =>
  scope.importId === null
    ? eq(detections.captureId, scope.captureId)
    : inArray(
        detections.captureId,
        db
          .select({ id: captures.id })
          .from(captures)
          .where(and(eq(captures.accountId, scope.accountId), eq(captures.importId, scope.importId))),
      )

/** How a compared sighting ends: on its own, joined to the sighting that shows its garment, or shown in that
 * sighting's place (it is the fuller one), and the account's piece it was taken for. */
export interface MatchOutcome {
  readonly joins: Option.Option<{ readonly head: string; readonly replaces: boolean }>
  readonly duplicateOf: string | null
}

/** The match job's claims: which detection of a scope is compared next, and by which delivery. */
const claimRows = (db: Database) => ({
  /** The scope's detections still to be compared, oldest first. */
  toMatch: (scope: MatchScope) =>
    query(() =>
      db
        .select()
        .from(detections)
        .where(
          and(
            eq(detections.accountId, scope.accountId),
            inScope(db, scope),
            inArray(detections.matching, ['waiting', 'claimed']),
          ),
        )
        .orderBy(asc(detections.createdAt), asc(detections.id)),
    ),
  /** Claim a detection as it was read: waiting, or claimed by a delivery that gave up. Whether it was claimed. */
  claimMatch: (detection: DetectionRow, at: Date) =>
    query(() =>
      db
        .update(detections)
        .set({ matching: 'claimed', matchClaimedAt: at })
        .where(
          and(
            eq(detections.id, detection.id),
            detection.matching === 'claimed' && detection.matchClaimedAt !== null
              ? and(eq(detections.matching, 'claimed'), eq(detections.matchClaimedAt, detection.matchClaimedAt))
              : eq(detections.matching, 'waiting'),
          ),
        )
        .returning({ id: detections.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
  /** Let a claimed detection be compared by the next delivery, after this one failed. */
  releaseMatch: (detectionId: string, claimedAt: Date) =>
    query(() =>
      db
        .update(detections)
        .set({ matching: 'waiting', matchClaimedAt: null })
        .where(
          and(
            eq(detections.id, detectionId),
            eq(detections.matching, 'claimed'),
            eq(detections.matchClaimedAt, claimedAt),
          ),
        ),
    ).pipe(Effect.asVoid),
  /** Stop comparing the scope's detections, after the last delivery gave up: each stays its own card. */
  abandonMatches: (scope: MatchScope) =>
    query(() =>
      db
        .update(detections)
        .set({ matching: 'done', matchClaimedAt: null })
        .where(
          and(
            eq(detections.accountId, scope.accountId),
            inScope(db, scope),
            inArray(detections.matching, ['waiting', 'claimed']),
          ),
        ),
    ).pipe(Effect.asVoid),
})

/** What a sighting is compared with: the garments its import shows, and the wardrobe's pieces. */
const candidateRows = (db: Database) => ({
  /** The sightings that show a garment of one of `types` in the scope's tray, newest first: compared already, shown on
   * their own card, and waiting for the person. `except` leaves out a capture's own (a photo's pieces are
   * different garments). */
  shownSightings: (scope: MatchScope, types: ReadonlyArray<PieceType>, except: string | undefined, limit: number) =>
    query(() =>
      db
        .select()
        .from(detections)
        .where(
          and(
            eq(detections.accountId, scope.accountId),
            inScope(db, scope),
            eq(detections.matching, 'done'),
            eq(detections.status, 'review'),
            isNull(detections.groupOf),
            isNotNull(detections.cutoutKey),
            inArray(detections.suggestedType, [...types]),
            except === undefined ? undefined : ne(detections.captureId, except),
          ),
        )
        .orderBy(desc(detections.createdAt))
        .limit(limit),
    ),
  /** The account's pieces of one of `types` shown as cut-outs that a new garment may already be: those of its own type
   * first, then those sharing its main colour, then the newest. The decision model's colour for a garment worn in
   * shade is often wrong; its type is surer (Eva's review, 2 November: 8 coats, 49 tops). */
  wardrobeCandidates: (
    accountId: string,
    types: ReadonlyArray<PieceType>,
    like: { readonly type: string | null; readonly colour: string | undefined },
    limit: number,
  ) =>
    query(() =>
      db
        .select({ id: pieces.id, imageKey: pieces.imageKey })
        .from(pieces)
        .where(
          and(
            eq(pieces.accountId, accountId),
            eq(pieces.status, 'ready'),
            inArray(pieces.type, [...types]),
            isNotNull(pieces.imageKey),
            ne(pieces.imageKey, pieces.originalKey),
          ),
        )
        // A term left out, not ordered by a constant: SQLite reads `ORDER BY 0` as a column number and refuses it.
        .orderBy(
          ...(like.type === null ? [] : [desc(sql`${pieces.type} = ${like.type}`)]),
          ...(like.colour === undefined
            ? []
            : [desc(sql`instr(${pieces.colours}, ${JSON.stringify(like.colour)}) > 0`)]),
          desc(pieces.createdAt),
        )
        .limit(limit),
    ),
})

/** Where a comparison leaves the tray: one card for a garment's sightings, until the person splits it. */
const outcomeRows = (db: Database) => ({
  /** End a claimed detection's comparison with `outcome`, together, only while the claim is still this one's. A
   * sighting shown in another's place takes over that one's other sightings and its wardrobe match. */
  finishMatch: (detection: DetectionRow, claimedAt: Date, outcome: MatchOutcome) => {
    const stillClaimed = exists(
      db
        .select({ id: detections.id })
        .from(detections)
        .where(
          and(
            eq(detections.id, detection.id),
            eq(detections.matching, 'claimed'),
            eq(detections.matchClaimedAt, claimedAt),
          ),
        ),
    )
    const finish = (groupOf: string | null) =>
      db
        .update(detections)
        .set({ matching: 'done', matchClaimedAt: null, groupOf, duplicateOf: outcome.duplicateOf })
        .where(
          and(
            eq(detections.id, detection.id),
            eq(detections.matching, 'claimed'),
            eq(detections.matchClaimedAt, claimedAt),
          ),
        )
    // Both run in one batch: the move first, while the claim still holds.
    const replacing = (head: string) =>
      db.batch([
        db
          .update(detections)
          .set({ groupOf: detection.id })
          .where(
            and(
              eq(detections.accountId, detection.accountId),
              or(eq(detections.groupOf, head), eq(detections.id, head)),
              stillClaimed,
            ),
          ),
        finish(null),
      ])
    return query(() =>
      Option.match(outcome.joins, {
        onNone: () => finish(null).then(() => undefined),
        onSome: ({ head, replaces }) => (replaces ? replacing(head) : finish(head)).then(() => undefined),
      }),
    )
  },
  /** The other sightings of the garments `heads` show, still waiting. */
  sightingsOf: (accountId: string, heads: ReadonlyArray<string>) =>
    heads.length === 0
      ? Effect.succeed<ReadonlyArray<DetectionRow>>([])
      : query(() =>
          db
            .select()
            .from(detections)
            .where(
              and(
                eq(detections.accountId, accountId),
                inArray(detections.groupOf, [...heads]),
                eq(detections.status, 'review'),
              ),
            ),
        ),
  /** Show every other sighting of `head`'s garment on its own card again; whether there were any. */
  split: (accountId: string, head: string) =>
    query(() =>
      db
        .update(detections)
        .set({ groupOf: null })
        .where(and(eq(detections.accountId, accountId), eq(detections.groupOf, head), eq(detections.status, 'review')))
        .returning({ id: detections.id }),
    ).pipe(Effect.map((rows) => rows.length > 0)),
})

/** Comparing sightings with each other and with the wardrobe. Only the match job writes these columns, and only for
 * the detection it claimed. */
export const matchRows = (db: Database) => ({ ...claimRows(db), ...candidateRows(db), ...outcomeRows(db) })
