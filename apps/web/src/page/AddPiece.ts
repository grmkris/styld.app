import { FileDrop } from '@foldkit/ui'
import {
  AddPiece as AddPieceInput,
  Category,
  Colour,
  ImageType,
  maximumImageBytes,
  OperationId,
  Subcategory,
  UploadId,
} from '@styld/protocol'
import { Array, Effect, Option, Schema } from 'effect'
import * as Crypto from 'effect/Crypto'
import { Command, File, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'
import { toggleColour } from './PieceFields.ts'

// MODEL

/** Why the chosen file cannot be the piece's photo. */
export const PhotoProblem = Schema.Literals(['missing', 'notAnImage', 'tooLarge'])
export type PhotoProblem = typeof PhotoProblem.Type

/** One intended addition. A retry repeats its operation id, and once its photo is up, its upload,
 * so the server answers it once; any change to the piece starts a new attempt. */
const Attempt = Schema.Struct({ operationId: Schema.String, uploadId: Schema.Option(Schema.String) })

export const Submission = defineTaggedUnion({
  Idle: {},
  Preparing: {},
  Uploading: {},
  Adding: {},
  Failed: {},
})

export const Model = Schema.Struct({
  drop: FileDrop.Model,
  photo: Schema.Option(File.File),
  /** A `blob:` URL for the chosen photo, made and revoked by Commands. */
  preview: Schema.Option(Schema.String),
  photoProblem: Schema.Option(PhotoProblem),
  category: Schema.Option(Category),
  categoryMissing: Schema.Boolean,
  subcategory: Schema.Option(Subcategory),
  colours: Schema.Array(Colour),
  name: Schema.String,
  attempt: Schema.Option(Attempt),
  submission: Submission,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  drop: FileDrop.init({ id: 'piece-photo' }),
  photo: Option.none(),
  preview: Option.none(),
  photoProblem: Option.none(),
  category: Option.none(),
  categoryMissing: false,
  subcategory: Option.none(),
  colours: [],
  name: '',
  attempt: Option.none(),
  submission: Submission.Idle(),
})

// MESSAGE

export const Message = defineMessageUnion({
  GotDropMessage: { message: FileDrop.Message },
  CreatedPreview: { url: Schema.String },
  RevokedPreview: {},
  ClickedRemovePhoto: {},
  ChoseCategory: { category: Category },
  ChoseSubcategory: { subcategory: Schema.Option(Subcategory) },
  ToggledColour: { colour: Colour },
  UpdatedName: { value: Schema.String },
  SubmittedPiece: {},
  DrewOperationId: { operationId: Schema.String },
  SucceededUploadPhoto: { uploadId: Schema.String },
  FailedUploadPhoto: {},
  SucceededAddPiece: { pieceId: Schema.String },
  FailedAddPiece: { retry: Schema.Literals(['same', 'fresh']) },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ AddedPiece: { pieceId: Schema.String } })
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** @internal Exported for its tests. */
export const ShowPreview = Command.define('ShowPreview', {
  args: { photo: File.File },
  messages: [Message.CreatedPreview],
  execute: ({ photo }) => Effect.sync(() => Message.CreatedPreview({ url: URL.createObjectURL(photo) })),
})

/** @internal Exported for its tests. */
export const RevokePreview = Command.define('RevokePreview', {
  args: { url: Schema.String },
  messages: [Message.RevokedPreview],
  execute: ({ url }) =>
    Effect.sync(() => {
      URL.revokeObjectURL(url)
      return Message.RevokedPreview()
    }),
})

/** @internal Exported for its tests. */
export const DrawOperationId = Command.define('DrawOperationId', {
  messages: [Message.DrewOperationId],
  execute: Effect.gen(function* () {
    const operationId = yield* (yield* Crypto.Crypto).randomUUIDv4()
    return Message.DrewOperationId({ operationId })
  }).pipe(Effect.orDie),
})

/** @internal Exported for its tests. */
export const UploadPhoto = Command.define('UploadPhoto', {
  args: { photo: File.File, contentType: ImageType },
  messages: [Message.SucceededUploadPhoto, Message.FailedUploadPhoto],
  execute: ({ photo, contentType }) =>
    Effect.gen(function* () {
      const { api: loadApi, sendPhoto } = yield* StyldClient
      const api = yield* loadApi
      const upload = yield* api.wardrobe.createUpload({ payload: { contentType, bytes: photo.size } })
      yield* sendPhoto(upload.path, photo)
      return Message.SucceededUploadPhoto({ uploadId: upload.uploadId })
    }).pipe(Effect.orElseSucceed(() => Message.FailedUploadPhoto())),
})

const AddPieceArgs = Schema.Struct({
  operationId: Schema.String,
  uploadId: Schema.String,
  category: Category,
  subcategory: Schema.Option(Subcategory),
  colours: Schema.Array(Colour),
  name: Schema.Option(Schema.String),
})

/** @internal Exported for its tests. */
export const AddPiece = Command.define('AddPiece', {
  args: AddPieceArgs.fields,
  messages: [Message.SucceededAddPiece, Message.FailedAddPiece],
  execute: (args) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const payload: typeof AddPieceInput.Type = {
        operationId: yield* Schema.decodeUnknownEffect(OperationId)(args.operationId),
        uploadId: yield* Schema.decodeUnknownEffect(UploadId)(args.uploadId),
        category: args.category,
        ...Option.match(args.subcategory, { onNone: () => ({}), onSome: (subcategory) => ({ subcategory }) }),
        ...(args.colours.length === 0 ? {} : { colours: args.colours }),
        ...Option.match(args.name, { onNone: () => ({}), onSome: (name) => ({ name }) }),
      }
      const piece = yield* api.wardrobe.addPiece({ payload })
      return Message.SucceededAddPiece({ pieceId: piece.id })
    }).pipe(
      // A refused photo or a reused operation can never succeed as sent; anything else may have
      // been lost on the way, so the same request is tried again.
      Effect.catchTags({
        UploadRefused: () => Effect.succeed(Message.FailedAddPiece({ retry: 'fresh' })),
        OperationConflict: () => Effect.succeed(Message.FailedAddPiece({ retry: 'fresh' })),
        SubcategoryMismatch: () => Effect.succeed(Message.FailedAddPiece({ retry: 'fresh' })),
      }),
      Effect.orElseSucceed(() => Message.FailedAddPiece({ retry: 'same' })),
    ),
})

// UPDATE

type Services = StyldClient | Crypto.Crypto
type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, Services>

const imageTypes: ReadonlyArray<string> = ImageType.literals

/** Photos Styld takes, by the file's own type: the server checks the bytes again. */
const photoProblemOf = (photo: File.File): Option.Option<PhotoProblem> =>
  !imageTypes.includes(File.mimeType(photo))
    ? Option.some('notAnImage')
    : File.size(photo) > maximumImageBytes
      ? Option.some('tooLarge')
      : Option.none()

const revoke = (preview: Option.Option<string>) =>
  Option.match(preview, { onNone: () => [], onSome: (url) => [RevokePreview({ url })] })

/** The person changed what is being added: the next submission is a new attempt. */
const changed = (model: Model, change: (model: Model) => Model): UpdateReturn =>
  Submission.guards.Idle(model.submission) || Submission.guards.Failed(model.submission)
    ? {
        model: modifyFields(change(model), { attempt: () => Option.none(), submission: () => Submission.Idle() }),
      }
    : { model }

const choosePhoto = (model: Model, photo: File.File): UpdateReturn => {
  const problem = photoProblemOf(photo)
  const next = changed(model, (current) =>
    modifyFields(current, {
      photo: () => (Option.isNone(problem) ? Option.some(photo) : Option.none()),
      preview: () => Option.none(),
      photoProblem: () => problem,
    }),
  )
  if (next.model === model) return next
  return {
    ...next,
    commands: [...revoke(model.preview), ...(Option.isNone(problem) ? [ShowPreview({ photo })] : [])],
  }
}

const foldDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.drop),
  write: (model: Model, drop: FileDrop.Model) => modifyFields(model, { drop: () => drop }),
  toParentMessage: (message: FileDrop.Message) => Message.GotDropMessage({ message }),
  foldOutMessage: FileDrop.OutMessage.match<Update.StepWithOutMessage<Model, Message, OutMessage, Services>>({
    ReceivedFiles:
      ({ files }) =>
      (model) =>
        choosePhoto(model, Array.headNonEmpty(files)),
    RejectedNonFiles: () => (model) => ({ model }),
  }),
})

/** Upload the photo unless this attempt already did, then add the piece. */
const proceed = (model: Model, operationId: string, uploadId: Option.Option<string>): UpdateReturn => {
  const photo = Option.getOrUndefined(model.photo)
  const category = Option.getOrUndefined(model.category)
  if (photo === undefined || category === undefined) return { model }
  const attempt = Option.some({ operationId, uploadId })
  return Option.match(uploadId, {
    onNone: () => ({
      model: modifyFields(model, { attempt: () => attempt, submission: () => Submission.Uploading() }),
      commands: [UploadPhoto({ photo, contentType: Schema.decodeUnknownSync(ImageType)(File.mimeType(photo)) })],
    }),
    onSome: (uploaded) => {
      const name = model.name.trim()
      return {
        model: modifyFields(model, { attempt: () => attempt, submission: () => Submission.Adding() }),
        commands: [
          AddPiece({
            operationId,
            uploadId: uploaded,
            category,
            subcategory: model.subcategory,
            colours: model.colours,
            name: name.length === 0 ? Option.none() : Option.some(name),
          }),
        ],
      }
    },
  })
}

const submitted = (model: Model): UpdateReturn => {
  if (!(Submission.guards.Idle(model.submission) || Submission.guards.Failed(model.submission))) return { model }
  if (Option.isNone(model.photo) || Option.isNone(model.category))
    return {
      model: modifyFields(model, {
        photoProblem: (problem) => (Option.isNone(model.photo) ? Option.some<PhotoProblem>('missing') : problem),
        categoryMissing: () => Option.isNone(model.category),
      }),
    }
  return Option.match(model.attempt, {
    onNone: () => ({
      model: modifyFields(model, { submission: () => Submission.Preparing() }),
      commands: [DrawOperationId()],
    }),
    onSome: ({ operationId, uploadId }) => proceed(model, operationId, uploadId),
  })
}

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotDropMessage: ({ message: dropMessage }) => foldDrop(model, dropMessage),
    CreatedPreview: ({ url }) =>
      // A preview for a photo the person has since replaced or removed is let go at once.
      Option.isSome(model.photo) && Option.isNone(model.preview)
        ? { model: modifyFields(model, { preview: () => Option.some(url) }) }
        : { model, commands: [RevokePreview({ url })] },
    RevokedPreview: () => ({ model }),
    ClickedRemovePhoto: () => {
      const next = changed(model, (current) =>
        modifyFields(current, { photo: () => Option.none(), preview: () => Option.none() }),
      )
      return next.model === model ? next : { ...next, commands: revoke(model.preview) }
    },
    ChoseCategory: ({ category }) =>
      changed(model, (current) =>
        modifyFields(current, {
          category: () => Option.some(category),
          categoryMissing: () => false,
          // A shelf belongs to its category.
          subcategory: (subcategory) => (Option.contains(current.category, category) ? subcategory : Option.none()),
        }),
      ),
    ChoseSubcategory: ({ subcategory }) =>
      changed(model, (current) => modifyFields(current, { subcategory: () => subcategory })),
    ToggledColour: ({ colour }) =>
      changed(model, (current) => modifyFields(current, { colours: toggleColour(colour) })),
    UpdatedName: ({ value }) => changed(model, (current) => modifyFields(current, { name: () => value })),
    SubmittedPiece: () => submitted(model),
    DrewOperationId: ({ operationId }) =>
      Submission.guards.Preparing(model.submission) ? proceed(model, operationId, Option.none()) : { model },
    SucceededUploadPhoto: ({ uploadId }) =>
      Option.match(model.attempt, {
        onNone: () => ({ model }),
        onSome: ({ operationId }) => proceed(model, operationId, Option.some(uploadId)),
      }),
    FailedUploadPhoto: () => ({ model: modifyFields(model, { submission: () => Submission.Failed() }) }),
    SucceededAddPiece: ({ pieceId }) => ({ model, outMessage: OutMessage.AddedPiece({ pieceId }) }),
    FailedAddPiece: ({ retry }) => ({
      model: modifyFields(model, {
        submission: () => Submission.Failed(),
        attempt: (attempt) => (retry === 'same' ? attempt : Option.none()),
      }),
    }),
  })
