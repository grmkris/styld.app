import {
  boardTags,
  lookPieces,
  looks,
  operationReceipts,
  outfitPhotos,
  photoGarments,
  pieces,
  saves,
  styleNotes,
  tasteAnswers,
  wornPieces,
} from '@styld/db'
import {
  type AddStyleNote,
  CurrentAccount,
  LimitReached,
  mostStyleNotes,
  NotFound,
  Occasion,
  type SetOccasions,
  type StyleNote,
  StyleNoteId,
  type Taste,
  Unavailable,
} from '@styld/protocol'
import { and, asc, count, eq, gte, isNotNull } from 'drizzle-orm'
import { Context, DateTime, Effect, Layer, Option, Schema } from 'effect'
import { Database, first, nowDate, query } from '../kernel/Db.ts'
import { newId } from '../kernel/Ids.ts'
import { deleting, receiptRows, recorded } from '../kernel/Receipts.ts'
import { preferencesOf } from '../social/ShowMe.ts'
import { learnedFrom, type Wearing } from './Learned.ts'

// What Styld knows about how a person dresses (owner, 4 November 2026: "Styld learns the person"). Told: the
// occasions they dress for and the notes they said yes to Styld keeping. Learned: read on demand from what they wore,
// kept and loved, and the boards they saved, never stored, so it follows every delete by itself. Show me stays with
// the social module (`ShowMe.ts`); this reads it.

const unavailable = () => Unavailable.make({})
const read = <A>(run: () => Promise<A>) => query(run).pipe(Effect.mapError(unavailable))

/** How far back worn days count, and the most rows one signal reads. */
const wornDays = 90
const mostRows = 500

const isOccasion = Schema.is(Occasion)
const decodeNoteId = Schema.decodeUnknownSync(StyleNoteId)

const noteOf = (row: typeof styleNotes.$inferSelect): StyleNote => ({
  id: decodeNoteId(row.id),
  text: row.text,
  createdAt: row.createdAt.toISOString(),
})

/** The pieces' kinds and colours, for the wearings a signal found. */
const wearing = (row: { readonly type: string; readonly colours: ReadonlyArray<string> }): Wearing => ({
  type: row.type,
  colours: row.colours,
})

/** Everything the person's taste is read from, in four bounded reads. */
const signalsOf = Effect.fnUntraced(function* (db: Database['Service'], accountId: string, since: string) {
  const piece = { type: pieces.type, colours: pieces.colours }
  const [worn, kept, loved, saved] = yield* Effect.all(
    [
      read(() =>
        db
          .select(piece)
          .from(wornPieces)
          .innerJoin(pieces, eq(pieces.id, wornPieces.pieceId))
          .where(and(eq(wornPieces.accountId, accountId), gte(wornPieces.day, since)))
          .limit(mostRows),
      ),
      read(() =>
        db
          .select(piece)
          .from(lookPieces)
          .innerJoin(looks, eq(looks.id, lookPieces.lookId))
          .innerJoin(pieces, eq(pieces.id, lookPieces.pieceId))
          .where(eq(looks.accountId, accountId))
          .limit(mostRows),
      ),
      read(() =>
        db
          .select(piece)
          .from(photoGarments)
          .innerJoin(outfitPhotos, eq(outfitPhotos.id, photoGarments.photoId))
          .innerJoin(pieces, eq(pieces.id, photoGarments.pieceId))
          .where(and(eq(outfitPhotos.accountId, accountId), eq(outfitPhotos.favourite, true)))
          .limit(mostRows),
      ),
      read(() =>
        db
          .select({ value: boardTags.value })
          .from(saves)
          .innerJoin(boardTags, and(eq(boardTags.boardId, saves.boardId), eq(boardTags.kind, 'aesthetic')))
          .where(and(eq(saves.accountId, accountId), isNotNull(saves.boardId)))
          .limit(mostRows),
      ),
    ],
    { concurrency: 'unbounded' },
  )
  return {
    wearings: [...worn, ...kept, ...loved].map(wearing),
    savedAesthetics: saved.map((row) => row.value),
  }
})

/** The aesthetics of the boards the person saved, each once: What's new puts boards that share them first. */
export const savedAestheticsOf = (db: Database['Service'], accountId: string) =>
  read(() =>
    db
      .selectDistinct({ value: boardTags.value })
      .from(saves)
      .innerJoin(boardTags, and(eq(boardTags.boardId, saves.boardId), eq(boardTags.kind, 'aesthetic')))
      .where(and(eq(saves.accountId, accountId), isNotNull(saves.boardId)))
      .limit(mostRows),
  ).pipe(Effect.map((rows) => new Set(rows.map(({ value }) => value))))

/** The occasion a day's outfits are for, from the occasions the person dresses for: on a weekday smart when they dress
 * smart, else casual when they dress casual; at the weekend casual when they do. Formal, sport and lounge never set a
 * whole day: those are asked for. A day is the person's own (`2026-11-04`). */
export const occasionOfDay = (day: string, occasions: ReadonlyArray<Occasion>): Occasion | undefined => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  const weekend = weekday === 0 || weekday === 6
  if (!weekend && occasions.includes('smart')) return 'smart'
  return occasions.includes('casual') ? 'casual' : undefined
}

/** The person's taste: told and learned. Nothing stored is nothing told yet. */
const tasteOf = Effect.fn('Styld.Taste.read')(function* (db: Database['Service'], accountId: string) {
  const since = DateTime.formatIsoDateUtc(DateTime.subtract(yield* DateTime.now, { days: wornDays }))
  const [answers, notes, preferences, signals] = yield* Effect.all(
    [
      read(() => db.select().from(tasteAnswers).where(eq(tasteAnswers.accountId, accountId)).limit(1)),
      read(() =>
        db.select().from(styleNotes).where(eq(styleNotes.accountId, accountId)).orderBy(asc(styleNotes.createdAt)),
      ),
      preferencesOf(db, accountId),
      signalsOf(db, accountId, since),
    ],
    { concurrency: 'unbounded' },
  )
  const stored = first(answers)
  return {
    showMe: preferences.showMe,
    occasions: Option.match(stored, { onNone: () => [], onSome: (row) => row.occasions.filter(isOccasion) }),
    firstRunDone: Option.exists(stored, (row) => row.firstRunAt !== null),
    notes: notes.map(noteOf),
    learned: learnedFrom(signals),
  } satisfies Taste
})

/** The occasions the person dresses for, alone; none stored is none chosen. */
const occasionsRead = (db: Database['Service'], accountId: string) =>
  read(() =>
    db
      .select({ occasions: tasteAnswers.occasions })
      .from(tasteAnswers)
      .where(eq(tasteAnswers.accountId, accountId))
      .limit(1),
  ).pipe(
    Effect.map((rows) =>
      Option.match(first(rows), { onNone: () => [], onSome: (row) => row.occasions.filter(isOccasion) }),
    ),
  )

/** The statements that keep a new note, while fewer than the most notes are kept. */
const noteWrite = Effect.fnUntraced(function* (db: Database['Service'], accountId: string, text: string, at: Date) {
  const [kept] = yield* read(() =>
    db.select({ notes: count() }).from(styleNotes).where(eq(styleNotes.accountId, accountId)),
  )
  if ((kept?.notes ?? 0) >= mostStyleNotes) return yield* LimitReached.make({ limit: 'styleNotes' })
  const id = yield* newId('sn')
  return { statements: [db.insert(styleNotes).values({ id, accountId, text, createdAt: at })], result: id }
})

const make = Effect.gen(function* () {
  const db = yield* Database
  const receipts = receiptRows(db)

  /** The answers row with `set` applied: written over what is there, or new with nothing else told. */
  const answer = (accountId: string, at: Date, set: Partial<typeof tasteAnswers.$inferInsert>) =>
    db
      .insert(tasteAnswers)
      .values({ accountId, occasions: [], firstRunAt: null, updatedAt: at, ...set })
      .onConflictDoUpdate({ target: tasteAnswers.accountId, set: { ...set, updatedAt: at } })

  return {
    getTaste: Effect.fn('Styld.Taste.get')(function* () {
      const { accountId } = yield* CurrentAccount
      return yield* tasteOf(db, accountId)
    }),
    /** Only the occasions the person dresses for, for the outfit engine: one small read. */
    occasionsOf: Effect.fn('Styld.Taste.occasions')((accountId: string) => occasionsRead(db, accountId)),
    /** The occasions the person dresses for, as they are now chosen. */
    setOccasions: Effect.fn('Styld.Taste.setOccasions')(function* (input: SetOccasions) {
      const { accountId } = yield* CurrentAccount
      const at = yield* nowDate
      return yield* recorded(
        db,
        { accountId, operationId: input.operationId, command: 'setOccasions', input: input.occasions },
        {
          write: Effect.succeed({ statements: [answer(accountId, at, { occasions: input.occasions })], result: '' }),
          answer: () => tasteOf(db, accountId),
        },
      )
    }),
    /** The first run finished or put away: it is not offered again. */
    finishFirstRun: Effect.fn('Styld.Taste.finishFirstRun')(function* (operationId: string) {
      const { accountId } = yield* CurrentAccount
      const at = yield* nowDate
      return yield* recorded(
        db,
        { accountId, operationId, command: 'finishFirstRun', input: null },
        {
          write: Effect.succeed({ statements: [answer(accountId, at, { firstRunAt: at })], result: '' }),
          answer: () => tasteOf(db, accountId),
        },
      )
    }),
    /** Remember what the person said yes to keeping, while fewer than the most notes are kept. */
    addStyleNote: Effect.fn('Styld.Taste.addNote')(function* (input: AddStyleNote) {
      const { accountId } = yield* CurrentAccount
      const at = yield* nowDate
      return yield* recorded(
        db,
        { accountId, operationId: input.operationId, command: 'addStyleNote', input: input.text },
        {
          write: noteWrite(db, accountId, input.text, at),
          answer: (id) =>
            read(() => db.select().from(styleNotes).where(eq(styleNotes.id, id)).limit(1)).pipe(
              Effect.flatMap((rows) =>
                Option.match(first(rows), {
                  onNone: () => Effect.fail(unavailable()),
                  onSome: (row) => Effect.succeed(noteOf(row)),
                }),
              ),
            ),
        },
      )
    }),
    /** Forget one note; a repeat of the same delete answers done. */
    deleteStyleNote: Effect.fn('Styld.Taste.deleteNote')(function* (noteId: string, operationId: string) {
      const { accountId } = yield* CurrentAccount
      yield* deleting(receipts, { accountId, operationId, command: 'deleteStyleNote', target: noteId }, (receipt) =>
        read(() =>
          db.batch([
            db
              .delete(styleNotes)
              .where(and(eq(styleNotes.id, noteId), eq(styleNotes.accountId, accountId)))
              .returning({ id: styleNotes.id }),
            db.insert(operationReceipts).values(receipt),
          ]),
        ).pipe(Effect.flatMap(([deleted]) => (deleted.length > 0 ? Effect.void : Effect.fail(NotFound.make({}))))),
      )
    }),
  }
})

/** What Styld knows about how the person dresses, and the person's changes to it. */
export class Tastes extends Context.Service<Tastes, Effect.Success<typeof make>>()('@styld/server/taste/Tastes') {
  static readonly layer = Layer.effect(
    this,
    Effect.map(make, (service) => Tastes.of(service)),
  )
}
