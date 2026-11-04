import { readFileSync } from 'node:fs'
import { describe, expect, it } from '@effect/vitest'
import { decodePng } from '@styld/imaging'
import { Effect, Layer, Option, Schema } from 'effect'
import { drawingOf } from '../src/capture/Drawing.ts'
import { GarmentVision, ImageGenerator } from '../src/capture/Providers.ts'
import { pictureKey, storedAs } from '../src/capture/Shared.ts'
import { CaptureStore, type PictureRow } from '../src/capture/Store.ts'
import { Database } from '../src/kernel/Db.ts'
import { CaptureMetrics } from '../src/kernel/Metrics.ts'
import { PieceChanged } from '../src/safety/PieceChanged.ts'
import { WardrobeStore } from '../src/wardrobe/Store.ts'
import { mediaOver } from './fakes/Bucket.ts'
import { localD1 } from './LocalD1.ts'

// A drawing's lifecycle over real SQLite rows (owner, 4 November 2026): a drawing Muse returns that keys and frames
// cleanly is shown, and the decision model is never asked how like its cut-out it is. The side's own rules (when to
// draw, a redraw's credit) are its slot's, tested with the side; the native journeys draw both sides end to end
// (CleanPictureAcceptance.ts).

const fixture = (name: string) => readFileSync(new URL(`fixtures/capture/${name}`, import.meta.url))
const cutout = decodePng(new Uint8Array(fixture('red-tee.png')))
/** Muse's recorded drawing of the red tee on green. */
const museTee = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ data: Schema.Tuple([Schema.Struct({ b64_json: Schema.String })]) })),
)(fixture('muse-edit-red-tee.json').toString('utf8'))
const drawnTee = Uint8Array.from(atob(museTee.data[0].b64_json), (character) => character.charCodeAt(0))

/** A provider call a drawing never makes: the decision model is asked only to judge the cut-out. */
const unasked = () => Effect.die(new Error('the decision model was asked about a drawing'))

/** Ana's red tee with its picture `state`, and the services a drawing runs on: Muse answers `answer`. */
const over = (state: PictureRow['state'], answer: Uint8Array, cleanKey: string | null = null) => {
  const database = localD1()
  database.sqlite.exec(`
    INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0);
    INSERT INTO pieces (id, account_id, type, colours, occasions, status, source, original_key, image_key,
      content_type, created_at, updated_at)
      VALUES ('pc_1', 'ac_1', 'shortSleeveTops', '[]', '[]', 'ready', 'website', 'k/pc_1', 'c/pc_1', 'image/png', 0, 0);
    INSERT INTO piece_pictures (piece_id, account_id, state, clean_key, version, redraws, paid, created_at, updated_at)
      VALUES ('pc_1', 'ac_1', '${state}', ${cleanKey === null ? 'NULL' : `'${cleanKey}'`}, 0, 0, 0, 0, 0);
  `)
  const stored = new Map<string, Uint8Array>()
  const drawn: Array<string> = []
  const services = Layer.mergeAll(
    Layer.mergeAll(CaptureStore.layer, WardrobeStore.layer).pipe(Layer.provide(Database.layer(database))),
    mediaOver(stored),
    CaptureMetrics.discard,
    Layer.succeed(PieceChanged, PieceChanged.of({ changed: () => Effect.void })),
    Layer.succeed(
      ImageGenerator,
      ImageGenerator.of({
        provider: 'meta-muse',
        model: 'muse-image-1.0',
        draw: (request) => Effect.sync(() => (drawn.push(request.side), { bytes: answer, contentType: 'image/png' })),
        profile: unasked,
      }),
    ),
    Layer.succeed(
      GarmentVision,
      GarmentVision.of({
        route: unasked,
        suggest: unasked,
        checkHeld: unasked,
        judge: () => Effect.succeed({ verdict: 'improve', confidence: 0.9, face: 0.01 }),
        sameGarment: unasked,
        compareTurn: unasked,
      }),
    ),
  )
  return { database, stored, drawn, layer: services }
}

/** The front's drawing, drawn whenever it is queued: the plan is the side's (`Pictures.ts`, `BackPicture.ts`). */
const front = drawingOf({
  side: 'front',
  kind: () => 'first',
  find: (pieceId) => Effect.flatMap(CaptureStore, (store) => storedAs(store.findPicture(pieceId))),
  write: (pieceId, from, changes) =>
    Effect.flatMap(CaptureStore, (store) => storedAs(store.movePicture(pieceId, from, changes))),
  keyOf: (picture, version) => pictureKey(picture.accountId, picture.pieceId, version),
  cutouts: () => Effect.succeed({ subject: Option.some(cutout), other: Option.none() }),
  plan: () => 'draw',
  hint: () => Option.none(),
  after: () => Effect.void,
})

const pictureOf = (database: ReturnType<typeof localD1>) =>
  database.sqlite.prepare('SELECT state, clean_key AS cleanKey, version FROM piece_pictures').get()

describe("a piece's drawing", () => {
  it.effect('is shown as soon as Muse draws it and it keys cleanly, never compared with its cut-out', () => {
    const { database, stored, drawn, layer } = over('queued', drawnTee)
    return Effect.gen(function* () {
      yield* front.process('pc_1')
      const key = 'accounts/ac_1/pieces/pc_1/clean-1.png'
      expect(pictureOf(database)).toEqual({ state: 'ready', cleanKey: key, version: 1 })
      expect(drawn).toEqual(['front'])
      expect(stored.has(key)).toBe(true)
      // Delivered again, the shown drawing is left as it is.
      yield* front.process('pc_1')
      expect(drawn).toHaveLength(1)
    }).pipe(Effect.provide(layer))
  })

  it.effect('fails, and stores nothing, when what Muse returns does not key on its colour', () => {
    const { database, stored, layer } = over('queued', new Uint8Array([1, 2, 3]))
    return Effect.gen(function* () {
      yield* front.process('pc_1')
      expect(pictureOf(database)).toEqual({ state: 'failed', cleanKey: null, version: 1 })
      expect(stored.size).toBe(0)
    }).pipe(Effect.provide(layer))
  })

  it.effect('stored before the 4 November release and waiting for its check, is shown as it is', () => {
    const key = 'accounts/ac_1/pieces/pc_1/clean-0.png'
    const { database, drawn, layer } = over('checking', drawnTee, key)
    return Effect.gen(function* () {
      yield* front.process('pc_1')
      expect(pictureOf(database)).toEqual({ state: 'ready', cleanKey: key, version: 0 })
      expect(drawn).toEqual([])
    }).pipe(Effect.provide(layer))
  })
})
