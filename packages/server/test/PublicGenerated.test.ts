import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { PublicPages } from '../src/social/Public.ts'
import { localD1 } from './LocalD1.ts'
import { publicPagesOver } from './PassingChecks.ts'

// A house garment Styld generated is always shown marked (owner, 4 November 2026): public reads say so of the piece,
// of a board that shows it pinned or on its table, and of a look that wears it; anything else says it is not.

const piece = (name: string) => `pc_${name.padEnd(22, '0')}`
const board = (name: string) => `bd_${name.padEnd(22, '0')}`

/** The house account with two public boards, one showing a generated coat and one a photographed scarf. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Styld Women', 0);
    INSERT INTO profiles (account_id, handle, name, tone, published, house, search_text, created_at, updated_at)
      VALUES ('ac_1', 'styld.women', 'Styld Women', 'sand', 1, 1, ' styld women', 0, 0);
    INSERT INTO pieces (id, account_id, name, type, colours, occasions, status, source, original_key, image_key,
        content_type, created_at, updated_at)
      VALUES ('${piece('coat')}', 'ac_1', 'Navy coat', 'coats', '["navy"]', '[]', 'ready', 'import', 'o/coat',
          'c/coat', 'image/png', 0, 0),
        ('${piece('scarf')}', 'ac_1', 'Red scarf', 'scarves', '["red"]', '[]', 'ready', 'import', 'o/scarf',
          'c/scarf', 'image/png', 0, 0);
    INSERT INTO piece_provenance (piece_id, account_id, origin, manifest_id, model, prompt_digest, updated_at)
      VALUES ('${piece('coat')}', 'ac_1', 'generated', 'w-coats-navy', 'muse-image-1.0', 'd', 0),
        ('${piece('scarf')}', 'ac_1', 'photo', 'u-scarves-red', NULL, NULL, 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, published_at, search_text,
        created_at, updated_at)
      VALUES ('${board('coats')}', 'ac_1', 'Coats', 'sand', 1, 'public', '[]', 10, ' coats', 0, 0),
        ('${board('scarves')}', 'ac_1', 'Scarves', 'sand', 1, 'public', '[]', 20, ' scarves', 0, 0);
    INSERT INTO board_items (id, board_id, kind, piece_id, x, y, size, turn, z, flipped)
      VALUES ('bi_${'coat'.padEnd(22, '0')}', '${board('coats')}', 'piece', '${piece('coat')}', 500, 600, 400, 0, 1, 0);
    INSERT INTO board_pins (id, board_id, kind, piece_id, created_at)
      VALUES ('pn_${'scarf'.padEnd(22, '0')}', '${board('scarves')}', 'piece', '${piece('scarf')}', 5),
        ('pn_${'coat'.padEnd(22, '0')}', '${board('coats')}', 'piece', '${piece('coat')}', 5);
    INSERT INTO content_checks (target_kind, target_id, account_id, digest, state, requested_at)
      VALUES ('profile', 'ac_1', 'ac_1', 'd', 'passed', 0), ('board', '${board('coats')}', 'ac_1', 'd', 'passed', 0),
        ('board', '${board('scarves')}', 'ac_1', 'd', 'passed', 0), ('piece', '${piece('coat')}', 'ac_1', 'd', 'passed', 0),
        ('piece', '${piece('scarf')}', 'ac_1', 'd', 'passed', 0);
  `)
  return publicPagesOver(database)
}

describe('a house garment Styld generated', () => {
  it.effect('marks its piece and every board that shows it, and nothing else', () =>
    Effect.gen(function* () {
      const pages = yield* PublicPages
      expect((yield* pages.board(board('coats'))).generated).toBe(true)
      expect((yield* pages.board(board('scarves'))).generated).toBe(false)
      expect((yield* pages.piece(piece('coat'))).piece.generated).toBe(true)
      expect((yield* pages.piece(piece('scarf'))).piece.generated).toBe(false)
      const profile = yield* pages.profile('styld.women')
      expect(profile.boards.map(({ name, generated }) => [name, generated])).toEqual([
        ['Scarves', false],
        ['Coats', true],
      ])
    }).pipe(Effect.provide(seeded())),
  )
})
