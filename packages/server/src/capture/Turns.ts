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
import { NotFound, prices, SheetRefused, type TurnLayout, TurnRefused } from '@styld/protocol'
import { Effect, Match, Option, Schema } from 'effect'
import { CurrentAccount } from '../CurrentAccount.ts'
import { turnView } from '../wardrobe/Shown.ts'
import { turnKept } from './CleanPicture.ts'
import { judgedAt } from './Garments.ts'
import { hanger } from './Hanger.ts'
import {
  enqueueTurn,
  type Parts,
  readObject,
  readPixels,
  storedAs,
  turnKey,
  unavailable,
  writeObject,
} from './Parts.ts'
import { capturePolicy } from './Policy.ts'
import {
  GarmentVision,
  ImageGenerator,
  type Picture,
  PictureWork,
  type TurnStatus,
  VideoGenerator,
} from './Providers.ts'
import type { PictureRow, TurnRow, TurnState } from './Store.ts'
import { Holds, holdId } from '../usage/Holds.ts'
import { once } from '../kernel/Receipts.ts'
import { nowDate } from '../kernel/Db.ts'

// Veo 3.1 Lite answers a 4 s turn in one to two minutes (30 October). The job asks every 15 s (`pollSeconds`)
// and gives up after 15 min; a claim older than 5 min belongs to a delivery that died, perhaps after the video model
// took the work.
const patienceMillis = 15 * 60 * 1000
const claimMillis = 5 * 60 * 1000

/** The video model's job, kept before it is polled, and when it started. */
const Started = Schema.Struct({ job: Schema.Unknown, startedAt: Schema.Number })
const startedOf = (turn: TurnRow) => Schema.decodeUnknownOption(Started)(turn.operation)

/** An opaque frame as the video model takes it: a JPEG, made by the Images binding; the PNG where the binding cannot
 * (the native stack), whose small test frames the stand-in takes. */
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
const move = (parts: Parts, pieceId: string, from: ReadonlyArray<TurnState>, changes: Partial<TurnRow>) =>
  Effect.gen(function* () {
    const moved = yield* storedAs(parts.store.moveTurn(pieceId, from, { ...changes, updatedAt: yield* nowDate }))
    if (moved && changes.state !== undefined) yield* Effect.annotateCurrentSpan('styld.turn.state', changes.state)
    return moved
  })

/** A turn that cannot finish: the piece keeps its still picture, and its credits come back (`settleTurn`). */
const end = (parts: Parts, pieceId: string, from: TurnState, errorCode: string) =>
  move(parts, pieceId, [from], { state: 'failed', errorCode })

/** The hold paying for a piece's latest turn. */
const turnHold = (turn: Pick<TurnRow, 'pieceId' | 'attempt'>) => holdId('turn', turn.pieceId, turn.attempt)

/** A turn's credits, once it ended: consumed for a turn the owner can play, refunded otherwise. The first settlement
 * stands, so settling an ended turn again is safe. */
export const settleTurn = (parts: Parts, pieceId: string) =>
  Effect.gen(function* () {
    const found = yield* storedAs(parts.store.findTurn(pieceId))
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
const sideView = (parts: Parts, turn: TurnRow, front: Rgba, key: 'green' | 'magenta') =>
  Effect.gen(function* () {
    const stored = yield* readPixels(parts, turnKey(turn.accountId, turn.pieceId, 'side.png'))
    if (Option.isSome(stored)) return stored
    const drawn = yield* (yield* ImageGenerator).profile(pngPicture(onKey(front, key)), key)
    const fitted = Option.flatMap(readPng(drawn.bytes), (side) =>
      Option.flatMap(chromaKey(shrink(side, 1280), key), (keyed) => Option.fromNullishOr(fitSide(keyed, front))),
    )
    if (Option.isSome(fitted))
      yield* writeObject(parts, turnKey(turn.accountId, turn.pieceId, 'side.png'), encodePng(fitted.value), 'image/png')
    return fitted
  })

/** What a refused or lost provider call means for a claimed turn: busy hands it back to the queue, anything else ends
 * it (an answer lost after the provider took the work is never sent again). */
const providerEnded = (parts: Parts, pieceId: string) => (error: ProviderError) =>
  isBusy(error)
    ? Effect.andThen(move(parts, pieceId, ['anchoring'], { state: 'requested' }), Effect.fail(error))
    : Effect.as(end(parts, pieceId, 'anchoring', isOutcomeUnknown(error) ? 'unknown' : 'refused'), 'ended' as const)

/** A requested turn: claim it, lay its two frames on the key, and start the video model on them. The frames are kept,
 * so the browser can end the turn on the front and a retry never draws the side view again. */
const start = (parts: Parts, turn: TurnRow) =>
  Effect.gen(function* () {
    const { pieceId, accountId } = turn
    const picture = cleanPicture(yield* storedAs(parts.store.findPicture(pieceId)))
    if (Option.isNone(picture)) return yield* end(parts, pieceId, 'requested', 'picture')
    const clean = yield* readPixels(parts, picture.value.cleanKey)
    if (Option.isNone(clean)) return yield* end(parts, pieceId, 'requested', 'picture')
    if (!(yield* move(parts, pieceId, ['requested'], { state: 'anchoring', errorCode: null }))) return false
    const key = picture.value.keyColour ?? keyColourFor(clean.value)
    const front = frontAnchor(clean.value, hanger())
    yield* writeObject(parts, turnKey(accountId, pieceId, 'front.png'), encodePng(front), 'image/png')
    const side = yield* sideView(parts, turn, front, key).pipe(
      Effect.catchTag('ProviderError', providerEnded(parts, pieceId)),
    )
    if (side === 'ended') return false
    if (Option.isNone(side)) return yield* end(parts, pieceId, 'anchoring', 'side')
    // The gateway refuses large requests (413 on two 720 by 1280 PNGs, 30 October): the frames go as JPEG, as the spike
    // sent them.
    const [first, last] = yield* Effect.all([jpegOf(onKey(side.value, key)), jpegOf(onKey(front, key))])
    const video = yield* VideoGenerator
    const job = yield* video.start({ side: first, front: last, key }).pipe(
      Effect.map(Option.some),
      Effect.catchTag('ProviderError', (error) => Effect.as(providerEnded(parts, pieceId)(error), Option.none())),
    )
    if (Option.isNone(job)) return false
    const operation = { job: job.value, startedAt: (yield* nowDate).getTime() }
    if (
      !(yield* move(parts, pieceId, ['anchoring'], {
        state: 'generating',
        provider: video.provider,
        model: video.model,
        operation,
      }))
    )
      return false
    yield* enqueueTurn(parts, pieceId, (yield* VideoGenerator).pollSeconds)
    return true
  })

/** A turn the video model is making: ask where it stands, store the video once it is done, and ask again later
 * while it is not. A status the gateway cannot give nowDate is asked again; the job itself is never restarted. */
const poll = (parts: Parts, turn: TurnRow) =>
  Effect.gen(function* () {
    const { pieceId, accountId } = turn
    const { pollSeconds } = yield* VideoGenerator
    const started = startedOf(turn)
    if (Option.isNone(started)) return yield* end(parts, pieceId, 'generating', 'unknown')
    if ((yield* nowDate).getTime() - started.value.startedAt > patienceMillis)
      return yield* end(parts, pieceId, 'generating', 'timeout')
    const status = yield* (yield* VideoGenerator)
      .status(started.value.job)
      .pipe(
        Effect.catchTag('ProviderError', (error) =>
          Effect.succeed<TurnStatus>(isBusy(error) ? { _tag: 'Pending' } : { _tag: 'Failed' }),
        ),
      )
    return yield* Match.valueTags(status, {
      Pending: () => Effect.as(enqueueTurn(parts, pieceId, pollSeconds), false),
      Failed: () => end(parts, pieceId, 'generating', 'video'),
      Done: ({ video }) =>
        Effect.gen(function* () {
          const videoKey = turnKey(accountId, pieceId, 'turn.mp4')
          yield* writeObject(parts, videoKey, video.bytes, video.contentType)
          return yield* move(parts, pieceId, ['generating'], { state: 'video-ready', videoKey })
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
export const turning = (parts: Parts) => ({
  /** Carry a piece's turn a step further: start it, poll it, or settle its credits once it ended. A turn waiting for
   * the owner's browser to build its frames is left as it is. */
  processTurn: Effect.fn('Styld.Turn.process')(function* (pieceId: string) {
    const found = yield* storedAs(parts.store.findTurn(pieceId))
    if (Option.isNone(found)) return
    const turn = found.value
    if (!(yield* storedAs(parts.wardrobeStore.accountEnabled(turn.accountId)))) return
    if (turn.state === 'requested') yield* start(parts, turn)
    else if (turn.state === 'generating') yield* poll(parts, turn)
    else if (turn.state === 'anchoring' && (yield* nowDate).getTime() - turn.updatedAt.getTime() > claimMillis)
      yield* end(parts, pieceId, 'anchoring', 'unknown')
    yield* settleTurn(parts, pieceId)
  }),
  /** The last attempt failed, or the sweep found the turn stuck (a video no browser cut into frames too): the turn
   * ends and its credits come back. */
  failTurn: Effect.fn('Styld.Turn.fail')(function* (pieceId: string) {
    const found = yield* storedAs(parts.store.findTurn(pieceId))
    if (Option.isNone(found)) return
    const { state } = found.value
    if (!hasEnded(state)) yield* end(parts, pieceId, state, 'gave-up')
    yield* settleTurn(parts, pieceId)
  }),
})

/** A sheet laid out as it says, and the clean picture to check it against; refused without either. */
const sheetAndFront = (parts: Parts, pieceId: string, layout: TurnLayout, bytes: Uint8Array) =>
  Effect.gen(function* () {
    const sheet = Option.filter(readPng(bytes), (pixels) => laidOut(pixels, layout))
    const picture = cleanPicture(yield* storedAs(parts.store.findPicture(pieceId)))
    const clean = Option.isNone(picture) ? Option.none<Rgba>() : yield* readPixels(parts, picture.value.cleanKey)
    if (Option.isNone(sheet) || Option.isNone(clean)) return yield* SheetRefused.make({})
    return { sheet: sheet.value, clean: clean.value }
  })

/** The frame sheet the owner's browser cut from a turn's video: kept when every checked frame keeps the clean
 * picture's colour and print, with the turn's credits consumed; dropped otherwise, with them refunded. */
const acceptSheet = (parts: Parts, pieceId: string, layout: TurnLayout, bytes: Uint8Array) =>
  Effect.gen(function* () {
    const { accountId } = yield* CurrentAccount
    const turn = yield* storedAs(parts.wardrobeStore.turnOf(accountId, pieceId))
    if (Option.isNone(turn)) return yield* NotFound.make({})
    if (turn.value.state !== 'video-ready') return turnView(turn.value, yield* nowDate)
    const { sheet, clean } = yield* sheetAndFront(parts, pieceId, layout, bytes)
    // A check the decision model cannot answer nowDate leaves the turn waiting for the same sheet again.
    const { kept, scores } = yield* checked(sheet, layout, clean).pipe(Effect.mapError(unavailable))
    const sheetKey = turnKey(accountId, pieceId, 'sheet.png')
    if (kept) yield* writeObject(parts, sheetKey, bytes, 'image/png')
    yield* move(parts, pieceId, ['video-ready'], {
      ...scores,
      state: kept ? 'ready' : 'rejected',
      ...(kept ? { sheetKey, layout } : {}),
    })
    yield* settleTurn(parts, pieceId)
    const settled = yield* storedAs(parts.store.findTurn(pieceId))
    return turnView(
      Option.getOrElse(settled, () => turn.value),
      yield* nowDate,
    )
  })

/** The owner's piece, if it can turn: turns are on and it has a clean picture shown or offered. */
const turnablePiece = (parts: Parts, accountId: string, pieceId: string) =>
  Effect.gen(function* () {
    if (Option.isNone(yield* storedAs(parts.wardrobeStore.findPiece(accountId, pieceId))))
      return yield* NotFound.make({})
    if (Option.isNone(cleanPicture(yield* storedAs(parts.store.findPicture(pieceId)))))
      return yield* TurnRefused.make({ reason: 'picture' })
  })

/** Hold the turn's credits and queue it as the piece's next turn, moving it on from the state it was read in; the turn
 * as queued. A request that lost the race, or could not be stored, gets its credits back. */
const queueTurn = (
  parts: Parts,
  ids: { readonly accountId: string; readonly pieceId: string },
  current: Option.Option<TurnRow>,
  at: Date,
) =>
  Effect.gen(function* () {
    const { accountId, pieceId } = ids
    const attempt = Option.match(current, { onNone: () => 0, onSome: (turn) => turn.attempt + 1 })
    const hold = turnHold({ pieceId, attempt })
    const holds = yield* Holds
    yield* holds.reserve({ accountId, hold, credits: prices.turn })
    const requested = {
      state: 'requested' as const,
      attempt,
      provider: null,
      model: null,
      operation: null,
      videoKey: null,
      sheetKey: null,
      layout: null,
      colour: null,
      print: null,
      same: null,
      errorCode: null,
      updatedAt: at,
    }
    const moved = yield* storedAs(
      Option.isSome(current)
        ? parts.store.moveTurn(pieceId, [current.value.state], requested)
        : parts.store.addTurn({ ...requested, pieceId, accountId, createdAt: at }),
    ).pipe(Effect.tapError(() => holds.settle(accountId, hold, 'failed').pipe(Effect.ignore)))
    if (!moved) {
      yield* holds.settle(accountId, hold, 'failed')
      return yield* TurnRefused.make({ reason: 'busy' })
    }
    yield* enqueueTurn(parts, pieceId)
    return { ...requested, hold: null, pieceId, accountId, createdAt: at }
  })

/** The turn a repeated request asked for, as it stands now; one still requested goes to the queue again. */
const replayedTurn = (parts: Parts, accountId: string, pieceId: string) =>
  Effect.gen(function* () {
    const turn = yield* storedAs(parts.wardrobeStore.turnOf(accountId, pieceId))
    if (Option.isNone(turn)) return yield* NotFound.make({})
    if (turn.value.state === 'requested') yield* enqueueTurn(parts, pieceId)
    return turnView(turn.value, yield* nowDate)
  })

const files = {
  video: { name: 'turn.mp4', contentType: 'video/mp4' },
  front: { name: 'front.png', contentType: 'image/png' },
  sheet: { name: 'sheet.png', contentType: 'image/png' },
} as const

/** The owner's request for a turn, and the files it makes. */
export const askingTurns = (parts: Parts) => ({
  /** Take the frame sheet the owner's browser built from the turn's video. */
  acceptSheet: Effect.fn('Styld.Turn.sheet')(function* (pieceId: string, layout: TurnLayout, sheet: Uint8Array) {
    return yield* acceptSheet(parts, pieceId, layout, sheet)
  }),
  /** One of a turn's files for its owner: the video the browser cuts into frames, the front frame the turn ends on,
   * or the frame sheet the piece page plays. */
  turnFile: Effect.fn('Styld.Turn.file')(function* (pieceId: string, which: keyof typeof files) {
    const { accountId } = yield* CurrentAccount
    const turn = yield* storedAs(parts.wardrobeStore.turnOf(accountId, pieceId))
    if (Option.isNone(turn) || turn.value.state === 'requested') return Option.none<Picture | TurnVideo>()
    const file = files[which]
    const bytes = yield* readObject(parts, turnKey(accountId, pieceId, file.name))
    return Option.map(bytes, (stored) => ({ bytes: stored, contentType: file.contentType }))
  }),
  /** Turn a piece's clean picture on its hanger, for credits held until the turn ends: consumed for one the owner can
   * play, refunded otherwise. A new turn replaces the last; repeating an operation id answers the first request. */
  makeTurn: Effect.fn('Styld.Turn.ask')(function* (pieceId: string, operationId: string) {
    const { accountId } = yield* CurrentAccount
    const ask = Effect.gen(function* () {
      yield* turnablePiece(parts, accountId, pieceId)
      yield* settleTurn(parts, pieceId)
      const current = yield* storedAs(parts.store.findTurn(pieceId))
      if (Option.isSome(current) && !hasEnded(current.value.state)) return yield* TurnRefused.make({ reason: 'busy' })
      const at = yield* nowDate
      return [turnView(yield* queueTurn(parts, { accountId, pieceId }, current, at), at), pieceId] as const
    })
    return yield* once(
      parts.wardrobeStore,
      { accountId, operationId, command: 'makeTurn', input: pieceId },
      // The same request again: its message may have been lost; the job starts a turn once however often it is sent.
      { replay: () => replayedTurn(parts, accountId, pieceId), run: ask },
    )
  }),
})
