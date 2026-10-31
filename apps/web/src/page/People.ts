import { Dialog } from '@foldkit/ui'
import { BoardId, Handle, LookId, PieceId, Relation, ReportReason, reportNoteLength } from '@styld/protocol'
import { Effect, Option, Predicate, Schema } from 'effect'
import { Command, Dom, Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { tookReturn } from '../SignInReturn.ts'
import { StyldClient } from '../StyldClient.ts'

// What a visitor does with someone's profile or piece: follow or block the person, save the piece, and report either.
// Signed out, Follow and Save look the same but lead to sign-in, which returns to the page; nothing else is offered.

// MODEL

/** Whose page this is: a person by handle, or one of their pieces. */
export const Subject = defineTaggedUnion({
  Person: { handle: Schema.String },
  Piece: { pieceId: Schema.String },
  Board: { boardId: Schema.String },
  Look: { lookId: Schema.String },
})
export type Subject = typeof Subject.Type

/** Where the visitor stands with the person: unknown when nobody asked (signed out, one's own profile) or the read
 * failed, being read, or read. */
export const Standing = defineTaggedUnion({ Unknown: {}, Reading: {}, Known: { relation: Relation } })
export type Standing = typeof Standing.Type

export const Work = defineTaggedUnion({ Idle: {}, Sending: {}, Failed: {} })
export type Work = typeof Work.Type

/** The report form: closed, open with a reason and words, sending, sent, or refused. */
/** Why a report was not sent: it failed, or the hour's reports are used up. */
const ReportProblem = Schema.Literals(['failed', 'tooMany'])

/** The report form: closed, open with a reason and words (and why the last send failed, the words kept), sending,
 * or sent. */
export const Reporting = defineTaggedUnion({
  Closed: {},
  Open: { reason: Schema.Option(ReportReason), note: Schema.String, problem: Schema.Option(ReportProblem) },
  Sending: { reason: ReportReason, note: Schema.String },
  Sent: {},
})
export type Reporting = typeof Reporting.Type

/** A Follow pressed signed out comes back with sign-in at `#follow`. Whether sign-in brought this tab here is checked
 * first; a follow so confirmed waits for the standing to be read, and is then spent.
 * @internal Exported for its tests. */
export const FollowArrival = defineTaggedUnion({ None: {}, Checking: {}, Confirmed: {} })
export type FollowArrival = typeof FollowArrival.Type

export const Model = Schema.Struct({
  subject: Subject,
  standing: Standing,
  saved: Schema.Boolean,
  work: Work,
  confirmingBlock: Schema.Boolean,
  reporting: Reporting,
  followArrival: FollowArrival,
  /** On someone's profile, Report and Block behind More (Gallery's person screen), in a sheet from the bottom. */
  more: Dialog.Model,
})
export type Model = typeof Model.Type

/** A page for a subject; `atFollow` when it opened at `#follow`. */
export const init = (subject: Subject, atFollow = false): Model => ({
  subject,
  standing: Standing.Unknown(),
  saved: false,
  work: Work.Idle(),
  confirmingBlock: false,
  reporting: Reporting.Closed(),
  followArrival: atFollow ? FollowArrival.Checking() : FollowArrival.None(),
  more: Dialog.init({ id: 'people-more', isAnimated: true }),
})

// MESSAGE

export const Message = defineMessageUnion({
  SucceededLoadRelation: { relation: Relation },
  FailedLoadRelation: {},
  CheckedFollowArrival: { fromSignIn: Schema.Boolean },
  ClickedFollow: { following: Schema.Boolean },
  ClickedBlock: {},
  ClickedConfirmBlock: { blocked: Schema.Boolean },
  ClickedKeepUnblocked: {},
  SucceededSetRelation: { relation: Relation },
  ClickedSave: { saved: Schema.Boolean },
  SucceededSetSaved: { saved: Schema.Boolean },
  FailedPeopleWork: {},
  ClickedReport: {},
  ClickedMore: {},
  GotMoreMessage: { message: Dialog.Message },
  CompletedFocusMoreTitle: {},
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

/** Whether sign-in brought this tab to the profile at `#follow` (`SignInReturn.ts`). */
const TakeFollowArrival = Command.define('TakeFollowArrival', {
  messages: [Message.CheckedFollowArrival],
  execute: Effect.map(tookReturn, (fromSignIn) => Message.CheckedFollowArrival({ fromSignIn })),
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

/** What a save is of: a piece, a look or a board; a person is followed, not saved. */
const saveTargetOf = (subject: Subject) =>
  Subject.match(subject, {
    Person: () => Effect.fail('person' as const),
    Piece: ({ pieceId }) =>
      Effect.map(Schema.decodeUnknownEffect(PieceId)(pieceId), (id) => ({ _tag: 'SavedPiece' as const, pieceId: id })),
    Board: ({ boardId }) =>
      Effect.map(Schema.decodeUnknownEffect(BoardId)(boardId), (id) => ({ _tag: 'SavedBoard' as const, boardId: id })),
    Look: ({ lookId }) =>
      Effect.map(Schema.decodeUnknownEffect(LookId)(lookId), (id) => ({ _tag: 'SavedLook' as const, lookId: id })),
  })

/** What a report is about. */
const reportTargetOf = (subject: Subject) =>
  Subject.match(subject, {
    Person: ({ handle }) => Effect.map(handleOf(handle), (id) => ({ _tag: 'ReportedProfile' as const, handle: id })),
    Piece: ({ pieceId }) =>
      Effect.map(Schema.decodeUnknownEffect(PieceId)(pieceId), (id) => ({
        _tag: 'ReportedPiece' as const,
        pieceId: id,
      })),
    Board: ({ boardId }) =>
      Effect.map(Schema.decodeUnknownEffect(BoardId)(boardId), (id) => ({
        _tag: 'ReportedBoard' as const,
        boardId: id,
      })),
    Look: ({ lookId }) =>
      Effect.map(Schema.decodeUnknownEffect(LookId)(lookId), (id) => ({ _tag: 'ReportedLook' as const, lookId: id })),
  })

/** @internal Exported for its tests. */
export const SetSaved = Command.define('SetSaved', {
  args: { subject: Subject, saved: Schema.Boolean },
  messages: [Message.SucceededSetSaved, Message.FailedPeopleWork],
  execute: ({ subject, saved }) =>
    Effect.gen(function* () {
      const api = yield* (yield* StyldClient).api
      const target = yield* saveTargetOf(subject)
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
      const target = yield* reportTargetOf(subject)
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

/** Reads where the visitor stands with the person, and whether sign-in brought them here to follow; the actions keep
 * their room while it is out. */
export const readRelation = (model: Model): Update.Return<Model, Message, StyldClient> =>
  Subject.guards.Person(model.subject) && model.subject.handle.length > 0
    ? {
        model: modifyFields(model, { standing: () => Standing.Reading() }),
        commands: [
          LoadRelation({ handle: model.subject.handle }),
          ...(FollowArrival.guards.Checking(model.followArrival) ? [TakeFollowArrival()] : []),
        ],
      }
    : { model }

// UPDATE

type UpdateReturn = Update.Return<Model, Message, StyldClient>

const handleOfSubject = (model: Model) => (Subject.guards.Person(model.subject) ? model.subject.handle : '')

const sending = (model: Model, command: Command.Command<Message, never, StyldClient>): UpdateReturn =>
  Work.guards.Sending(model.work)
    ? { model }
    : { model: modifyFields(model, { work: () => Work.Sending(), confirmingBlock: () => false }), commands: [command] }

/** The Follow pressed before signing in, applied once sign-in is confirmed and the standing read; one already followed
 * or blocked is left as it is. */
const followOnArrival = (model: Model, relation: typeof Relation.Type): UpdateReturn => {
  if (!FollowArrival.guards.Confirmed(model.followArrival)) return { model }
  const spent = modifyFields(model, { followArrival: () => FollowArrival.None() })
  return relation.following || relation.blocked
    ? { model: spent }
    : sending(spent, SetFollowing({ handle: handleOfSubject(spent), following: true }))
}

const moreSheet = {
  read: (model: Model) => Option.some(model.more),
  write: (model: Model, more: Dialog.Model) => modifyFields(model, { more: () => more }),
  toParentMessage: (message: Dialog.Message) => Message.GotMoreMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<Update.Step<Model, Message>>({
    Opened: () => (model) => ({ model }),
    // Closed, the sheet forgets a report or a block question left in it, and a block that failed in it, so its error
    // does not land under Follow; a report being sent goes on.
    Closed: () => (model) => ({
      model: modifyFields(model, {
        confirmingBlock: () => false,
        reporting: (reporting) => (Reporting.guards.Sending(reporting) ? reporting : Reporting.Closed()),
        work: (work) => (Work.guards.Failed(work) ? Work.Idle() : work),
      }),
    }),
  }),
}
const foldMore = Update.foldChild({ update: Dialog.update, ...moreSheet })
const openMore = Update.foldChildStep({ update: Dialog.open, ...moreSheet })
const closeMore = Update.foldChildStep({ update: Dialog.close, ...moreSheet })

/** The More sheet once the block or unblock it asked for is done; elsewhere there is no sheet to close. */
const leaveMore = (model: Model): UpdateReturn => (model.more.isOpen ? closeMore(model) : { model })

/** The More sheet's title, once its content changes to a question or the report form, so focus and a screen reader
 * follow it there.
 * @internal Exported for its tests. */
export const FocusMoreTitle = Command.define('FocusMoreTitle', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusMoreTitle],
  execute: ({ id }) =>
    Dom.focus(`#${id}`, { preventScroll: true, makeFocusable: true }).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusMoreTitle()),
    ),
})

/** A step inside the open More sheet: its content changes in place, and its title takes focus. */
const inSheet = (model: Model): UpdateReturn =>
  model.more.isOpen ? { model, commands: [FocusMoreTitle({ id: Dialog.titleId(model.more) })] } : { model }

const submitted = (model: Model): UpdateReturn => {
  const { reporting } = model
  if (!Reporting.guards.Open(reporting) || Option.isNone(reporting.reason)) return { model }
  const sent = { reason: reporting.reason.value, note: reporting.note }
  return {
    model: modifyFields(model, { reporting: () => Reporting.Sending(sent) }),
    commands: [SendReport({ subject: model.subject, ...sent })],
  }
}

/** @internal Exported for its tests. */
export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadRelation: ({ relation }) =>
      followOnArrival(modifyFields(model, { standing: () => Standing.Known({ relation }) }), relation),
    FailedLoadRelation: () => ({ model: modifyFields(model, { standing: () => Standing.Unknown() }) }),
    CheckedFollowArrival: ({ fromSignIn }) => {
      const checked = modifyFields(model, {
        followArrival: () => (fromSignIn ? FollowArrival.Confirmed() : FollowArrival.None()),
      })
      return Standing.guards.Known(model.standing)
        ? followOnArrival(checked, model.standing.relation)
        : { model: checked }
    },
    ClickedFollow: ({ following }) => sending(model, SetFollowing({ handle: handleOfSubject(model), following })),
    ClickedBlock: () => inSheet(modifyFields(model, { confirmingBlock: () => true })),
    ClickedKeepUnblocked: () => inSheet(modifyFields(model, { confirmingBlock: () => false })),
    // The sheet stays, its button waiting, until the block is done.
    ClickedConfirmBlock: ({ blocked }) =>
      Work.guards.Sending(model.work)
        ? { model }
        : {
            model: modifyFields(model, { work: () => Work.Sending() }),
            commands: [SetBlocked({ handle: handleOfSubject(model), blocked })],
          },
    SucceededSetRelation: ({ relation }) =>
      leaveMore(
        modifyFields(model, {
          standing: () => Standing.Known({ relation }),
          work: () => Work.Idle(),
          confirmingBlock: () => false,
        }),
      ),
    CompletedFocusMoreTitle: () => ({ model }),
    ClickedSave: ({ saved }) =>
      Subject.guards.Person(model.subject) ? { model } : sending(model, SetSaved({ subject: model.subject, saved })),
    SucceededSetSaved: ({ saved }) => ({ model: modifyFields(model, { saved: () => saved, work: () => Work.Idle() }) }),
    FailedPeopleWork: () => ({ model: modifyFields(model, { work: () => Work.Failed() }) }),
    ClickedReport: () =>
      inSheet(
        modifyFields(model, {
          reporting: () => Reporting.Open({ reason: Option.none(), note: '', problem: Option.none() }),
        }),
      ),
    // A Follow that failed before is not the sheet's failure: opening it starts clean.
    ClickedMore: () =>
      openMore(modifyFields(model, { work: () => (Work.guards.Failed(model.work) ? Work.Idle() : model.work) })),
    GotMoreMessage: (got) => foldMore(model, got.message),
    ChoseReportReason: ({ reason }) => ({
      model: modifyFields(model, {
        reporting: (reporting) =>
          Reporting.guards.Open(reporting)
            ? Reporting.Open({ reason: Option.some(reason), note: reporting.note, problem: reporting.problem })
            : reporting,
      }),
    }),
    UpdatedReportNote: ({ value }) => ({
      model: modifyFields(model, {
        reporting: (reporting) =>
          Reporting.guards.Open(reporting)
            ? Reporting.Open({ reason: reporting.reason, note: value, problem: reporting.problem })
            : reporting,
      }),
    }),
    ClickedCancelReport: () => inSheet(modifyFields(model, { reporting: () => Reporting.Closed() })),
    SubmittedReport: () => submitted(model),
    SucceededReport: () => ({ model: modifyFields(model, { reporting: () => Reporting.Sent() }) }),
    // The form comes back with its reason and words, and says why it was not sent.
    FailedReport: ({ tooMany }) => ({
      model: modifyFields(model, {
        reporting: (reporting) =>
          Reporting.guards.Sending(reporting)
            ? Reporting.Open({
                reason: Option.some(reporting.reason),
                note: reporting.note,
                problem: Option.some(tooMany ? 'tooMany' : 'failed'),
              })
            : reporting,
      }),
    }),
  })

/** Following, saving and reporting inside a page whose model keeps them as `people`. */
export const foldInto = <Parent extends { readonly people: Model }, ParentMessage>(
  toParentMessage: (message: Message) => ParentMessage,
) =>
  Update.foldChild({
    update,
    read: (parent: Parent) => Option.some(parent.people),
    write: (parent: Parent, people: Model): Parent => ({ ...parent, people }),
    toParentMessage,
  })
