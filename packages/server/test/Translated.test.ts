import { describe, expect, it } from '@effect/vitest'
import { Effect, Predicate } from 'effect'
import { PublicPages } from '../src/social/Public.ts'
import {
  boardSourceDigest,
  profileSourceDigest,
  ReaderLocale,
  readerLocaleOf,
  translatedItems,
} from '../src/social/Translated.ts'
import { localD1 } from './LocalD1.ts'
import { publicPagesOver } from './PassingChecks.ts'

// The same board and profile in Slovenian (owner, 4 November 2026): every public read picks the translation for the
// reader's language while it still translates the original, and the original once the owner changed it.

const item = 'bi_label00000000000000000'

/** Ana's published profile and public board with one label, both checked and passed, and their Slovenian. */
const seeded = () =>
  Effect.gen(function* () {
    const database = localD1()
    const board = yield* boardSourceDigest('Autumn', [{ id: item, text: 'Three layers' }])
    const profile = yield* profileSourceDigest('Ana', 'Layers.')
    database.sqlite.exec(`
      INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
      INSERT INTO profiles (account_id, handle, name, bio, tone, published, house, search_text, created_at, updated_at)
        VALUES ('ac_1', 'ana', 'Ana', 'Layers.', 'sand', 1, 1, ' ana', 0, 0);
      INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, published_at, search_text,
          created_at, updated_at)
        VALUES ('bd_autumn0000000000000000', 'ac_1', 'Autumn', 'sand', 1, 'public', '[]', 10, ' autumn', 0, 0);
      INSERT INTO board_items (id, board_id, kind, text, text_style, x, y, size, turn, z, flipped)
        VALUES ('${item}', 'bd_autumn0000000000000000', 'text', 'Three layers', 'label', 500, 60, 400, 0, 1, 0);
      INSERT INTO content_checks (target_kind, target_id, account_id, digest, state, requested_at)
        VALUES ('profile', 'ac_1', 'ac_1', 'd', 'passed', 0), ('board', 'bd_autumn0000000000000000', 'ac_1', 'd', 'passed', 0);
      INSERT INTO board_translations (board_id, locale, name, labels, source_digest, updated_at)
        VALUES ('bd_autumn0000000000000000', 'sl', 'Jesen', '{"${item}":"Tri plasti"}', '${board}', 0);
      INSERT INTO profile_translations (account_id, locale, name, bio, source_digest, updated_at)
        VALUES ('ac_1', 'sl', 'Ana SL', 'Plasti.', '${profile}', 0);
    `)
    const layer = publicPagesOver(database)
    return { database, layer }
  })

const labelsOf = (items: ReadonlyArray<unknown>) =>
  items.flatMap((entry) => (Predicate.hasProperty(entry, 'text') ? [entry.text] : []))

describe('a public board and profile in the reader’s language', () => {
  it.effect('read in Slovenian, show the translation; in English, the original', () =>
    Effect.gen(function* () {
      const { layer } = yield* seeded()
      const read = (locale: 'en' | 'sl') =>
        Effect.gen(function* () {
          const pages = yield* PublicPages
          const board = yield* pages.board('bd_autumn0000000000000000')
          const profile = yield* pages.profile('ana')
          return { name: board.name, labels: labelsOf(board.items), by: board.by.name, bio: profile.bio }
        }).pipe(Effect.provideService(ReaderLocale, locale), Effect.provide(layer))
      expect(yield* read('sl')).toEqual({ name: 'Jesen', labels: ['Tri plasti'], by: 'Ana SL', bio: 'Plasti.' })
      expect(yield* read('en')).toEqual({ name: 'Autumn', labels: ['Three layers'], by: 'Ana', bio: 'Layers.' })
    }),
  )

  it.effect('once the owner renames the board, a Slovenian reader gets the original', () =>
    Effect.gen(function* () {
      const { database, layer } = yield* seeded()
      database.sqlite.exec("UPDATE boards SET name = 'Fall' WHERE id = 'bd_autumn0000000000000000'")
      const board = yield* Effect.flatMap(PublicPages, (pages) => pages.board('bd_autumn0000000000000000')).pipe(
        Effect.provideService(ReaderLocale, 'sl'),
        Effect.provide(layer),
      )
      expect([board.name, labelsOf(board.items)]).toEqual(['Fall', ['Three layers']])
    }),
  )
})

describe('the reader’s language', () => {
  it('is the website’s own choice first, then what the browser asks for first, else English', () => {
    expect(readerLocaleOf({ cookie: 'a=1; styld_locale=sl', 'accept-language': 'en-GB' })).toBe('sl')
    expect(readerLocaleOf({ cookie: 'styld_locale=en', 'accept-language': 'sl-SI' })).toBe('en')
    expect(readerLocaleOf({ 'accept-language': 'sl-SI,sl;q=0.9' })).toBe('sl')
    expect(readerLocaleOf({})).toBe('en')
  })

  it('swaps only the labels the translation has', () => {
    const items = [
      { id: 'a', text: 'One' },
      { id: 'b', pieceId: 'pc_1' },
    ]
    expect(translatedItems(items, { a: 'Ena' })).toEqual([
      { id: 'a', text: 'Ena' },
      { id: 'b', pieceId: 'pc_1' },
    ])
    expect(translatedItems(items, undefined)).toBe(items)
  })
})
