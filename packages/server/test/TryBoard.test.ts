import { describe, expect, it } from '@effect/vitest'
import { BoardId, CurrentAccount, OperationId, PieceId } from '@styld/protocol'
import { Effect, Layer, Match, Predicate, Redacted } from 'effect'
import { Boards } from '../src/boards/Boards.ts'
import { BoardStore } from '../src/boards/Store.ts'
import { missingLabel, swapsFor, TryBoards } from '../src/boards/Try.ts'
import { Database } from '../src/kernel/Db.ts'
import { CaptureMetrics } from '../src/kernel/Metrics.ts'
import { SignedMedia } from '../src/kernel/SignedMedia.ts'
import { Looks } from '../src/looks/Looks.ts'
import { Outfits } from '../src/outfits/Outfits.ts'
import { PublicPages } from '../src/social/Public.ts'
import { ReaderLocale } from '../src/social/Translated.ts'
import { WardrobeStore } from '../src/wardrobe/Store.ts'
import { localD1 } from './LocalD1.ts'
import { noMedia, passingChecks } from './PassingChecks.ts'

// Try with my wardrobe (owner, 4 November 2026): a house board's generated pieces stood in for by the person's own,
// on a new private board of theirs, a label where nothing fits; the house board and the person's wardrobe unchanged.

const piece = (name: string) => PieceId.make(`pc_${name.padEnd(22, '0')}`)
const houseBoard = BoardId.make(`bd_${'look'.padEnd(22, '0')}`)
const plainBoard = BoardId.make(`bd_${'plain'.padEnd(22, '0')}`)

const pieceRow = (id: string, account: string, name: string, type: string, colours: string, created: number) =>
  `('${piece(id)}', '${account}', '${name}', '${type}', '${colours}', '[]', 'ready', 'import', 'o/${id}', 'c/${id}',
    'image/png', ${String(created)}, ${String(created)})`

/** The house's public look of a generated white shirt, navy trousers and brown loafers under a label, and a public
 * board of a photographed scarf; Ana owns a white shirt and navy trousers, and a blue shirt she wore last. */
const seeded = () => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at)
      VALUES ('ac_house', 0, 'Styld Women', 0), ('ac_ana', 0, 'Ana', 0);
    INSERT INTO profiles (account_id, handle, name, tone, published, house, search_text, created_at, updated_at)
      VALUES ('ac_house', 'styld.women', 'Styld Women', 'sand', 1, 1, ' styld women', 0, 0);
    INSERT INTO pieces (id, account_id, name, type, colours, occasions, status, source, original_key, image_key,
        content_type, created_at, updated_at)
      VALUES ${[
        pieceRow('hshirt', 'ac_house', 'White shirt', 'shirts', '["white"]', 1),
        pieceRow('htrousers', 'ac_house', 'Navy trousers', 'trousers', '["navy"]', 1),
        pieceRow('hloafers', 'ac_house', 'Brown loafers', 'loafers', '["brown"]', 1),
        pieceRow('hscarf', 'ac_house', 'Red scarf', 'scarves', '["red"]', 1),
        pieceRow('ashirt', 'ac_ana', 'My white shirt', 'shirts', '["white","blue"]', 3),
        pieceRow('ablue', 'ac_ana', 'Blue shirt', 'shirts', '["blue"]', 2),
        pieceRow('atrousers', 'ac_ana', 'My navy trousers', 'trousers', '["navy"]', 1),
      ].join(',')};
    INSERT INTO worn_pieces (account_id, day, piece_id, position) VALUES ('ac_ana', '2026-11-01', '${piece('ablue')}', 0);
    INSERT INTO piece_provenance (piece_id, account_id, origin, manifest_id, model, prompt_digest, updated_at)
      VALUES ('${piece('hshirt')}', 'ac_house', 'generated', 'w-shirts-white', 'muse-image-1.0', 'd', 0),
        ('${piece('htrousers')}', 'ac_house', 'generated', 'w-trousers-navy', 'muse-image-1.0', 'd', 0),
        ('${piece('hloafers')}', 'ac_house', 'generated', 'w-loafers-brown', 'muse-image-1.0', 'd', 0),
        ('${piece('hscarf')}', 'ac_house', 'photo', 'u-scarves-red', NULL, NULL, 0);
    INSERT INTO boards (id, account_id, name, paper, version, visibility, moods, published_at, search_text,
        created_at, updated_at)
      VALUES ('${houseBoard}', 'ac_house', 'Office in navy', 'sage', 1, 'public', '[]', 10, ' office navy', 0, 0),
        ('${plainBoard}', 'ac_house', 'Red scarf', 'sand', 1, 'public', '[]', 20, ' red scarf', 0, 0);
    INSERT INTO board_items (id, board_id, kind, piece_id, text, text_style, x, y, size, turn, z, flipped)
      VALUES ('bi_${'shirt'.padEnd(22, '0')}', '${houseBoard}', 'piece', '${piece('hshirt')}', NULL, NULL,
          290, 320, 480, -3, 1, 0),
        ('bi_${'trousers'.padEnd(22, '0')}', '${houseBoard}', 'piece', '${piece('htrousers')}', NULL, NULL,
          320, 860, 460, 2, 2, 0),
        ('bi_${'loafers'.padEnd(22, '0')}', '${houseBoard}', 'piece', '${piece('hloafers')}', NULL, NULL,
          735, 945, 380, -6, 3, 0),
        ('bi_${'label'.padEnd(22, '0')}', '${houseBoard}', 'text', NULL, 'Monday', 'headline', 500, 80, 400, 0, 4, 0),
        ('bi_${'scarf'.padEnd(22, '0')}', '${plainBoard}', 'piece', '${piece('hscarf')}', NULL, NULL,
          500, 500, 400, 0, 1, 0);
    INSERT INTO board_pins (id, board_id, kind, piece_id, created_at)
      VALUES ('pn_${'shirt'.padEnd(22, '0')}', '${houseBoard}', 'piece', '${piece('hshirt')}', 5),
        ('pn_${'trousers'.padEnd(22, '0')}', '${houseBoard}', 'piece', '${piece('htrousers')}', 5),
        ('pn_${'loafers'.padEnd(22, '0')}', '${houseBoard}', 'piece', '${piece('hloafers')}', 5),
        ('pn_${'scarf'.padEnd(22, '0')}', '${plainBoard}', 'piece', '${piece('hscarf')}', 5);
    INSERT INTO content_checks (target_kind, target_id, account_id, digest, state, requested_at)
      VALUES ('profile', 'ac_house', 'ac_house', 'd', 'passed', 0),
        ('board', '${houseBoard}', 'ac_house', 'd', 'passed', 0),
        ('board', '${plainBoard}', 'ac_house', 'd', 'passed', 0),
        ${['hshirt', 'htrousers', 'hloafers', 'hscarf'].map((id) => `('piece', '${piece(id)}', 'ac_house', 'd', 'passed', 0)`).join(',')};
  `)
  const services = TryBoards.layer.pipe(
    Layer.provideMerge(Boards.layer),
    Layer.provideMerge(Layer.mergeAll(PublicPages.layer, Looks.layer)),
    Layer.provideMerge(Layer.mergeAll(BoardStore.layer, WardrobeStore.layer)),
    Layer.provideMerge(passingChecks),
    Layer.provideMerge(
      Layer.mergeAll(
        Database.layer(database),
        noMedia,
        SignedMedia.layer(Redacted.make('try-board-test-signing-secret-32-characters')),
        Layer.succeed(CaptureMetrics, CaptureMetrics.discarding),
        // Trying a board makes no outfits: the engine is never asked.
        Layer.succeed(Outfits, Outfits.of({ make: () => Effect.die('not used'), sweep: () => Effect.die('not used') })),
        Layer.succeed(CurrentAccount, CurrentAccount.of({ accountId: 'ac_ana', via: 'session' })),
      ),
    ),
  )
  return { database, services }
}

describe('a swap from the person’s own', () => {
  it('is of the same type, shares the most colours, then has the first colour, then was worn last; each used once', () => {
    const wanted = [
      { id: piece('w1'), type: 'shirts', colours: ['white', 'blue'] },
      { id: piece('w2'), type: 'shirts', colours: ['blue'] },
      { id: piece('w3'), type: 'loafers', colours: ['brown'] },
    ] as const
    const own = [
      { id: piece('o1'), type: 'shirts', colours: ['blue'], lastWorn: '2026-11-01' },
      { id: piece('o2'), type: 'shirts', colours: ['white', 'blue'], lastWorn: null },
      { id: piece('o3'), type: 'shirts', colours: ['blue'], lastWorn: '2026-11-03' },
    ] as const
    expect([...swapsFor(wanted, own)]).toEqual([
      [piece('w1'), piece('o2')],
      [piece('w2'), piece('o3')],
    ])
  })

  it('names what is missing in the reader’s language', () => {
    expect(missingLabel({ type: 'loafers', colours: ['brown'] }, 'en')).toBe('No brown loafers yet')
    expect(missingLabel({ type: 'loafers', colours: [] }, 'en')).toBe('No loafers yet')
    expect(missingLabel({ type: 'loafers', colours: ['brown'] }, 'sl')).toMatch(/^Še manjka: mokasini, /u)
  })
})

describe('trying a house board with one’s own wardrobe', () => {
  it.effect('makes a private board of the person’s two pieces where the house’s lay, a label for the third', () => {
    const { database, services } = seeded()
    const before = database.sqlite.prepare('SELECT count(*) AS n FROM pieces').get()
    const houseItems = database.sqlite.prepare(`SELECT * FROM board_items WHERE board_id = '${houseBoard}'`).all()
    return Effect.gen(function* () {
      const tries = yield* TryBoards
      const tried = yield* tries.tryBoard(houseBoard, { operationId: OperationId.make('try-office-1') })
      expect({ fromWardrobe: tried.fromWardrobe, of: tried.of }).toEqual({ fromWardrobe: 2, of: 3 })
      const board = yield* (yield* Boards).getBoard(tried.boardId)
      expect({ name: board.name, paper: board.paper, visibility: board.visibility }).toEqual({
        name: 'Office in navy',
        paper: 'sage',
        visibility: 'private',
      })
      expect(
        board.items.map((item) =>
          Match.value(item).pipe(
            Match.tagsExhaustive({
              PieceItem: ({ pieceId, x, y }) => [pieceId, x, y],
              TextItem: ({ text }) => ['label', text],
              ImageItem: () => ['picture'],
            }),
          ),
        ),
      ).toEqual([
        [piece('ashirt'), 290, 320],
        [piece('atrousers'), 320, 860],
        ['label', 'No brown loafers yet'],
        ['label', 'Monday'],
      ])
      // Only the person's own pieces are pinned; the house's never.
      expect(
        board.pins.flatMap((pin) => (Predicate.isTagged(pin, 'PiecePin') ? [pin.piece.id] : [])).toSorted(),
      ).toEqual([piece('ashirt'), piece('atrousers')].toSorted())
      // The same try again answers the same board, made once.
      const again = yield* tries.tryBoard(houseBoard, { operationId: OperationId.make('try-office-1') })
      expect(again.boardId).toBe(tried.boardId)
      expect(database.sqlite.prepare("SELECT count(*) AS n FROM boards WHERE account_id = 'ac_ana'").get()).toEqual({
        n: 1,
      })
      // Nothing written to the wardrobe, and the house board as it was.
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM pieces').get()).toEqual(before)
      expect(database.sqlite.prepare(`SELECT * FROM board_items WHERE board_id = '${houseBoard}'`).all()).toEqual(
        houseItems,
      )
    }).pipe(Effect.provide(services), Effect.provideService(ReaderLocale, 'en'))
  })

  it.effect('finds no board with nothing generated on it to try', () => {
    const { services } = seeded()
    return Effect.gen(function* () {
      const refused = yield* Effect.flip(
        (yield* TryBoards).tryBoard(plainBoard, { operationId: OperationId.make('try-scarf-1') }),
      )
      expect(refused).toMatchObject({ _tag: 'NotFound' })
    }).pipe(Effect.provide(services))
  })

  it.effect('labels what is missing in Slovenian for a Slovenian reader', () => {
    const { services } = seeded()
    return Effect.gen(function* () {
      const tried = yield* (yield* TryBoards).tryBoard(houseBoard, { operationId: OperationId.make('try-office-sl') })
      const board = yield* (yield* Boards).getBoard(tried.boardId)
      const texts = board.items.flatMap((item) => (Predicate.isTagged(item, 'TextItem') ? [item.text] : []))
      expect(texts[0]).toMatch(/^Še manjka: mokasini, /u)
    }).pipe(Effect.provide(services), Effect.provideService(ReaderLocale, 'sl'))
  })
})
