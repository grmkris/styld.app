import { cdn } from '../Cdn.ts'
import { Photo, Tray as CaptureTray } from '@styld/protocol'
import { Array, Effect, Option, Result, Schema } from 'effect'
import { AsyncData, Command, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// Home's "Pick up where you left off": a favourite outfit photo to wear again and the found pieces waiting in the
// review tray. The last board with something on it comes from the app's boards, which Home passes to the view.

// MODEL

/** The newest favourite photo of My Gallery, for "Wear it again". */
export const FavouriteData = AsyncData.Schema(Schema.Option(Photo), Schema.Literal('Unavailable'))
export type FavouriteData = typeof FavouriteData.schema.Type
/** The review tray as Home shows it: how many found pieces wait, the first three's pictures, and today's free
 * credits, which the first piece's invitation quotes. */
export const Tray = Schema.Struct({
  waiting: Schema.Int,
  pictures: Schema.Array(Schema.String),
  allowance: CaptureTray.fields.allowance,
})
export type Tray = typeof Tray.Type
export const TrayData = AsyncData.Schema(Tray, Schema.Literal('Unavailable'))
export type TrayData = typeof TrayData.schema.Type

export const Model = Schema.Struct({ favourite: FavouriteData.schema, tray: TrayData.schema })
export type Model = typeof Model.Type

export const init = (): Model => ({ favourite: AsyncData.Idle(), tray: AsyncData.Idle() })

// MESSAGE

export const Message = defineMessageUnion({
  SucceededReadFavourite: { maybePhoto: Schema.Option(Photo) },
  FailedReadFavourite: {},
  SucceededReadTray: { tray: Tray },
  FailedReadTray: {},
})
export type Message = typeof Message.Type

// COMMAND

export const ReadFavourite = Command.define('ReadFavourite', {
  messages: [Message.SucceededReadFavourite, Message.FailedReadFavourite],
  execute: Effect.gen(function* () {
    const { photos } = yield* (yield* (yield* StyldClient).api).photo.listPhotos()
    const maybePhoto = Array.findFirst(photos, (photo) => photo.favourite && photo.status === 'ready')
    return Message.SucceededReadFavourite({ maybePhoto })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadFavourite())),
})

export const ReadTray = Command.define('ReadTray', {
  messages: [Message.SucceededReadTray, Message.FailedReadTray],
  execute: Effect.gen(function* () {
    const { captures, allowance } = yield* (yield* (yield* StyldClient).api).capture.tray()
    const detections = captures.flatMap((capture) => capture.detections)
    // A found piece's cut-out when it has one, else its photo, as the tray first shows it.
    const pictures = detections.slice(0, 3).map((detection) => cdn.detection(detection, detection.hasCutout))
    return Message.SucceededReadTray({ tray: { waiting: detections.length, pictures, allowance } })
  }).pipe(Effect.orElseSucceed(() => Message.FailedReadTray())),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

const unavailable = Result.fail('Unavailable' as const)

/** Opening Home: what was shown stays on screen while it is asked for again. */
export const enter = (model: Model): UpdateReturn =>
  Update.combine<Model, Message, StyldClient>(model, [
    Update.refresh<Model, Message, Option.Option<Photo>, 'Unavailable', StyldClient>({
      read: (current: Model) => Option.some(current.favourite),
      revalidate: AsyncData.revalidateOrLoad,
      write: (current: Model, favourite: FavouriteData) => modifyFields(current, { favourite: () => favourite }),
      load: ReadFavourite(),
    }),
    Update.refresh<Model, Message, Tray, 'Unavailable', StyldClient>({
      read: (current: Model) => Option.some(current.tray),
      revalidate: AsyncData.revalidateOrLoad,
      write: (current: Model, tray: TrayData) => modifyFields(current, { tray: () => tray }),
      load: ReadTray(),
    }),
  ])

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededReadFavourite: ({ maybePhoto }) => ({
      model: modifyFields(model, { favourite: () => FavouriteData.Success({ data: maybePhoto }) }),
    }),
    FailedReadFavourite: () => ({
      model: modifyFields(model, { favourite: (favourite) => AsyncData.settle(favourite, unavailable) }),
    }),
    SucceededReadTray: ({ tray }) => ({ model: modifyFields(model, { tray: () => TrayData.Success({ data: tray }) }) }),
    FailedReadTray: () => ({ model: modifyFields(model, { tray: (tray) => AsyncData.settle(tray, unavailable) }) }),
  })
