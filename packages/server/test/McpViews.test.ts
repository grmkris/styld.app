import {
  CurrentAccount,
  GalleryView,
  type Photo,
  PhotoGarmentId,
  PhotoId,
  type Piece,
  PieceId,
  PiecesView,
  PieceView,
  type TryOn,
  TryOnId,
  TryOnView,
  ViewImages,
} from '@styld/protocol'
import { it } from '@effect/vitest'
import { type Duration, Effect, Fiber, Option, Redacted, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, test } from 'vitest'
import { mediaViewTools, type MediaServices } from '../src/mcp/MediaViewTools.ts'
import { viewTools } from '../src/mcp/ViewTools.ts'
import { Boards } from '../src/boards/Boards.ts'
import { unusedBoards } from './fakes/Boards.ts'
import { unusedWardrobe } from './fakes/Wardrobe.ts'
import { callTool } from '../src/mcp/Tools.ts'
import { readResource, resources, viewsUri } from '../src/mcp/Resources.ts'
import { type MediaGrant, SignedMedia } from '../src/kernel/SignedMedia.ts'
import type { ImageBindings } from '../src/wardrobe/Delivery.ts'

// The media views inside ChatGPT and Claude: what the model reads (the view's JSON) never holds a picture or an
// address; the pictures travel in `_meta` as thumbnails of what the read behind the view authorized.

const secret = Redacted.make('native-test-signing-secret-32-characters')

/** Sign each grant the way the services do, for the collector the view's read installs. */
const signing = <A>(value: A, grants: ReadonlyArray<Omit<MediaGrant, 'accountId'>>) =>
  Effect.gen(function* () {
    const signed = yield* SignedMedia
    for (const grant of grants) yield* signed.address(grant)
    return value
  }).pipe(Effect.provide(SignedMedia.layer(secret)))

const thumb = (entityId: string, key: string, version = '1') => ({
  entityId,
  key: `accounts/acc_1/${key}`,
  contentType: 'image/png',
  variant: 'thumb',
  version,
})

const piece = (letter: string, fields: Partial<Piece> = {}): Piece => ({
  id: PieceId.make(`pc_${letter.repeat(22)}`),
  type: 'shortSleeveTops',
  name: null,
  notes: null,
  colours: ['white'],
  seasons: [],
  rainproof: false,
  category: null,
  occasions: [],
  pattern: null,
  brand: null,
  shopUrl: null,
  hasBack: false,
  rotation: 0,
  source: 'website',
  status: 'ready',
  createdAt: '2026-11-04T00:00:00.000Z',
  updatedAt: '2026-11-04T00:00:00.000Z',
  ...fields,
})

const pieces = Array.from('abcdefghi', (letter) => piece(letter, { name: `Piece ${letter}` }))
const photoId = PhotoId.make(`ph_${'p'.repeat(22)}`)
const photo = (id: string, day: string): Photo => ({
  id: PhotoId.make(id),
  status: 'ready',
  favourite: false,
  garments: [
    {
      id: PhotoGarmentId.make(`pg_${'g'.repeat(22)}`),
      type: 'jeans',
      colours: ['navy'],
      match: 'suggested',
      pieceId: null,
    },
  ],
  lookId: null,
  hasCutout: true,
  createdAt: `${day}T10:00:00.000Z`,
})
const tryOnId = TryOnId.make(`to_${'t'.repeat(22)}`)
const tryOn = (status: TryOn['status']): TryOn => ({
  id: tryOnId,
  photoId,
  pieceIds: [pieces[0]?.id ?? PieceId.make(`pc_${'a'.repeat(22)}`)],
  status,
  createdAt: '2026-11-04T10:00:00.000Z',
})

const unused = (): never => {
  throw new Error('unused image operation')
}

/** Every thumbnail is a WebP of `bytes` bytes. */
const mediaOf = (bytes: number): ImageBindings => {
  const output = {
    image: () => new Blob([new Uint8Array(bytes)]).stream(),
    contentType: () => 'image/webp',
    response: unused,
  }
  const transformer = { transform: () => transformer, draw: unused, output: async () => output }
  return {
    bucket: { get: async () => ({ body: new Blob(['png']).stream() }) },
    images: { input: () => transformer },
  } satisfies ImageBindings
}

const servicesFor = (status: TryOn['status'], bytes = 4): MediaServices => ({
  origin: 'https://styld.test',
  media: mediaOf(bytes),
  wardrobe: {
    listPieces: () =>
      signing(
        pieces,
        pieces.map(({ id }) => thumb(id, `pieces/${id}/shown`)),
      ),
    getPiece: (id) =>
      signing(piece('a', { name: 'Navy knit', brand: 'Arket' }), [
        thumb(id, `uploads/original`, '1.photo0'),
        { ...thumb(id, `uploads/original`, '1.photo0'), variant: 'full' },
        { ...thumb(id, `pieces/${id}/clean-2.png`, '1.clean2'), variant: 'full' },
        { ...thumb(id, `pieces/${id}/back.png`, '1.back'), variant: 'full' },
        { ...thumb(id, `pieces/${id}/cutout.png`, '1.cutout'), variant: 'full' },
      ]),
  },
  tryOns: {
    get: () =>
      signing(tryOn(status), status === 'done' ? [thumb(tryOnId, `photos/${photoId}/try-ons/${tryOnId}.png`)] : []),
  },
  photos: {
    listPhotos: () =>
      signing(
        Array.from({ length: 13 }, (_, at) => photo(`ph_${String(at).padStart(22, 'q')}`, '2026-11-04')),
        Array.from({ length: 13 }, (_, at) => thumb(`ph_${String(at).padStart(22, 'q')}`, `uploads/${String(at)}`)),
      ),
    getPhoto: () =>
      signing(photo(photoId, '2026-11-03'), [
        thumb(photoId, 'uploads/before'),
        thumb(photoId, `photos/${photoId}/cutout.png`),
      ]),
  },
})

const calling = (services: MediaServices, name: string, args: unknown) =>
  callTool(mediaViewTools(services), name, args).pipe(
    Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'acc_1', via: 'assistant' })),
  )

const call = (services: MediaServices, name: string, args: unknown) => Effect.runPromise(calling(services, name, args))

/** A try-on read as each status in turn, one per read, staying on the last; `reads` counts the reads. */
const drawnAfter = (statuses: ReadonlyArray<TryOn['status']>) => {
  const reads = { count: 0 }
  const at = (index: number) => statuses[Math.min(index, statuses.length - 1)] ?? 'drawing'
  const services: MediaServices = {
    ...servicesFor('done'),
    tryOns: {
      get: () =>
        Effect.suspend(() => {
          const status = at(reads.count)
          reads.count += 1
          return signing(
            tryOn(status),
            status === 'done' ? [thumb(tryOnId, `photos/${photoId}/try-ons/${tryOnId}.png`)] : [],
          )
        }),
    },
  }
  return { services, reads }
}

const shownAfter = (services: MediaServices, wait: Duration.Input) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(calling(services, 'tryon_show', { tryOnId }))
    yield* TestClock.adjust(wait)
    return yield* Schema.decodeUnknownEffect(Shown)(yield* Fiber.join(fiber))
  })

/** A view result as a host receives it: the view the model reads, and the pictures only the view gets. */
const Shown = Schema.Struct({
  structuredContent: Schema.optionalKey(Schema.Unknown),
  _meta: Schema.optionalKey(Schema.Struct({ 'styld/images': ViewImages })),
  isError: Schema.optionalKey(Schema.Boolean),
})
type Shown = typeof Shown.Type

const shownBy = async (services: MediaServices, name: string, args: unknown) =>
  Schema.decodeUnknownSync(Shown)(await call(services, name, args))

const imagesOf = (result: Shown) =>
  Option.getOrElse(Option.fromNullishOr(result['_meta']), () => ({ 'styld/images': {} }))['styld/images']

/** The model's half of a result: never a picture and never an address it could load one by. */
const modelSeesNoPicture = (result: Shown) => {
  const seen = JSON.stringify(result.structuredContent)
  expect(seen).not.toContain('data:')
  expect(seen).not.toContain('/cdn/')
}

describe('the media views', () => {
  test('a try-on shows its photo beside its result and the pieces it wears', async () => {
    const result = await shownBy(servicesFor('done'), 'tryon_show', { tryOnId })
    expect(Schema.is(TryOnView)(result.structuredContent)).toBe(true)
    expect(result.structuredContent).toMatchObject({
      _tag: 'TryOnView',
      status: 'done',
      before: `photo:${photoId}`,
      after: `tryOn:${tryOnId}`,
      url: `https://styld.test/try-on/${tryOnId}`,
      pieces: [{ id: pieces[0]?.id, name: 'Piece a' }],
      labels: { en: { before: 'Before', after: 'After' }, sl: { before: 'Prej' } },
    })
    expect(Object.keys(imagesOf(result)).toSorted()).toEqual(
      [`photo:${photoId}`, `tryOn:${tryOnId}`, pieces[0]?.id ?? ''].toSorted(),
    )
    modelSeesNoPicture(result)
  })

  test('a try-on being drawn is read again until it is drawn, then shown with its result', async () => {
    const { services, reads } = drawnAfter(['admitting', 'done'])
    const result = await shownBy(services, 'tryon_show', { tryOnId })
    expect(result.structuredContent).toMatchObject({ _tag: 'TryOnView', status: 'done' })
    expect(imagesOf(result)).toHaveProperty(`tryOn:${tryOnId}`)
    expect(reads.count).toBe(2)
  })

  it.effect('a try-on still being drawn after 40 seconds says so, with no result to show', () =>
    Effect.gen(function* () {
      const { services } = drawnAfter(['drawing'])
      const result = yield* shownAfter(services, '41 seconds')
      expect(result.structuredContent).toMatchObject({ _tag: 'TryOnView', status: 'drawing' })
      expect(imagesOf(result)).not.toHaveProperty(`tryOn:${tryOnId}`)
    }),
  )

  it.effect('a refused try-on is shown at once, without waiting', () =>
    Effect.gen(function* () {
      const { services, reads } = drawnAfter(['refused'])
      const result = yield* shownAfter(services, '0 seconds')
      expect(result.structuredContent).toMatchObject({ _tag: 'TryOnView', status: 'stopped' })
      expect(reads.count).toBe(1)
    }),
  )

  test('the Gallery shows the newest twelve photos, numbered, with what Styld found in each', async () => {
    const result = await shownBy(servicesFor('done'), 'gallery_show', {})
    const view = Schema.decodeUnknownSync(GalleryView)(result.structuredContent)
    expect(view.photos).toHaveLength(12)
    expect(view.photos.map(({ number }) => number)).toEqual(Array.from({ length: 12 }, (_, at) => at + 1))
    expect(view.photos[0]).toMatchObject({ day: '2026-11-04', found: ['navy jeans'] })
    expect(Object.keys(imagesOf(result))).toHaveLength(12)
    expect(Object.keys(imagesOf(result)).every((key) => key.startsWith('photo:'))).toBe(true)
    modelSeesNoPicture(result)
  })

  test('pieces show only the person’s own, in the order asked, and none of them is NotFound', async () => {
    const services = servicesFor('done')
    const stranger = PieceId.make(`pc_${'z'.repeat(22)}`)
    const result = await shownBy(services, 'pieces_show', {
      pieceIds: [pieces[1]?.id, stranger, pieces[0]?.id],
      title: 'For rain',
    })
    expect(result.structuredContent).toMatchObject({
      _tag: 'PiecesView',
      title: 'For rain',
      outfits: false,
      rows: [[{ id: pieces[1]?.id }, { id: pieces[0]?.id }]],
    })
    expect(Object.keys(imagesOf(result))).not.toContain(stranger)
    const none = await shownBy(services, 'pieces_show', { pieceIds: [stranger] })
    expect(none.isError).toBe(true)
  })

  test('outfits show one row each', async () => {
    const result = await shownBy(servicesFor('done'), 'outfits_show', {
      outfits: [{ pieceIds: [pieces[0]?.id, pieces[1]?.id] }, { pieceIds: [pieces[2]?.id] }],
    })
    const view = Schema.decodeUnknownSync(PiecesView)(result.structuredContent)
    expect(view).toMatchObject({ outfits: true, title: null })
    expect(view.rows).toHaveLength(2)
    modelSeesNoPicture(result)
  })

  test('a piece shows each of its pictures once, named', async () => {
    const id = pieces[0]?.id ?? ''
    const result = await shownBy(servicesFor('done'), 'piece_show', { pieceId: id })
    expect(Schema.is(PieceView)(result.structuredContent)).toBe(true)
    expect(result.structuredContent).toMatchObject({
      _tag: 'PieceView',
      piece: { name: 'Navy knit' },
      details: ['white t-shirt', 'Arket'],
      pictures: [
        { kind: 'shown', image: `piece:${id}:shown` },
        { kind: 'clean', image: `piece:${id}:clean` },
        { kind: 'back', image: `piece:${id}:back` },
        { kind: 'cutout', image: `piece:${id}:cutout` },
      ],
    })
    expect(Object.keys(imagesOf(result))).toHaveLength(4)
    modelSeesNoPicture(result)
  })

  test('a result’s pictures stay under its size cap: later tiles keep their place without one', async () => {
    const result = await shownBy(servicesFor('done', 199 * 1024), 'pieces_show', {
      pieceIds: pieces.map(({ id }) => id),
    })
    expect(Schema.decodeUnknownSync(PiecesView)(result.structuredContent).rows[0]).toHaveLength(9)
    expect(Object.keys(imagesOf(result))).toHaveLength(7)
  })
})

// wardrobe_show (owner, 4 November 2026): the whole wardrobe filled the host and its pictures ran out after 24, so it
// shows a page of 12, filtered like piece_search, with the count and the next page's cursor.
describe('wardrobe_show', () => {
  const many = Array.from({ length: 30 }, (_, at) =>
    piece('w', { id: PieceId.make(`pc_${String(at).padStart(22, 'w')}`), colours: [at % 3 === 0 ? 'navy' : 'white'] }),
  )
  const tools = viewTools(
    {
      ...unusedWardrobe,
      listPieces: () =>
        signing(
          many,
          many.map(({ id }) => thumb(id, `pieces/${id}/shown`)),
        ),
    },
    Boards.of(unusedBoards),
    'https://styld.test',
    mediaOf(4),
    { tryOns: servicesFor('done').tryOns, photos: servicesFor('done').photos },
  )
  const Page = Schema.Struct({
    pieces: Schema.Array(Schema.Struct({ id: Schema.String })),
    total: Schema.Number,
    nextCursor: Schema.NullOr(Schema.String),
  })
  const show = async (args: object) => {
    const result = Schema.decodeUnknownSync(Shown)(
      await Effect.runPromise(
        callTool(tools, 'wardrobe_show', args).pipe(
          Effect.provideService(CurrentAccount, CurrentAccount.of({ accountId: 'acc_1', via: 'assistant' })),
        ),
      ),
    )
    return { page: Schema.decodeUnknownSync(Page)(result.structuredContent), images: imagesOf(result) }
  }

  test('shows twelve pieces at a time, each with its picture, and where the next page starts', async () => {
    const first = await show({})
    expect(first.page.pieces.map(({ id }) => id)).toEqual(many.slice(0, 12).map(({ id }) => id))
    expect(Object.keys(first.images)).toHaveLength(12)
    expect(first.page).toMatchObject({ total: 30, nextCursor: '12' })
    const last = await show({ cursor: '24' })
    expect(last.page.pieces).toHaveLength(6)
    expect(last.page.nextCursor).toBeNull()
  })

  test('filters like piece_search and takes a smaller page', async () => {
    const navy = await show({ colour: 'navy', limit: 4 })
    expect(navy.page).toMatchObject({ total: 10, nextCursor: '4' })
    expect(navy.page.pieces).toHaveLength(4)
  })
})

describe('the views resource', () => {
  test('describes every view, so ChatGPT never copies one tool’s description onto the others', () => {
    const meta: Record<string, unknown> = readResource(viewsUri)?.contents[0]?.['_meta'] ?? {}
    expect(meta['openai/widgetDescription']).toBe(resources[0]?.description)
  })
})
