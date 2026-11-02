import { type ProviderError, isBusy, isOutcomeUnknown } from '../providers/Errors.ts'
import {
  chromaKey,
  crop,
  encodePng,
  fitSide,
  frontAnchor,
  keyColourFor,
  modelPicture,
  onKey,
  pngPicture,
  type Rgba,
  readPng,
  shrink,
} from '@styld/imaging'
import { CurrentAccount, NotFound, prices, SheetRefused, type TurnLayout, TurnRefused } from '@styld/protocol'
import { Effect, Match, Option, Schema } from 'effect'
import { turnView } from '../wardrobe/Shown.ts'
import { turnKept } from './CleanPicture.ts'
import { judgedAt } from './Garments.ts'
import { hanger } from './Hanger.ts'
import { enqueueTurn, readObject, readPixels, storedAs, turnKey, unavailable, writeObject } from './Shared.ts'
import { capturePolicy } from './Policy.ts'
import { type Picture, type TurnStatus } from './Providers.ts'
import type { PictureRow, TurnRow, TurnState } from './Store.ts'
import { holdId } from '../usage/Holds.ts'
import { once } from '../kernel/Receipts.ts'
import { nowDate } from '../kernel/Db.ts'
import { CaptureStore } from './Store.ts'
import { WardrobeStore } from '../wardrobe/Store.ts'
import { GarmentVision, ImageGenerator, PictureWork, VideoGenerator } from './Providers.ts'
import { Holds } from '../usage/Holds.ts'
import type { CaptureServices } from './Shared.ts'

// Veo 3.1 Lite answers a 4 s turn in one to two minutes (30 October). The job asks every 15 s (`pollSeconds`)
// and gives up after 15 min; a claim older than 5 min belongs to a delivery that died, perhaps after the video model
// took the work.
const patienceMillis = 15 * 60 * 1000
const claimMillis = 5 * 60 * 1000

/** The video model's job, kept before it is polled, and when it started. */
const Started = Schema.Struct({ job: Schema.Unknown, startedAt: Schema.Number })
const startedOf = (turn: TurnRow) => Schema.decodeUnknownOption(Started)(turn.operation)

/** An opaque frame as the video model takes it: a JPEG, made by the Images binding; the PNG where the binding cannot
 * (the native stack), whose small test frames the native fake takes. */
const jpegOf = (picture: Rgba) =>
  Effect.gen(function* () {
    const bytes = yield* (yield* PictureWork).jpeg(encodePng(picture))
    return { bytes, contentType: 'image/jpeg' } satisfies Picture
  }).pipe(Effect.orElseSucceed(() => pngPicture(picture)))

interface TurnVideo {
  readonly bytes: Uint8Array
  readonly contentType: 'video/mp4'
}

const ends = ['ready', 'rejected', 'failed'] as const
const hasEnded = (state: TurnState): state is (typeof ends)[number] => ends.some((end) => end === state)

/** Move a turn on from one of `from`; whether it moved. */
const move = (pieceId: string, from: ReadonlyArray<TurnState>, changes: Partial<TurnRow>) =>
  Effect.gen(function* () {
    const moved = yield* storedAs(
      (yield* CaptureStore).moveTurn(pieceId, from, { ...changes, updatedAt: yield* nowDate }),
    )
    if (moved && changes.state !== undefined) yield* Effect.annotateCurrentSpan('styld.turn.state', changes.state)
    return moved
  })

/** A turn that cannot finish: the piece keeps its still picture, and its credits come back (`settleTurn`). Why is on
 * the span, not in the row. */
const end = (pieceId: string, from: TurnState, why: string) =>
  Effect.andThen(Effect.annotateCurrentSpan('styld.turn.failed', why), move(pieceId, [from], { state: 'failed' }))

/** The hold paying for a piece's latest turn. */
const turnHold = (turn: Pick<TurnRow, 'pieceId' | 'attempt'>) => holdId('turn', turn.pieceId, turn.attempt)

/** A turn's credits, once it ended: consumed for a turn the owner can play, refunded otherwise. The first settlement
 * stands, so settling an ended turn again is safe. */
const settleTurn = (pieceId: string) =>
  Effect.gen(function* () {
    const found = yield* storedAs((yield* CaptureStore).findTurn(pieceId))
    if (Option.isNone(found) || !hasEnded(found.value.state)) return
    yield* (yield* Holds).settle(
      found.value.accountId,
      turnHold(found.value),
      found.value.state === 'ready' ? 'succeeded' : 'failed',
    )
  })

/** The clean picture a turn starts from: a drawing that is shown or offered. */
const cleanPicture = (picture: Option.Option<PictureRow>) =>
  Option.filter(
    picture,
    (row): row is PictureRow & { readonly cleanKey: string } =>
      row.cleanKey !== null && (row.state === 'ready' || row.state === 'proposed'),
  )

/** A turn's side view, drawn once: Muse turns the front anchor to a strict profile, keyed and fitted to the front. */
const sideView = (turn: TurnRow, front: Rgba, key: 'green' | 'magenta') =>
  Effect.gen(function* () {
    const stored = yield* readPixels(turnKey(turn.accountId, turn.pieceId, 'side.png'))
    if (Option.isSome(stored)) return stored
    const drawn = yield* (yield* ImageGenerator).profile(pngPicture(onKey(front, key)), key)
    const fitted = Option.flatMap(readPng(drawn.bytes), (side) =>
      Option.flatMap(chromaKey(shrink(side, 1280), key), (keyed) => Option.fromNullishOr(fitSide(keyed, front))),
    )
    if (Option.isSome(fitted))
      yield* writeObject(turnKey(turn.accountId, turn.pieceId, 'side.png'), encodePng(fitted.value), 'image/png')
    return fitted
  })

/** What a refused or lost provider call means for a claimed turn: busy hands it back to the queue, anything else ends
 * it (an answer lost after the provider took the work is never sent again). */
const providerEnded = (pieceId: string) => (error: ProviderError) =>
  isBusy(error)
    ? Effect.andThen(move(pieceId, ['anchoring'], { state: 'requested' }), Effect.fail(error))
    : Effect.as(end(pieceId, 'anchoring', isOutcomeUnknown(error) ? 'unknown' : 'refused'), 'ended' as const)

/** A requested turn: claim it, lay its two frames on the key, and start the video model on them. The frames are kept,
 * so the browser can end the turn on the front and a retry never draws the side view again. */
const start = (turn: TurnRow) =>
  Effect.gen(function* () {
    const { pieceId, accountId } = turn
    const picture = cleanPicture(yield* storedAs((yield* CaptureStore).findPicture(pieceId)))
    if (Option.isNone(picture)) return yield* end(pieceId, 'requested', 'picture')
    const clean = yield* readPixels(picture.value.cleanKey)
    if (Option.isNone(clean)) return yield* end(pieceId, 'requested', 'picture')
    if (!(yield* move(pieceId, ['requested'], { state: 'anchoring' }))) return false
    const key = picture.value.keyColour ?? keyColourFor(clean.value)
    const front = frontAnchor(clean.value, hanger())
    yield* writeObject(turnKey(accountId, pieceId, 'front.png'), encodePng(front), 'image/png')
    const side = yield* sideView(turn, front, key).pipe(Effect.catchTag('ProviderError', providerEnded(pieceId)))
    if (side === 'ended') return false
    if (Option.isNone(side)) return yield* end(pieceId, 'anchoring', 'side')
    // The gateway refuses large requests (413 on two 720 by 1280 PNGs, 30 October): the frames go as JPEG, as the spike
    // sent them.
    const [first, last] = yield* Effect.all([jpegOf(onKey(side.value, key)), jpegOf(onKey(front, key))])
    const video = yield* VideoGenerator
    const job = yield* video.start({ side: first, front: last, key }).pipe(
      Effect.map(Option.some),
      Effect.catchTag('ProviderError', (error) => Effect.as(providerEnded(pieceId)(error), Option.none())),
    )
    if (Option.isNone(job)) return false
    const operation = { job: job.value, startedAt: (yield* nowDate).getTime() }
    if (
      !(yield* move(pieceId, ['anchoring'], {
        state: 'generating',
        operation,
      }))
    )
      return false
    yield* enqueueTurn(pieceId, (yield* VideoGenerator).pollSeconds)
    return true
  })

/** A turn the video model is making: ask where it stands, store the video once it is done, and ask again later
 * while it is not. A status the gateway cannot give nowDate is asked again; the job itself is never restarted. */
const poll = (turn: TurnRow) =>
  Effect.gen(function* () {
    const { pieceId, accountId } = turn
    const { pollSeconds } = yield* VideoGenerator
    const started = startedOf(turn)
    if (Option.isNone(started)) return yield* end(pieceId, 'generating', 'unknown')
    if ((yield* nowDate).getTime() - started.value.startedAt > patienceMillis)
      return yield* end(pieceId, 'generating', 'timeout')
    const status = yield* (yield* VideoGenerator)
      .status(started.value.job)
      .pipe(
        Effect.catchTag('ProviderError', (error) =>
          Effect.succeed<TurnStatus>(isBusy(error) ? { _tag: 'Pending' } : { _tag: 'Failed' }),
        ),
      )
    return yield* Match.valueTags(status, {
      Pending: () => Effect.as(enqueueTurn(pieceId, pollSeconds), false),
      Failed: () => end(pieceId, 'generating', 'video'),
      Done: ({ video }) =>
        Effect.gen(function* () {
          yield* writeObject(turnKey(accountId, pieceId, 'turn.mp4'), video.bytes, video.contentType)
          return yield* move(pieceId, ['generating'], { state: 'video-ready' })
        }),
    })
  })

/** The frames of a sheet the decision model checks: five spread over the turn, as in the 30 October gate. */
const checkedFrames = (frames: number) => [0.27, 0.4, 0.5, 0.67, 0.87].map((share) => Math.round(share * (frames - 1)))

/** Cell `index` of a frame sheet. */
const cellOf = (sheet: Rgba, layout: TurnLayout, index: number) =>
  crop(sheet, {
    left: (index % layout.columns) * layout.width,
    top: Math.floor(index / layout.columns) * layout.height,
    right: ((index % layout.columns) + 1) * layout.width,
    bottom: (Math.floor(index / layout.columns) + 1) * layout.height,
  })

/** Whether a sheet is laid out as it says: whole cells, as many as its frames, in its columns. */
const laidOut = (sheet: Rgba, layout: TurnLayout) =>
  sheet.width === layout.columns * layout.width &&
  sheet.height === Math.ceil(layout.frames / layout.columns) * layout.height

/** How the turn's checked frames compare with the clean picture: whether it is kept (`turnKept`), and the weakest
 * colour and print and the average sameness, as the turn records them. */
const checked = (sheet: Rgba, layout: TurnLayout, clean: Rgba) =>
  Effect.gen(function* () {
    const vision = yield* GarmentVision
    const policy = capturePolicy.turns
    const front = modelPicture(clean, judgedAt)
    const answers = yield* Effect.forEach(checkedFrames(layout.frames), (index) =>
      vision.compareTurn(modelPicture(cellOf(sheet, layout, index), judgedAt), front),
    )
    return {
      kept: turnKept(answers, policy),
      scores: {
        colour: Math.min(...answers.map(({ colour }) => colour)),
        print: Math.min(...answers.map(({ print }) => print)),
        same: answers.reduce((sum, { same }) => sum + same, 0) / answers.length,
      },
    }
  })

/** The queue side of turns. */
export const turning = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  /** Carry a piece's turn a step further: start it, poll it, or settle its credits once it ended. A turn waiting for
   * the owner's browser to build its frames is left as it is. */
  processTurn: Effect.fn('Styld.Turn.process')(function* (pieceId: string) {
    const found = yield* storedAs((yield* CaptureStore).findTurn(pieceId))
    if (Option.isNone(found)) return
    const turn = found.value
    if (!(yield* storedAs((yield* WardrobeStore).accountEnabled(turn.accountId)))) return
    if (turn.state === 'requested') yield* start(turn)
    else if (turn.state === 'generating') yield* poll(turn)
    else if (turn.state === 'anchoring' && (yield* nowDate).getTime() - turn.updatedAt.getTime() > claimMillis)
      yield* end(pieceId, 'anchoring', 'unknown')
    yield* settleTurn(pieceId)
  }, Effect.provide(context)),
  /** The last attempt failed, or the sweep found the turn stuck (a video no browser cut into frames too): the turn
   * ends and its credits come back. */
  failTurn: Effect.fn('Styld.Turn.fail')(function* (pieceId: string) {
    const found = yield* storedAs((yield* CaptureStore).findTurn(pieceId))
    if (Option.isNone(found)) return
    const { state } = found.value
    if (!hasEnded(state)) yield* end(pieceId, state, 'gave-up')
    yield* settleTurn(pieceId)
  }, Effect.provide(context)),
}))

/** A sheet laid out as it says, and the clean picture to check it against; refused without either. */
const sheetAndFront = (pieceId: string, layout: TurnLayout, bytes: Uint8Array) =>
  Effect.gen(function* () {
    const sheet = Option.filter(readPng(bytes), (pixels) => laidOut(pixels, layout))
    const picture = cleanPicture(yield* storedAs((yield* CaptureStore).findPicture(pieceId)))
    const clean = Option.isNone(picture) ? Option.none<Rgba>() : yield* readPixels(picture.value.cleanKey)
    if (Option.isNone(sheet) || Option.isNone(clean)) return yield* SheetRefused.make({})
    return { sheet: sheet.value, clean: clean.value }
  })

/** The frame sheet the owner's browser cut from a turn's video: kept when every checked frame keeps the clean
 * picture's colour and print, with the turn's credits consumed; dropped otherwise, with them refunded. */
const acceptSheet = (pieceId: string, layout: TurnLayout, bytes: Uint8Array) =>
  Effect.gen(function* () {
    const { accountId } = yield* CurrentAccount
    const turn = yield* storedAs((yield* WardrobeStore).turnOf(accountId, pieceId))
    if (Option.isNone(turn)) return yield* NotFound.make({})
    if (turn.value.state !== 'video-ready') return turnView(turn.value, yield* nowDate)
    const { sheet, clean } = yield* sheetAndFront(pieceId, layout, bytes)
    // A check the decision model cannot answer nowDate leaves the turn waiting for the same sheet again.
    const { kept, scores } = yield* checked(sheet, layout, clean).pipe(Effect.mapError(unavailable))
    yield* Effect.annotateCurrentSpan({
      'styld.turn.colour': scores.colour,
      'styld.turn.print': scores.print,
      'styld.turn.same': scores.same,
    })
    if (kept) yield* writeObject(turnKey(accountId, pieceId, 'sheet.png'), bytes, 'image/png')
    yield* move(pieceId, ['video-ready'], { state: kept ? 'ready' : 'rejected', ...(kept ? { layout } : {}) })
    yield* settleTurn(pieceId)
    const settled = yield* storedAs((yield* CaptureStore).findTurn(pieceId))
    return turnView(
      Option.getOrElse(settled, () => turn.value),
      yield* nowDate,
    )
  })

/** The owner's piece, if it can turn: turns are on and it has a clean picture shown or offered. */
const turnablePiece = (accountId: string, pieceId: string) =>
  Effect.gen(function* () {
    if (Option.isNone(yield* storedAs((yield* WardrobeStore).findPiece(accountId, pieceId))))
      return yield* NotFound.make({})
    if (Option.isNone(cleanPicture(yield* storedAs((yield* CaptureStore).findPicture(pieceId)))))
      return yield* TurnRefused.make({ reason: 'picture' })
  })

/** The attempt a piece's next turn is. */
const nextAttempt = (current: Option.Option<TurnRow>) =>
  Option.match(current, { onNone: () => 0, onSome: (turn) => turn.attempt + 1 })

/** A claimed turn whose credits could not be held: its hold refunded (whatever the Wallet did, it paid for nothing),
 * then the turn as it was, keeping the attempt's number so its hold is never named again. */
const unclaimed = (ids: { readonly accountId: string; readonly pieceId: string }, current: Option.Option<TurnRow>) =>
  Effect.gen(function* () {
    const { accountId, pieceId } = ids
    const attempt = nextAttempt(current)
    yield* (yield* Holds).settle(accountId, turnHold({ pieceId, attempt }), 'failed')
    const store = yield* CaptureStore
    yield* Option.match(current, {
      onNone: () => store.dropTurn(pieceId, attempt),
      onSome: ({ state, operation, layout, updatedAt }) =>
        store.claimTurn(pieceId, { state: 'requested', attempt }, { state, operation, layout, updatedAt }),
    })
  }).pipe(Effect.ignore({ log: true, message: 'Styld.Turn.ask could not take back a claim' }))

/** Claim the piece's next turn, moving it on from the state and attempt it was read in, then hold its credits and
 * queue it; the turn as queued. Only the request that claimed the attempt holds and settles its credits: one that lost
 * the race holds nothing and is told the turn is busy. */
const queueTurn = (
  ids: { readonly accountId: string; readonly pieceId: string },
  current: Option.Option<TurnRow>,
  at: Date,
) =>
  Effect.gen(function* () {
    const { accountId, pieceId } = ids
    const attempt = nextAttempt(current)
    const requested = {
      state: 'requested' as const,
      attempt,
      operation: null,
      layout: null,
      updatedAt: at,
    }
    const store = yield* CaptureStore
    const claimed = yield* storedAs(
      Option.isSome(current)
        ? store.claimTurn(pieceId, current.value, requested)
        : store.addTurn({ ...requested, pieceId, accountId, createdAt: at }),
    )
    if (!claimed) return yield* TurnRefused.make({ reason: 'busy' })
    yield* (yield* Holds)
      .reserve({ accountId, hold: turnHold({ pieceId, attempt }), credits: prices.turn })
      .pipe(Effect.tapError(() => unclaimed(ids, current)))
    yield* enqueueTurn(pieceId)
    return { ...requested, pieceId, accountId, createdAt: at }
  })

/** The turn a repeated request asked for, as it stands now; one still requested goes to the queue again. */
const replayedTurn = (accountId: string, pieceId: string) =>
  Effect.gen(function* () {
    const turn = yield* storedAs((yield* WardrobeStore).turnOf(accountId, pieceId))
    if (Option.isNone(turn)) return yield* NotFound.make({})
    if (turn.value.state === 'requested') yield* enqueueTurn(pieceId)
    return turnView(turn.value, yield* nowDate)
  })

const files = {
  video: { name: 'turn.mp4', contentType: 'video/mp4' },
  front: { name: 'front.png', contentType: 'image/png' },
  sheet: { name: 'sheet.png', contentType: 'image/png' },
} as const

/** The owner's request for a turn, and the files it makes. */
export const askingTurns = Effect.map(Effect.context<CaptureServices>(), (context) => ({
  /** Take the frame sheet the owner's browser built from the turn's video. */
  acceptSheet: Effect.fn('Styld.Turn.sheet')(function* (pieceId: string, layout: TurnLayout, sheet: Uint8Array) {
    return yield* acceptSheet(pieceId, layout, sheet)
  }, Effect.provide(context)),
  /** One of a turn's files for its owner: the video the browser cuts into frames, the front frame the turn ends on,
   * or the frame sheet the piece page plays. */
  turnFile: Effect.fn('Styld.Turn.file')(function* (pieceId: string, which: keyof typeof files) {
    const { accountId } = yield* CurrentAccount
    const turn = yield* storedAs((yield* WardrobeStore).turnOf(accountId, pieceId))
    if (Option.isNone(turn) || turn.value.state === 'requested') return Option.none<Picture | TurnVideo>()
    const file = files[which]
    const bytes = yield* readObject(turnKey(accountId, pieceId, file.name))
    return Option.map(bytes, (stored) => ({ bytes: stored, contentType: file.contentType }))
  }, Effect.provide(context)),
  /** Turn a piece's clean picture on its hanger, for credits held until the turn ends: consumed for one the owner can
   * play, refunded otherwise. A new turn replaces the last; repeating an operation id answers the first request. */
  makeTurn: Effect.fn('Styld.Turn.ask')(function* (pieceId: string, operationId: string) {
    const { accountId } = yield* CurrentAccount
    const ask = Effect.gen(function* () {
      yield* turnablePiece(accountId, pieceId)
      yield* settleTurn(pieceId)
      const current = yield* storedAs((yield* CaptureStore).findTurn(pieceId))
      if (Option.isSome(current) && !hasEnded(current.value.state)) return yield* TurnRefused.make({ reason: 'busy' })
      const at = yield* nowDate
      return [turnView(yield* queueTurn({ accountId, pieceId }, current, at), at), pieceId] as const
    })
    return yield* once(
      yield* WardrobeStore,
      { accountId, operationId, command: 'makeTurn', input: pieceId },
      // The same request again: its message may have been lost; the job starts a turn once however often it is sent.
      { replay: () => replayedTurn(accountId, pieceId), run: ask, resume: replayedTurn(accountId, pieceId) },
    )
  }, Effect.provide(context)),
}))
