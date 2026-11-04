import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Stream } from 'effect'
import { TextCompletions } from '../src/providers/Text.ts'
import { Database } from '../src/kernel/Db.ts'
import { Media } from '../src/kernel/Media.ts'
import { CaptureMetrics } from '../src/kernel/Metrics.ts'
import { CheckQueue, Checks } from '../src/safety/Checks.ts'
import { type Content, ContentJudge, contentJudge, passed } from '../src/safety/Judge.ts'
import { boardSourceDigest, profileSourceDigest } from '../src/social/Translated.ts'
import { localD1 } from './LocalD1.ts'

// The checks judge only what others would see of a thing: a piece's cut-out or clean drawing, never the photo it came
// from, and nothing of a piece that has no picture of its own. A model answer that is no verdict leaves the check
// pending, never passed. A check is forgotten with its target.

/** Ana, published, with a public board holding one ready piece. */
const seeded = (imageKey: string | null) => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    INSERT INTO profiles (account_id, handle, name, tone, published, house, search_text, created_at, updated_at)
      VALUES ('ac_1', 'ana', 'Ana', 'sand', 1, 0, ' ana', 0, 0);
    INSERT INTO pieces (id, account_id, name, type, colours, occasions, status, source, original_key, image_key,
        content_type, created_at, updated_at)
      VALUES ('pc_1', 'ac_1', 'Knit', 'knitwear', '[]', '[]', 'ready', 'website', 'ac_1/original.jpg',
        ${imageKey === null ? 'NULL' : `'${imageKey}'`}, 'image/jpeg', 0, 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, search_text, created_at, updated_at)
      VALUES ('bd_1', 'ac_1', 'Autumn', 'paper', 0, 'public', '[]', ' autumn', 0, 0);
    INSERT INTO board_pins (id, board_id, kind, piece_id, created_at) VALUES ('pn_1', 'bd_1', 'piece', 'pc_1', 0);
  `)
  return database
}

/** What the judge was shown, which stored objects were read for it, and what was queued. */
interface Witness {
  readonly judged: Array<Content>
  readonly read: Array<string>
  readonly queued: Array<unknown>
}
const witness = (): Witness => ({ judged: [], read: [], queued: [] })

const stream = (text: string) => new Blob([text]).stream()

/** The bucket and the Images binding as the judge's picture reads use them: every object is its key's bytes. */
const mediaFor = (seen: Witness) => {
  const fake = {
    bucket: {
      get: async (key: string) => {
        seen.read.push(key)
        return { body: stream(key) }
      },
    },
    images: {
      input: () => ({
        transform: () => ({
          output: async () => ({ image: () => stream('webp'), contentType: () => 'image/webp' }),
        }),
      }),
    },
  }
  // SAFETY: the fake implements the bucket read and the Images transform the judge's picture reads call -- the rest of R2 and Images is never called by a check
  return Media.of(fake as never)
}

/** A judge that passes everything it is shown. */
const passing = (seen: Witness) =>
  Layer.succeed(
    ContentJudge,
    ContentJudge.of({
      judge: (content) =>
        Effect.sync(() => {
          seen.judged.push(content)
          return passed
        }),
    }),
  )

/** The real judge, with DeepSeek answering `answer` and Clef never asked. */
const guardAnswering = (answer: unknown) =>
  contentJudge(() => Promise.reject(new Error('no pictures in these checks'))).pipe(
    Layer.provide(
      TextCompletions.layer({ run: () => Effect.succeed(answer), stream: () => Stream.die('not streamed') }),
    ),
    Layer.provide(Layer.succeed(CaptureMetrics, CaptureMetrics.discarding)),
  )

const checksOver = (
  database: ReturnType<typeof localD1>,
  seen: Witness,
  judge: Layer.Layer<ContentJudge> = passing(seen),
) =>
  Checks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Database.layer(database),
        Layer.succeed(Media, mediaFor(seen)),
        CheckQueue.layer({
          sendBatch: async (messages) => {
            seen.queued.push(...messages)
          },
        }),
        judge,
      ),
    ),
  )

describe('the checks', () => {
  it.effect('judge a public piece by its cut-out, never the photo it came from', () => {
    const seen = witness()
    const database = seeded('ac_1/cutout.png')
    return Effect.gen(function* () {
      const checks = yield* Checks
      const status = yield* checks.checkNow({ kind: 'piece', id: 'pc_1' })
      expect(Option.map(status, ({ state }) => state)).toEqual(Option.some('passed'))
      expect(seen.read).toEqual(['ac_1/cutout.png'])
      expect(seen.judged.map(({ texts, pictures }) => [texts, pictures.length])).toEqual([[['Knit'], 1]])
    }).pipe(Effect.provide(checksOver(database, seen)))
  })

  it.effect('judge nothing of a piece with only its photo, which others never see', () => {
    const seen = witness()
    const database = seeded(null)
    return Effect.gen(function* () {
      const checks = yield* Checks
      expect(yield* checks.checkNow({ kind: 'piece', id: 'pc_1' })).toEqual(Option.none())
      expect(yield* checks.changed({ kind: 'piece', id: 'pc_1' })).toBe(false)
      expect(seen.read).toEqual([])
      expect(seen.judged).toEqual([])
      expect(seen.queued).toEqual([])
    }).pipe(Effect.provide(checksOver(database, seen)))
  })

  for (const [shape, answer] of [
    ['words in neither of its formats', { response: 'Sorry, the service is temporarily unavailable.' }],
    ['an empty answer', { response: '' }],
    ['no answer at all', {}],
  ] as const)
    it.effect(`keep a published profile unsure when DeepSeek answers ${shape}`, () => {
      const seen = witness()
      const database = seeded('ac_1/cutout.png')
      return Effect.gen(function* () {
        const checks = yield* Checks
        const status = yield* checks.checkNow({ kind: 'profile', id: 'ac_1' })
        expect(Option.map(status, ({ state }) => state)).toEqual(Option.some('unsure'))
        expect(seen.queued).toEqual([])
        expect(
          Option.map(yield* checks.checkNow({ kind: 'profile', id: 'ac_1' }, 'fail'), ({ state }) => state),
        ).toEqual(Option.some('unsure'))
      }).pipe(Effect.provide(checksOver(database, seen, guardAnswering(answer))))
    })

  it.effect('forget the checks of things deleted without them, and keep the others', () => {
    const seen = witness()
    const database = seeded('ac_1/cutout.png')
    database.sqlite.exec(`
      INSERT INTO content_checks (target_kind, target_id, account_id, digest, state, requested_at)
        VALUES ('piece', 'pc_1', 'ac_1', 'd', 'passed', 0), ('piece', 'pc_gone', 'ac_1', 'd', 'passed', 0),
          ('board', 'bd_gone', 'ac_1', 'd', 'failed', 0), ('look', 'lk_gone', 'ac_1', 'd', 'pending', 0)
    `)
    return Effect.gen(function* () {
      const checks = yield* Checks
      yield* checks.sweep()
      expect(database.sqlite.prepare('SELECT target_id FROM content_checks').all()).toEqual([{ target_id: 'pc_1' }])
    }).pipe(Effect.provide(checksOver(database, seen)))
  })

  it.effect('judge a board’s Slovenian with it while it translates its words, and again when it changes', () => {
    const seen = witness()
    const database = seeded('ac_1/cutout.png')
    return Effect.gen(function* () {
      const fresh = yield* boardSourceDigest('Autumn', [])
      database.sqlite.exec(`
        INSERT INTO board_translations (board_id, locale, name, labels, source_digest, updated_at)
          VALUES ('bd_1', 'sl', 'Jesen', '{}', '${fresh}', 0)
      `)
      const checks = yield* Checks
      yield* checks.checkNow({ kind: 'board', id: 'bd_1' })
      database.sqlite.exec("UPDATE board_translations SET name = 'Jesen v mestu' WHERE board_id = 'bd_1'")
      yield* checks.checkNow({ kind: 'board', id: 'bd_1' })
      // Renamed by its owner: the translation no longer translates it, so it is neither shown nor judged.
      database.sqlite.exec("UPDATE boards SET name = 'Fall' WHERE id = 'bd_1'")
      yield* checks.checkNow({ kind: 'board', id: 'bd_1' })
      expect(seen.judged.map(({ texts }) => texts)).toEqual([
        ['Autumn', 'Jesen'],
        ['Autumn', 'Jesen v mestu'],
        ['Fall'],
      ])
    }).pipe(Effect.provide(checksOver(database, seen)))
  })

  it.effect('judge a profile’s Slovenian name and bio with it', () => {
    const seen = witness()
    const database = seeded('ac_1/cutout.png')
    return Effect.gen(function* () {
      const fresh = yield* profileSourceDigest('Ana', null)
      database.sqlite.exec(`
        INSERT INTO profile_translations (account_id, locale, name, bio, source_digest, updated_at)
          VALUES ('ac_1', 'sl', 'Ana', 'Jesenske plasti.', '${fresh}', 0)
      `)
      yield* (yield* Checks).checkNow({ kind: 'profile', id: 'ac_1' })
      expect(seen.judged.map(({ texts }) => texts)).toEqual([['Ana', 'ana', 'Ana', 'Jesenske plasti.']])
    }).pipe(Effect.provide(checksOver(database, seen)))
  })
})
