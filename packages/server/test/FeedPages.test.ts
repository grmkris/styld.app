import { describe, expect, it } from '@effect/vitest'
import type { NotFound, Unavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import { PublicPages } from '../src/social/Public.ts'
import { localD1 } from './LocalD1.ts'
import { publicPagesOver } from './PassingChecks.ts'

// A page of What's new reads its boards and looks at once (`PublicPages.feed`), through the same rules as each one's
// own page: what the reader may see is exactly what the page answers, item for item, and what they may not (a block, an
// unpublished profile, a private board, a failed check, one gone) is simply not there. A store that does not answer
// fails the page; it never reads as an empty feed.

const id = (prefix: string, name: string) => `${prefix}_${name.padEnd(22, '0')}`
const board = (name: string) => id('bd', name)
const look = (name: string) => id('lk', name)
const piece = (name: string) => id('pc', name)
const pin = (name: string) => id('pn', name)

/** Ana reads. Luka and Eva are published; Ana blocked Eva; Mia's profile is unpublished. Luka's public board pins his
 * coat, his shared look and Eva's scarf (which is not his to show); his other board failed its check. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_ana', 0, 'Ana', 0),
      ('ac_luka', 0, 'Luka', 0), ('ac_eva', 0, 'Eva', 0), ('ac_mia', 0, 'Mia', 0);
    INSERT INTO profiles (account_id, handle, name, tone, published, house, search_text, created_at, updated_at)
      VALUES ('ac_luka', 'luka', 'Luka', 'sand', 1, 0, ' luka', 0, 0), ('ac_eva', 'eva', 'Eva', 'sand', 1, 0, ' eva', 0, 0),
        ('ac_mia', 'mia', 'Mia', 'sand', 0, 0, ' mia', 0, 0);
    INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ('ac_ana', 'ac_eva', 0);
    INSERT INTO pieces (id, account_id, name, type, colours, occasions, status, source, original_key, image_key,
        content_type, created_at, updated_at)
      VALUES ('${piece('coat')}', 'ac_luka', 'Navy coat', 'coats', '["navy"]', '[]', 'ready', 'import', 'o/coat',
          'c/coat', 'image/png', 0, 0),
        ('${piece('scarf')}', 'ac_eva', 'Red scarf', 'scarves', '["red"]', '[]', 'ready', 'import', 'o/scarf',
          'c/scarf', 'image/png', 0, 0);
    INSERT INTO looks (id, account_id, name, created_at, shared_at) VALUES
      ('${look('luka')}', 'ac_luka', 'Rain', 0, 120), ('${look('eva')}', 'ac_eva', 'Sun', 0, 130),
      ('${look('kept')}', 'ac_luka', 'Kept', 0, NULL);
    INSERT INTO look_pieces (look_id, piece_id, position) VALUES ('${look('luka')}', '${piece('coat')}', 0),
      ('${look('eva')}', '${piece('scarf')}', 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, published_at, search_text, created_at,
        updated_at) VALUES
      ('${board('luka')}', 'ac_luka', 'Coats', 'sand', 1, 'public', '[]', 100, ' coats', 0, 0),
      ('${board('failed')}', 'ac_luka', 'Failed', 'sand', 1, 'public', '[]', 100, ' failed', 0, 0),
      ('${board('private')}', 'ac_luka', 'Draft', 'sand', 1, 'private', '[]', NULL, ' draft', 0, 0),
      ('${board('eva')}', 'ac_eva', 'Scarves', 'sand', 1, 'public', '[]', 100, ' scarves', 0, 0),
      ('${board('mia')}', 'ac_mia', 'Hats', 'sand', 1, 'public', '[]', 100, ' hats', 0, 0);
    INSERT INTO board_items (id, board_id, kind, piece_id, x, y, size, turn, z, flipped)
      VALUES ('${id('bi', 'coat')}', '${board('luka')}', 'piece', '${piece('coat')}', 500, 600, 400, 0, 1, 0),
        ('${id('bi', 'scarf')}', '${board('luka')}', 'piece', '${piece('scarf')}', 300, 300, 300, 0, 2, 0);
    INSERT INTO board_pins (id, board_id, kind, piece_id, look_id, created_at) VALUES
      ('${pin('coat')}', '${board('luka')}', 'piece', '${piece('coat')}', NULL, 5),
      ('${pin('scarf')}', '${board('luka')}', 'piece', '${piece('scarf')}', NULL, 6),
      ('${pin('look')}', '${board('luka')}', 'look', NULL, '${look('luka')}', 7),
      ('${pin('evalook')}', '${board('eva')}', 'look', NULL, '${look('eva')}', 8);
    INSERT INTO content_checks (target_kind, target_id, account_id, digest, state, requested_at) VALUES
      ('profile', 'ac_luka', 'ac_luka', 'd', 'passed', 0), ('profile', 'ac_eva', 'ac_eva', 'd', 'passed', 0),
      ('profile', 'ac_mia', 'ac_mia', 'd', 'passed', 0),
      ('board', '${board('luka')}', 'ac_luka', 'd', 'passed', 0), ('board', '${board('failed')}', 'ac_luka', 'd', 'failed', 0),
      ('board', '${board('private')}', 'ac_luka', 'd', 'passed', 0), ('board', '${board('eva')}', 'ac_eva', 'd', 'passed', 0),
      ('board', '${board('mia')}', 'ac_mia', 'd', 'passed', 0),
      ('look', '${look('luka')}', 'ac_luka', 'd', 'passed', 0), ('look', '${look('eva')}', 'ac_eva', 'd', 'passed', 0),
      ('look', '${look('kept')}', 'ac_luka', 'd', 'passed', 0),
      ('piece', '${piece('coat')}', 'ac_luka', 'd', 'passed', 0), ('piece', '${piece('scarf')}', 'ac_eva', 'd', 'passed', 0);
  `)
  return database
}

/** What a thing's own page answers: it, or nothing when the page is not found. */
const ownPage = <A, R>(page: Effect.Effect<A, NotFound | Unavailable, R>) =>
  page.pipe(
    Effect.map((value): A | undefined => value),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
  )

const boardIds = ['luka', 'failed', 'private', 'eva', 'mia', 'gone'].map(board)
const lookIds = ['luka', 'eva', 'kept', 'gone'].map(look)

describe('a page of the feed', () => {
  it.effect('shows each board and look exactly as its own page does, and nothing the reader may not see', () => {
    const database = seeded()
    return Effect.gen(function* () {
      const pages = yield* PublicPages
      for (const viewer of [Option.some('ac_ana'), Option.some('ac_luka'), Option.none<string>()]) {
        const page = yield* pages.feed(boardIds, lookIds, viewer)
        for (const boardId of boardIds)
          expect(page.boards.get(boardId)).toEqual(yield* ownPage(pages.board(boardId, viewer)))
        for (const lookId of lookIds) expect(page.looks.get(lookId)).toEqual(yield* ownPage(pages.look(lookId, viewer)))
      }
      const ana = yield* pages.feed(boardIds, lookIds, Option.some('ac_ana'))
      expect([...ana.boards.keys()]).toEqual([board('luka')])
      expect([...ana.looks.keys()]).toEqual([look('luka')])
      // Eva's scarf is on Luka's board, but it is not his to show: only his coat and his look are pinned for others.
      expect(ana.boards.get(board('luka'))?.pins.map(({ id: pinId }) => pinId)).toEqual([pin('look'), pin('coat')])
    }).pipe(Effect.provide(publicPagesOver(database)))
  })

  it.effect('fails when the store does not answer, rather than reading as empty', () => {
    const database = seeded()
    return Effect.gen(function* () {
      const pages = yield* PublicPages
      database.sqlite.exec('DROP TABLE board_pins')
      expect(yield* Effect.flip(pages.feed(boardIds, lookIds, Option.some('ac_ana')))).toMatchObject({
        _tag: 'Unavailable',
      })
    }).pipe(Effect.provide(publicPagesOver(database)))
  })
})
