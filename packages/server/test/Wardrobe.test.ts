import { Unavailable } from '@styld/protocol'
import { Effect, Option } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { describe, expect, test } from 'vitest'
import type { AccountLifecycle } from '../src/AccountLifecycle.ts'
import { importImage } from '../src/links/ImageImport.ts'
import { sniffImageType } from '../src/wardrobe/Media.ts'
import { consume } from '../src/jobs/Jobs.ts'
import { pieceJobs, pieceJobQueue } from '../src/wardrobe/Queue.ts'
import { pictureView, shownImage, turnView } from '../src/wardrobe/Shown.ts'
import type { PictureRow, TurnRow } from '../src/wardrobe/Store.ts'
import { Wardrobe } from '../src/wardrobe/Wardrobe.ts'
import { serving } from './HttpFixture.ts'

const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (character) => character.charCodeAt(0),
)

describe('photo signatures', () => {
  test('name the type the bytes really are, whatever the request claimed', () => {
    expect(sniffImageType(png)).toEqual(Option.some('image/png'))
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual(Option.some('image/jpeg'))
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual(Option.none())
  })
})

/** A queue message that records how it was settled. */
const message = (body: unknown, attempts = 1) => {
  const settled: Array<'ack' | 'retry'> = []
  return {
    settled,
    message: {
      id: 'm1',
      timestamp: new Date(0),
      body,
      attempts,
      ack: () => settled.push('ack'),
      retry: () => settled.push('retry'),
    },
  }
}

const notUsed = () => Effect.die('not used by these tests')
const processingAttempts = pieceJobQueue.attempts
const base = { environment: 'local', release: 'unit', component: 'server' } as const
/** Deliver one message of the piece queue to these services. */
const settleMessage = (
  services: Parameters<typeof pieceJobs>[0],
  delivery: Parameters<ReturnType<typeof consume>>[0],
) => consume(pieceJobQueue, base, pieceJobs(services))(delivery)
const services = (
  processPiece: Effect.Effect<void, Unavailable>,
  failPiece: Effect.Effect<void, Unavailable> = Effect.void,
) => {
  const failed: Array<string> = []
  return {
    failed,
    services: {
      wardrobe: Wardrobe.of({
        listPieces: notUsed,
        searchPieces: notUsed,
        getPiece: notUsed,
        newUpload: notUsed,
        createUpload: notUsed,
        once: notUsed,
        receiveUpload: notUsed,
        receiveVideoUpload: notUsed,
        addPiece: notUsed,
        updatePiece: notUsed,
        deletePiece: notUsed,
        deletePieces: notUsed,
        setBack: notUsed,
        removeBack: notUsed,
        choosePicture: notUsed,
        processPiece: () => processPiece,
        failPiece: (pieceId) => Effect.sync(() => failed.push(pieceId)).pipe(Effect.andThen(failPiece)),
        sweepUploads: notUsed,
      }),
      lifecycle: {
        deleteAccount: notUsed,
        finishDeletion: () => Effect.void,
        sweepDeletions: notUsed,
        readAccount: notUsed,
      } satisfies AccountLifecycle['Service'],
      captures: {
        processCapture: notUsed,
        failCapture: notUsed,
        processPicture: notUsed,
        failPicture: notUsed,
        processBackPicture: notUsed,
        failBackPicture: notUsed,
        processTurn: notUsed,
        failTurn: notUsed,
        processMatch: notUsed,
        failMatch: notUsed,
      },
      photos: { findGarments: notUsed, failFinding: notUsed, refindGarments: notUsed },
    },
  }
}

describe('the processing queue', () => {
  test('settles each message once: done, retried, or failed after the last attempt', async () => {
    const done = message({ _tag: 'ProcessPiece', pieceId: 'pc_1' })
    await Effect.runPromise(settleMessage(services(Effect.void).services, done.message))
    expect(done.settled).toEqual(['ack'])

    const again = message({ _tag: 'ProcessPiece', pieceId: 'pc_1' }, 1)
    const flaky = services(Effect.fail(Unavailable.make({})))
    await Effect.runPromise(settleMessage(flaky.services, again.message))
    expect(again.settled).toEqual(['retry'])
    expect(flaky.failed).toEqual([])

    const last = message({ _tag: 'ProcessPiece', pieceId: 'pc_1' }, processingAttempts)
    await Effect.runPromise(settleMessage(flaky.services, last.message))
    expect(last.settled).toEqual(['ack'])
    expect(flaky.failed).toEqual(['pc_1'])
  })

  test('retries when the piece cannot even be marked failed, and drops what it cannot read', async () => {
    const last = message({ _tag: 'ProcessPiece', pieceId: 'pc_1' }, processingAttempts)
    await Effect.runPromise(
      settleMessage(
        services(Effect.fail(Unavailable.make({})), Effect.fail(Unavailable.make({}))).services,
        last.message,
      ),
    )
    expect(last.settled).toEqual(['retry'])
    const junk = message({ unexpected: true })
    await Effect.runPromise(settleMessage(services(Effect.void).services, junk.message))
    expect(junk.settled).toEqual(['ack'])
  })

  test('hands a clean picture to the picture job, and gives it up after the last attempt', async () => {
    const seen: Array<string> = []
    const busy = {
      ...services(Effect.void).services,
      captures: {
        processCapture: notUsed,
        failCapture: notUsed,
        processPicture: (pieceId: string) =>
          Effect.sync(() => seen.push(`draw ${pieceId}`)).pipe(Effect.andThen(Unavailable.make({}))),
        failPicture: (pieceId: string) => Effect.sync(() => seen.push(`give up ${pieceId}`)),
        processBackPicture: notUsed,
        failBackPicture: notUsed,
        processTurn: notUsed,
        failTurn: notUsed,
        processMatch: notUsed,
        failMatch: notUsed,
      },
    }
    const first = message({ _tag: 'DrawPicture', pieceId: 'pc_1' }, 1)
    await Effect.runPromise(settleMessage(busy, first.message))
    const last = message({ _tag: 'DrawPicture', pieceId: 'pc_1' }, processingAttempts)
    await Effect.runPromise(settleMessage(busy, last.message))
    expect([first.settled, last.settled]).toEqual([['retry'], ['ack']])
    expect(seen).toEqual(['draw pc_1', 'draw pc_1', 'give up pc_1'])
  })
})

const run = (address: string, routes: Record<string, () => Response>) =>
  Effect.runPromise(
    importImage(address).pipe(
      Effect.provideService(HttpClient.HttpClient, serving(routes)),
      Effect.map(({ contentType, bytes }) => ({ contentType, size: bytes.byteLength })),
      Effect.catchTag('ImportRefused', ({ reason }) => Effect.succeed(reason)),
    ),
  )

const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } })
const photo = () => new Response(png, { headers: { 'content-type': 'image/png; charset=binary' } })

describe('photos assistants point at', () => {
  test('follow up to three redirects, each checked again', async () => {
    expect(
      await run('https://a.example/1', { 'https://a.example/1': redirect('/2'), 'https://a.example/2': photo }),
    ).toEqual({
      contentType: 'image/png',
      size: png.byteLength,
    })
    expect(await run('https://a.example/1', { 'https://a.example/1': redirect('http://a.example/2') })).toBe('notHttps')
    const loop = {
      'https://a.example/1': redirect('/2'),
      'https://a.example/2': redirect('/3'),
      'https://a.example/3': redirect('/4'),
      'https://a.example/4': redirect('/5'),
    }
    expect(await run('https://a.example/1', loop)).toBe('tooManyRedirects')
  })

  test('refuse what is not an accepted image, or too large to take', async () => {
    expect(
      await run('https://a.example/p', {
        'https://a.example/p': () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
      }),
    ).toBe('notAnImage')
    expect(
      await run('https://a.example/p', {
        'https://a.example/p': () =>
          new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(16 * 1024 * 1024) } }),
      }),
    ).toBe('tooLarge')
    expect(await run('https://a.example/p', {})).toBe('notReached')
  })
})

/** A piece's clean picture row in `state`, with a drawing stored unless `cleanKey` says otherwise. */
const pictureRow = (state: PictureRow['state'], changes: Partial<PictureRow> = {}): PictureRow => ({
  pieceId: 'pc_1',
  accountId: 'ac_1',
  state,
  shown: null,
  cleanKey: 'accounts/ac_1/pieces/pc_1/clean-2.png',
  version: 2,
  drawnRotation: 0,
  keyColour: 'green',
  provider: 'meta-muse',
  face: 0.01,
  hint: null,
  redraws: 0,
  paid: false,
  claimedAt: new Date(0),
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...changes,
})
const cutout = {
  imageKey: 'accounts/ac_1/captures/cp_1/cutout.png',
  originalKey: 'photo.jpg',
  contentType: 'image/jpeg',
  rotation: 0,
} as const

describe('the picture a piece shows', () => {
  test('is its drawing, and the photo when chosen or when there is no drawing', () => {
    expect(shownImage(cutout, pictureRow('ready'))).toEqual({
      key: 'accounts/ac_1/pieces/pc_1/clean-2.png',
      contentType: 'image/png',
      rotation: 0,
    })
    expect(shownImage(cutout, pictureRow('ready', { shown: 'photo' })).key).toBe(cutout.imageKey)
    // A drawing proposed before 4 November shows unless its owner chose the photo; one dropped before then has no
    // drawing to show.
    expect(shownImage(cutout, pictureRow('proposed')).contentType).toBe('image/png')
    expect(shownImage(cutout, pictureRow('proposed', { shown: 'photo' })).key).toBe(cutout.imageKey)
    expect(shownImage(cutout, pictureRow('rejected', { cleanKey: null, shown: 'clean' })).key).toBe(cutout.imageKey)
    expect(shownImage(cutout, undefined)).toEqual({ key: cutout.imageKey, contentType: 'image/jpeg', rotation: 0 })
    expect(shownImage({ ...cutout, imageKey: null }, undefined).key).toBe('photo.jpg')
  })

  test('turns the owner’s own cut-out by their rotation, and the drawing by what it is past the one drawn at', () => {
    const turned = { ...cutout, rotation: 180 } as const
    expect(shownImage(turned, pictureRow('ready', { drawnRotation: 180 })).rotation).toBe(0)
    expect(shownImage(turned, pictureRow('ready')).rotation).toBe(180)
    expect(shownImage(turned, pictureRow('ready', { drawnRotation: 270 })).rotation).toBe(270)
    expect(shownImage(turned, pictureRow('ready', { shown: 'photo' })).rotation).toBe(180)
    expect(shownImage(turned, undefined).rotation).toBe(180)
    expect(pictureView(pictureRow('ready'), new Date(0), turned)).toMatchObject({ rotation: 180 })
    expect(pictureView(pictureRow('ready', { drawnRotation: 180 }), new Date(0), turned)).not.toHaveProperty('rotation')
  })

  test('tells its owner where the drawing stands, and shows a claim no delivery finished as failed', () => {
    const at = new Date(10 * 60 * 1000)
    expect(pictureView(pictureRow('ready'), at)).toEqual({ state: 'ready', shows: 'clean', version: 2 })
    expect(pictureView(pictureRow('proposed'), at)).toEqual({ state: 'ready', shows: 'clean', version: 2 })
    expect(pictureView(pictureRow('generating', { claimedAt: new Date(at.getTime() - 60_000) }), at).state).toBe(
      'drawing',
    )
    expect(pictureView(pictureRow('generating'), at)).toMatchObject({ state: 'failed', shows: 'photo' })
    expect(pictureView(pictureRow('kept-real', { cleanKey: null }), at)).toMatchObject({
      state: 'kept',
      shows: 'photo',
    })
    expect(pictureView(pictureRow('rejected', { cleanKey: null }), at).state).toBe('failed')
    expect(pictureView(pictureRow('retake', { cleanKey: null }), at).state).toBe('retake')
  })
})

/** A piece's turn in `state`, last moved at `updatedAt`. */
const turnRow = (state: TurnRow['state'], updatedAt: Date, changes: Partial<TurnRow> = {}): TurnRow => ({
  pieceId: 'pc_1',
  accountId: 'ac_1',
  state,
  attempt: 0,
  operation: null,
  layout: null,
  createdAt: new Date(0),
  updatedAt,
  ...changes,
})

describe("a piece's turn", () => {
  test('is being made, built in the browser, ready with its layout, or failed, and a lost one shows as failed', () => {
    const at = new Date(60 * 60 * 1000)
    const recently = new Date(at.getTime() - 60_000)
    expect(turnView(turnRow('generating', recently), at)).toEqual({ state: 'making', version: recently.getTime() })
    expect(turnView(turnRow('video-ready', recently), at).state).toBe('building')
    expect(turnView(turnRow('generating', new Date(0)), at).state).toBe('failed')
    const layout = { frames: 30, columns: 6, width: 384, height: 448, pivot: [0.5, 0.027] as const }
    expect(turnView(turnRow('ready', recently, { layout }), at)).toEqual({
      state: 'ready',
      version: recently.getTime(),
      layout,
    })
    expect(turnView(turnRow('rejected', recently), at).state).toBe('failed')
  })

  test('takes its next step from the queue, and gives up after the last attempt', async () => {
    const seen: Array<string> = []
    const working = {
      ...services(Effect.void).services,
      captures: {
        processCapture: notUsed,
        failCapture: notUsed,
        processPicture: notUsed,
        failPicture: notUsed,
        processBackPicture: notUsed,
        failBackPicture: notUsed,
        processTurn: (pieceId: string) =>
          Effect.sync(() => seen.push(`turn ${pieceId}`)).pipe(Effect.andThen(Unavailable.make({}))),
        failTurn: (pieceId: string) => Effect.sync(() => seen.push(`give up ${pieceId}`)),
        processMatch: notUsed,
        failMatch: notUsed,
      },
    }
    const last = message({ _tag: 'MakeTurn', pieceId: 'pc_1' }, processingAttempts)
    await Effect.runPromise(settleMessage(working, last.message))
    expect(last.settled).toEqual(['ack'])
    expect(seen).toEqual(['turn pc_1', 'give up pc_1'])
  })
})
