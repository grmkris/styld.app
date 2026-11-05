import { pieceTurns } from '@styld/db'
import { and, eq, inArray, type SQL } from 'drizzle-orm'
import { Effect } from 'effect'
import { type Database as Db, query } from '../kernel/Db.ts'
import { allowed, lifecycle } from '../kernel/Lifecycle.ts'

// A piece's turn (`piece_turns.state`), and the one writer of it: every move goes from the state the turn was read in,
// along `turnLifecycle`. A requested turn is claimed (`anchoring`: its frames laid on the key), handed to the video
// model (`generating`), waits for the owner's browser to cut the video into frames (`video-ready`), and ends kept
// (`ready`), dropped by its check (`rejected`) or failed. An ended turn may be asked for again, and a request whose
// credits could not be held is taken back to where it was.

type Database = Db['Service']
type TurnRow = typeof pieceTurns.$inferSelect
export type TurnState = TurnRow['state']

/** What a move writes besides the state. */
export type TurnChanges = Partial<Omit<TurnRow, 'pieceId' | 'accountId' | 'state'>>

export const turnLifecycle = lifecycle<TurnState>('piece turn', {
  // Claimed, or failed before it was; a request taken back returns to the end it was asked from.
  requested: ['anchoring', 'failed', 'ready', 'rejected'],
  // Handed to the video model, handed back to the queue while a provider is busy, or failed.
  anchoring: ['generating', 'requested', 'failed'],
  generating: ['video-ready', 'failed'],
  'video-ready': ['ready', 'rejected', 'failed'],
  ready: ['requested'],
  rejected: ['requested'],
  failed: ['requested'],
})

/** The state a turn is asked for in. */
export const firstTurnState = 'requested' as const satisfies TurnState

const ends = ['ready', 'rejected', 'failed'] as const satisfies ReadonlyArray<TurnState>

/** Whether a turn has ended: kept, dropped by its check, or failed. Only a new request moves it on. */
export const turnEnded = (state: TurnState): state is (typeof ends)[number] => ends.some((end) => end === state)

const turnMove = (
  db: Database,
  scope: SQL | undefined,
  from: ReadonlyArray<TurnState>,
  to: TurnState,
  changes: TurnChanges,
) =>
  db
    .update(pieceTurns)
    .set({ ...changes, state: to })
    .where(and(scope, inArray(pieceTurns.state, [...from])))
    .returning({ pieceId: pieceTurns.pieceId })

/** Move a piece's turn from one of `from` to `to`, with `changes`; whether it moved. */
export const advanceTurn = (
  db: Database,
  pieceId: string,
  from: ReadonlyArray<TurnState>,
  to: TurnState,
  changes: TurnChanges,
) =>
  Effect.andThen(
    allowed(turnLifecycle, from, to),
    query(() => turnMove(db, eq(pieceTurns.pieceId, pieceId), from, to, changes)),
  ).pipe(Effect.map((rows) => rows.length > 0))

/** Claim a piece's next turn, or take back one claimed: move it only from the state and the attempt it was read in, so
 * of two requests reading the same turn one owns the attempt and its hold; whether it moved. */
export const claimTurn = (
  db: Database,
  pieceId: string,
  seen: Pick<TurnRow, 'state' | 'attempt'>,
  to: TurnState,
  changes: TurnChanges,
) =>
  Effect.andThen(
    allowed(turnLifecycle, [seen.state], to),
    query(() =>
      turnMove(
        db,
        and(eq(pieceTurns.pieceId, pieceId), eq(pieceTurns.attempt, seen.attempt)),
        [seen.state],
        to,
        changes,
      ),
    ),
  ).pipe(Effect.map((rows) => rows.length > 0))
