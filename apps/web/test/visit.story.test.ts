import { PublicProfile } from '@styld/protocol'
import { Schema } from 'effect'
import { expect, test } from 'vitest'
import { init, Message, Target, update } from '../src/page/Visit.ts'

const profile = (yours: boolean) =>
  Schema.decodeUnknownSync(PublicProfile)({
    handle: 'nika.kovac',
    name: 'Nika Kovač',
    city: null,
    bio: null,
    tone: 'clay',
    boards: [],
    looks: [],
    pieces: null,
    yours,
  })

/** The Commands the person page sends once the profile is in. */
const loaded = (signedIn: boolean, yours: boolean) =>
  (
    update(
      init(Target.Person({ handle: 'nika.kovac' }), signedIn),
      Message.SucceededLoadPerson({ profile: profile(yours) }),
    ).commands ?? []
  ).map((command) => command.name)

test("reads where the visitor stands with a person only when signed in on someone else's profile", () => {
  expect(loaded(false, false)).toEqual([])
  expect(loaded(true, true)).toEqual([])
  expect(loaded(true, false)).toEqual(['LoadRelation'])
})
