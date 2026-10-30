import { Handle, PieceId, Relation, ReportReason, reportNoteLength } from '@styld/protocol'
import { Effect, Option, Predicate, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { StyldClient } from '../StyldClient.ts'

// What a visitor does with someone's profile or piece: follow or block the person, save the piece, and report either.
// Signed out, none of it is offered but the way to sign in.

// MODEL

/** Whose page this is: a person by handle, or one of their pieces. */
export const Subject = defineTaggedUnion({ Person: { handle: Schema.String }, Piece: { pieceId: Schema.String } })
export type Subject = typeof Subject.Type

/** Where the visitor stands with the person, once read; unknown signed out. */
export const Standing = defineTaggedUnion({ Unknown: {}, Known: { relation: Relation } })
export type Standing = typeof Standing.Type

export const Work = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {} })
export type Work = typeof Work.Type

/** The report form: closed, open with a reason and words, sending, sent, or refused. */
export const Reporting = defineTaggedUnion({
  Closed: {},
  Open: { reason: Schema.Option(ReportReason), note: Schema.String },
  Sending: {},
  Sent: {},
  Failed: { tooMany: Schema.Boolean },
})
export type Reporting = typeof Reporting.Type

export const Model = Schema.Struct({
  subject: Subject,
  standing: Standing,
  saved: Schema.Boolean,
  work: Work,
  confirmingBlock: Schema.Boolean,
  reporting: Reporting,
})
export type Model = typeof Model.Type

export const init = (subject: Subject): Model => ({
  subject,
  standing: Standing.Unknown(),
  saved: false,
  work: Work.Idle(),
  confirmingBlock: false,
  reporting: Reporting.Closed(),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadRelation: { relation: Relation },
  FailedLoadRelation: {},
  ClickedFollow: { following: Schema.Boolean },
  ClickedBlock: {},
  ClickedConfirmBlock: { blocked: Schema.Boolean },
  ClickedKeepUnblocked: {},
  SucceededSetRelation: { relation: Relation },
  ClickedSave: { saved: Schema.Boolean },
  SucceededSetSaved: { saved: Schema.Boolean },
  FailedPeopleWork: {},
  ClickedReport: {},
  ChoseReportReason: { reason: ReportReason },
  UpdatedReportNote: { value: Schema.String },
  ClickedCancelReport: {},
  SubmittedReport: {},
  SucceededReport: {},
  FailedReport: { tooMany: Schema.Boolean },
})
export type Message = typeof Message.Type

// COMMAND

const handleOf = (handle: string) => Schema.decodeUnknownEffect(Handle)(handle.toLowerCase())

const LoadRelation = Command.define('LoadRelation', {
  args: { handle: Schema.String },
  messages: [Message.SucceededLoadRelation, Message.FailedLoadRelation],
  execute: ({ handle }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const relation = yield* api.social.relation({ params: { handle: yield* handleOf(handle) } })
      return Message.SucceededLoadRelation({ relation })
    }).pipe(Effect.orElseSucceed(() => Message.FailedLoadRelation())),
})

/** @internal Exported for its tests. */
export const SetFollowing = Command.define('SetFollowing', {
  args: { handle: Schema.String, following: Schema.Boolean },
  messages: [Message.SucceededSetRelation, Message.FailedPeopleWork],
  execute: ({ handle, following }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const relation = yield* api.social.setFollowing({
        params: { handle: yield* handleOf(handle) },
        payload: { following },
      })
      return Message.SucceededSetRelation({ relation })
    }).pipe(Effect.orElseSucceed(() => Message.FailedPeopleWork())),
})

/** @internal Exported for its tests. */
export const SetBlocked = Command.define('SetBlocked', {
  args: { handle: Schema.String, blocked: Schema.Boolean },
  messages: [Message.SucceededSetRelation, Message.FailedPeopleWork],
  execute: ({ handle, blocked }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const relation = yield* api.social.setBlocked({
        params: { handle: yield* handleOf(handle) },
        payload: { blocked },
      })
      return Message.SucceededSetRelation({ relation })
    }).pipe(Effect.orElseSucceed(() => Message.FailedPeopleWork())),
})

/** @internal Exported for its tests. */
export const SetSaved = Command.define('SetSaved', {
  args: { pieceId: Schema.String, saved: Schema.Boolean },
  messages: [Message.SucceededSetSaved, Message.FailedPeopleWork],
  execute: ({ pieceId, saved }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const target = { _tag: 'SavedPiece' as const, pieceId: yield* Schema.decodeUnknownEffect(PieceId)(pieceId) }
      const answer = yield* api.social.setSaved({ payload: { target, saved } })
      return Message.SucceededSetSaved({ saved: answer.saved })
    }).pipe(Effect.orElseSucceed(() => Message.FailedPeopleWork())),
})

/** @internal Exported for its tests. */
export const SendReport = Command.define('SendReport', {
  args: { subject: Subject, reason: ReportReason, note: Schema.String },
  messages: [Message.SucceededReport, Message.FailedReport],
  execute: ({ subject, reason, note }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const target = Subject.guards.Person(subject)
        ? { _tag: 'ReportedProfile' as const, handle: yield* handleOf(subject.handle) }
        : { _tag: 'ReportedPiece' as const, pieceId: yield* Schema.decodeUnknownEffect(PieceId)(subject.pieceId) }
      const words = note.trim().slice(0, reportNoteLength)
      yield* api.social.report({ payload: { target, reason, ...(words.length > 0 ? { note: words } : {}) } })
      return Message.SucceededReport()
    }).pipe(
      Effect.catchIf(
        (error) => Predicate.isTagged(error, 'TooManyReports'),
        () => Effect.succeed(Message.FailedReport({ tooMany: true })),
      ),
      Effect.orElseSucceed(() => Message.FailedReport({ tooMany: false })),
    ),
})

/** The Commands that open the page: where the visitor stands with the person. */
export const load = (model: Model): ReadonlyArray<Command.Command<Message, never, StyldClient>> =>
  Subject.guards.Person(model.subject) && model.subject.handle.length > 0
    ? [LoadRelation({ handle: model.subject.handle })]
    : []

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

const handleOfSubject = (model: Model) => (Subject.guards.Person(model.subject) ? model.subject.handle : '')

const sending = (model: Model, command: Command.Command<Message, never, StyldClient>): UpdateReturn =>
  Work.guards.Sending(model.work)
    ? { model }
    : { model: modifyFields(model, { work: () => Work.Sending(), confirmingBlock: () => false }), commands: [command] }

const submitted = (model: Model): UpdateReturn =>
  Reporting.guards.Open(model.reporting) && Option.isSome(model.reporting.reason)
    ? {
        model: modifyFields(model, { reporting: () => Reporting.Sending() }),
        commands: [
          SendReport({ subject: model.subject, reason: model.reporting.reason.value, note: model.reporting.note }),
        ],
      }
    : { model }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadRelation: ({ relation }) => ({
      model: modifyFields(model, { standing: () => Standing.Known({ relation }) }),
    }),
    FailedLoadRelation: () => ({ model }),
    ClickedFollow: ({ following }) => sending(model, SetFollowing({ handle: handleOfSubject(model), following })),
    ClickedBlock: () => ({ model: modifyFields(model, { confirmingBlock: () => true }) }),
    ClickedKeepUnblocked: () => ({ model: modifyFields(model, { confirmingBlock: () => false }) }),
    ClickedConfirmBlock: ({ blocked }) => sending(model, SetBlocked({ handle: handleOfSubject(model), blocked })),
    SucceededSetRelation: ({ relation }) => ({
      model: modifyFields(model, { standing: () => Standing.Known({ relation }), work: () => Work.Idle() }),
    }),
    ClickedSave: ({ saved }) =>
      Subject.guards.Piece(model.subject)
        ? sending(model, SetSaved({ pieceId: model.subject.pieceId, saved }))
        : { model },
    SucceededSetSaved: ({ saved }) => ({ model: modifyFields(model, { saved: () => saved, work: () => Work.Idle() }) }),
    FailedPeopleWork: () => ({ model: modifyFields(model, { work: () => Work.Failed() }) }),
    ClickedReport: () => ({
      model: modifyFields(model, { reporting: () => Reporting.Open({ reason: Option.none(), note: '' }) }),
    }),
    ChoseReportReason: ({ reason }) => ({
      model: modifyFields(model, {
        reporting: (reporting) =>
          Reporting.guards.Open(reporting)
            ? Reporting.Open({ reason: Option.some(reason), note: reporting.note })
            : reporting,
      }),
    }),
    UpdatedReportNote: ({ value }) => ({
      model: modifyFields(model, {
        reporting: (reporting) =>
          Reporting.guards.Open(reporting) ? Reporting.Open({ reason: reporting.reason, note: value }) : reporting,
      }),
    }),
    ClickedCancelReport: () => ({ model: modifyFields(model, { reporting: () => Reporting.Closed() }) }),
    SubmittedReport: () => submitted(model),
    SucceededReport: () => ({ model: modifyFields(model, { reporting: () => Reporting.Sent() }) }),
    FailedReport: ({ tooMany }) => ({ model: modifyFields(model, { reporting: () => Reporting.Failed({ tooMany }) }) }),
  })
