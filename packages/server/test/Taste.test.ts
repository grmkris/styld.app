import { describe, expect, it } from '@effect/vitest'
import { CurrentAccount, mostStyleNotes, OperationId, StyleNoteId } from '@styld/protocol'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { Database } from '../src/kernel/Db.ts'
import { learnedFrom } from '../src/taste/Learned.ts'
import { Tastes } from '../src/taste/Taste.ts'
import { localD1 } from './LocalD1.ts'

// What Styld knows about how a person dresses (owner, 4 November 2026): what they told it, kept until they change or
// remove it, and what it learned from what they wore, kept and loved and the boards they saved, read on demand.

const op = (name: string) => OperationId.make(`taste-${name}`)

describe('what Styld learns from the signals', () => {
  it('tells the strongest colours and kinds seen at least twice, and every saved aesthetic, most often first', () => {
    const learned = learnedFrom({
      wearings: [
        { type: 'knitwear', colours: ['navy', 'white'] },
        { type: 'knitwear', colours: ['navy'] },
        { type: 'jeans', colours: ['blue'] },
        { type: 'jeans', colours: ['blue', 'navy'] },
        { type: 'boots', colours: ['brown'] },
      ],
      savedAesthetics: ['poetcore', 'city-break', 'poetcore'],
    })
    expect(learned).toEqual({
      aesthetics: ['poetcore', 'city-break'],
      colours: ['navy', 'blue'],
      wornTypes: ['jeans', 'knitwear'],
    })
  })

  it('knows nothing from nothing, and leaves out values the contract does not name', () => {
    expect(learnedFrom({ wearings: [], savedAesthetics: [] })).toEqual({ aesthetics: [], colours: [], wornTypes: [] })
    const old = learnedFrom({
      wearings: [
        { type: 'tops', colours: ['olive'] },
        { type: 'tops', colours: ['olive'] },
      ],
      savedAesthetics: [],
    })
    expect(old).toEqual({ aesthetics: [], colours: [], wornTypes: [] })
  })

  it('tells at most a few of each', () => {
    const colours = ['black', 'white', 'grey', 'beige', 'brown', 'navy']
    const learned = learnedFrom({
      wearings: [...colours, ...colours].map((colour) => ({ type: 'shirts', colours: [colour] })),
      savedAesthetics: ['a', 'b', 'c', 'd'],
    })
    expect(learned.colours).toHaveLength(4)
    expect(learned.aesthetics).toEqual(['a', 'b', 'c'])
  })
})

/** Ana, with a coat and jeans she wore, a look she kept, a favourite photo, and a saved house board; Luka beside her. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 0, 'Ana', 0),
      ('ac_luka', 0, 'Luka', 0);
    INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key, content_type,
        created_at, updated_at)
      VALUES ('pc_coat', 'ac_ana', 'coats', '["navy"]', '[]', 'ready', 'website', 'o', 'i', 'image/png', 0, 0),
        ('pc_jeans', 'ac_ana', 'jeans', '["blue","navy"]', '[]', 'ready', 'website', 'o', 'i', 'image/png', 0, 0),
        ('pc_luka', 'ac_luka', 'boots', '["brown"]', '[]', 'ready', 'website', 'o', 'i', 'image/png', 0, 0);
    INSERT INTO worn_pieces (account_id, day, piece_id, position) VALUES ('ac_ana', '1970-01-01', 'pc_coat', 0),
      ('ac_ana', '1970-01-01', 'pc_jeans', 1), ('ac_ana', '1969-12-30', 'pc_jeans', 0),
      ('ac_ana', '1969-01-01', 'pc_coat', 0), ('ac_luka', '1970-01-01', 'pc_luka', 0),
      ('ac_luka', '1969-12-31', 'pc_luka', 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, published_at, search_text, created_at,
        updated_at)
      VALUES ('bd_poet', 'ac_luka', 'Poet season', 'sand', 0, 'public', '[]', 100, ' poet season', 0, 0);
    INSERT INTO board_tags (board_id, kind, value) VALUES ('bd_poet', 'aesthetic', 'poetcore'),
      ('bd_poet', 'audience', 'women');
    INSERT INTO saves (id, account_id, kind, board_id, created_at) VALUES ('sv_poet', 'ac_ana', 'board', 'bd_poet', 0);
  `)
  return database
}

const as = (accountId: string, database = seeded()) =>
  Tastes.layer.pipe(
    Layer.provideMerge(Database.layer(database)),
    Layer.provideMerge(Layer.succeed(CurrentAccount, CurrentAccount.of({ accountId, via: 'session' }))),
  )

describe('a person’s taste', () => {
  it.effect('learns from the last 90 days of worn pieces and the boards saved; nothing told yet', () =>
    Effect.gen(function* () {
      const taste = yield* (yield* Tastes).getTaste()
      // The coat worn in 1969-01 is past the 90 days; the jeans worn twice and navy three times count.
      expect(taste).toEqual({
        showMe: null,
        occasions: [],
        firstRunDone: false,
        notes: [],
        learned: { aesthetics: ['poetcore'], colours: ['navy', 'blue'], wornTypes: ['jeans'] },
      })
    }).pipe(Effect.provide(as('ac_ana'))),
  )

  it.effect('keeps the occasions as chosen, and a late repeat of an older choice changes nothing', () =>
    Effect.gen(function* () {
      const tastes = yield* Tastes
      yield* tastes.setOccasions({ operationId: op('occasions-1'), occasions: ['smart', 'casual'] })
      const now = yield* tastes.setOccasions({ operationId: op('occasions-2'), occasions: ['sport'] })
      expect(now.occasions).toEqual(['sport'])
      const repeat = yield* tastes.setOccasions({ operationId: op('occasions-1'), occasions: ['smart', 'casual'] })
      expect(repeat.occasions).toEqual(['sport'])
      const conflict = yield* Effect.flip(tastes.setOccasions({ operationId: op('occasions-1'), occasions: [] }))
      expect(conflict).toMatchObject({ _tag: 'OperationConflict' })
    }).pipe(Effect.provide(as('ac_ana'))),
  )

  it.effect('marks the first run done, keeping the occasions', () =>
    Effect.gen(function* () {
      const tastes = yield* Tastes
      yield* tastes.setOccasions({ operationId: op('occasions-3'), occasions: ['smart'] })
      const done = yield* tastes.finishFirstRun(op('first-run-1'))
      expect(done).toMatchObject({ firstRunDone: true, occasions: ['smart'] })
    }).pipe(Effect.provide(as('ac_ana'))),
  )

  it.effect('remembers notes oldest first, once per operation id, and forgets one the person removes', () =>
    Effect.gen(function* () {
      const tastes = yield* Tastes
      const heels = yield* tastes.addStyleNote({ operationId: op('note-1'), text: 'Never heels' })
      yield* TestClock.adjust('1 second')
      yield* tastes.addStyleNote({ operationId: op('note-2'), text: 'Office on weekdays' })
      expect(yield* tastes.addStyleNote({ operationId: op('note-1'), text: 'Never heels' })).toEqual(heels)
      expect((yield* tastes.getTaste()).notes.map(({ text }) => text)).toEqual(['Never heels', 'Office on weekdays'])
      yield* tastes.deleteStyleNote(heels.id, op('forget-1'))
      yield* tastes.deleteStyleNote(heels.id, op('forget-1'))
      expect((yield* tastes.getTaste()).notes.map(({ text }) => text)).toEqual(['Office on weekdays'])
    }).pipe(Effect.provide(as('ac_ana'))),
  )

  it.effect('keeps at most the most notes, and never forgets someone else’s', () =>
    Effect.gen(function* () {
      const tastes = yield* Tastes
      for (let note = 0; note < mostStyleNotes; note++)
        yield* tastes.addStyleNote({ operationId: op(`many-${String(note)}`), text: `Note ${String(note)}` })
      const full = yield* Effect.flip(tastes.addStyleNote({ operationId: op('one-more'), text: 'One more' }))
      expect(full).toMatchObject({ _tag: 'LimitReached', limit: 'styleNotes' })
      const stranger = yield* Effect.flip(
        tastes.deleteStyleNote(StyleNoteId.make(`sn_${'nobody'.padEnd(22, 'x')}`), op('forget-stranger')),
      )
      expect(stranger).toMatchObject({ _tag: 'NotFound' })
    }).pipe(Effect.provide(as('ac_ana'))),
  )

  it('holds only a JSON list of occasions, and goes with the account', () => {
    const database = seeded()
    database.sqlite.exec(`
      INSERT INTO taste_answers (account_id, occasions, updated_at) VALUES ('ac_ana', '["smart"]', 0);
      INSERT INTO style_notes (id, account_id, text, created_at) VALUES ('sn_ana', 'ac_ana', 'Never heels', 0);
    `)
    expect(() =>
      database.sqlite.exec(
        `INSERT INTO taste_answers (account_id, occasions, updated_at) VALUES ('ac_luka', 'smart', 0)`,
      ),
    ).toThrow(/CHECK|malformed JSON/u)
    database.sqlite.exec(`PRAGMA foreign_keys = ON; DELETE FROM accounts WHERE id = 'ac_ana'`)
    const left = database.sqlite
      .prepare('SELECT (SELECT count(*) FROM taste_answers) + (SELECT count(*) FROM style_notes) AS n')
      .get()
    expect(left).toEqual({ n: 0 })
  })
})
