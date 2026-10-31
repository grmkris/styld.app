import { Relation } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  FollowArrival,
  init,
  Message,
  readRelation,
  Reporting,
  SendReport,
  SetBlocked,
  SetFollowing,
  SetSaved,
  Standing,
  Subject,
  update,
  Work,
} from '../src/page/People.ts'

const relation = (changes: Partial<{ following: boolean; blocked: boolean }> = {}) =>
  Schema.decodeUnknownSync(Relation)({ handle: 'nika.kovac', following: false, blocked: false, ...changes })
const person = init(Subject.Person({ handle: 'nika.kovac' }))
const known = update(person, Message.SucceededLoadRelation({ relation: relation() })).model
const pieceId = `pc_${'knit'.padEnd(22, 'x')}`

describe('what a visitor does with someone', () => {
  test('back from signing in to follow, follows once the standing is read, and not one already followed', () => {
    const arriving = readRelation(init(Subject.Person({ handle: 'nika.kovac' }), true))
    expect(arriving.commands?.map(({ name }) => name)).toEqual(['LoadRelation', 'TakeFollowArrival'])
    story(
      update,
      given(arriving.model),
      message(Message.SucceededLoadRelation({ relation: relation() })),
      Command.expectNone(),
      message(Message.CheckedFollowArrival({ fromSignIn: true })),
      Command.resolve(
        SetFollowing({ handle: 'nika.kovac', following: true }),
        Message.SucceededSetRelation({ relation: relation({ following: true }) }),
      ),
      model(({ standing, followArrival }) => {
        expect(standing).toEqual(Standing.Known({ relation: relation({ following: true }) }))
        expect(followArrival).toEqual(FollowArrival.None())
      }),
    )
    // Confirmed before the standing is in, the follow waits for it.
    story(
      update,
      given(arriving.model),
      message(Message.CheckedFollowArrival({ fromSignIn: true })),
      Command.expectNone(),
      message(Message.SucceededLoadRelation({ relation: relation() })),
      Command.expectExact(SetFollowing({ handle: 'nika.kovac', following: true })),
      Command.resolve(SetFollowing, Message.SucceededSetRelation({ relation: relation({ following: true }) })),
    )
    story(
      update,
      given(arriving.model),
      message(Message.CheckedFollowArrival({ fromSignIn: true })),
      message(Message.SucceededLoadRelation({ relation: relation({ following: true }) })),
      Command.expectNone(),
    )
  })

  test('a link that only ends in #follow, a reload or Back to it, follows nobody', () => {
    const arriving = readRelation(init(Subject.Person({ handle: 'nika.kovac' }), true))
    story(
      update,
      given(arriving.model),
      message(Message.CheckedFollowArrival({ fromSignIn: false })),
      message(Message.SucceededLoadRelation({ relation: relation() })),
      Command.expectNone(),
      model(({ followArrival }) => expect(followArrival).toEqual(FollowArrival.None())),
    )
  })

  test('holds the room for Follow while it reads where the visitor stands, and gives it up if the read fails', () => {
    const reading = readRelation(person)
    expect(reading.model.standing).toEqual(Standing.Reading())
    expect(reading.commands).toHaveLength(1)
    story(
      update,
      given(reading.model),
      message(Message.FailedLoadRelation()),
      model(({ standing }) => expect(standing).toEqual(Standing.Unknown())),
    )
    expect(readRelation(init(Subject.Piece({ pieceId }))).commands ?? []).toHaveLength(0)
  })

  test('follows them, and a block asks once more and ends the follow', () => {
    story(
      update,
      given(known),
      message(Message.ClickedFollow({ following: true })),
      Command.resolve(
        SetFollowing({ handle: 'nika.kovac', following: true }),
        Message.SucceededSetRelation({ relation: relation({ following: true }) }),
      ),
      model(({ standing }) => expect(standing).toEqual(Standing.Known({ relation: relation({ following: true }) }))),
      message(Message.ClickedBlock()),
      model(({ confirmingBlock }) => expect(confirmingBlock).toBe(true)),
      message(Message.ClickedKeepUnblocked()),
      message(Message.ClickedBlock()),
      message(Message.ClickedConfirmBlock({ blocked: true })),
      Command.resolve(
        SetBlocked({ handle: 'nika.kovac', blocked: true }),
        Message.SucceededSetRelation({ relation: relation({ blocked: true }) }),
      ),
      model(({ standing, confirmingBlock, work }) => {
        expect(standing).toEqual(Standing.Known({ relation: relation({ blocked: true }) }))
        expect(confirmingBlock).toBe(false)
        expect(Work.guards.Idle(work)).toBe(true)
      }),
    )
  })

  test('saves a piece, and says when it did not go through', () => {
    story(
      update,
      given(init(Subject.Piece({ pieceId }))),
      message(Message.ClickedSave({ saved: true })),
      Command.resolve(
        SetSaved({ subject: Subject.Piece({ pieceId }), saved: true }),
        Message.SucceededSetSaved({ saved: true }),
      ),
      model(({ saved }) => expect(saved).toBe(true)),
      message(Message.ClickedSave({ saved: false })),
      Command.resolve(SetSaved({ subject: Subject.Piece({ pieceId }), saved: false }), Message.FailedPeopleWork()),
      model(({ saved, work }) => {
        expect(saved).toBe(true)
        expect(Work.guards.Failed(work)).toBe(true)
      }),
    )
  })

  test('reports with a reason and words, and an hour of too many reports says so', () => {
    const subject = Subject.Person({ handle: 'nika.kovac' })
    story(
      update,
      given(known),
      message(Message.ClickedReport()),
      message(Message.SubmittedReport()),
      model(({ reporting }) =>
        expect(reporting).toEqual(Reporting.Open({ reason: Option.none(), note: '', problem: Option.none() })),
      ),
      message(Message.ChoseReportReason({ reason: 'spam' })),
      message(Message.UpdatedReportNote({ value: 'Selling followers' })),
      message(Message.SubmittedReport()),
      Command.resolve(
        SendReport({ subject, reason: 'spam', note: 'Selling followers' }),
        Message.FailedReport({ tooMany: true }),
      ),
      // The form stays with what was written, and says why it was not sent.
      model(({ reporting }) =>
        expect(reporting).toEqual(
          Reporting.Open({ reason: Option.some('spam'), note: 'Selling followers', problem: Option.some('tooMany') }),
        ),
      ),
      message(Message.ChoseReportReason({ reason: 'hate' })),
      message(Message.SubmittedReport()),
      Command.resolve(SendReport({ subject, reason: 'hate', note: 'Selling followers' }), Message.SucceededReport()),
      model(({ reporting }) => expect(Reporting.guards.Sent(reporting)).toBe(true)),
    )
  })
})
