import { PublicProfile } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { cameFromOf, init, load, Message, ShownData, Target, update } from '../src/page/Visit.ts'

const profile = (yours: boolean) =>
  Schema.decodeUnknownSync(PublicProfile)({
    handle: 'nika.kovac',
    name: 'Nika Kovač',
    city: null,
    bio: null,
    tone: 'clay',
    boards: [],
    looks: [],
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

describe('a piece’s page', () => {
  test('returns to the board or look it was opened from, read from a same-origin referrer', () => {
    const origin = 'https://styld.test'
    const board = `/boards/bd_${'coats'.padEnd(22, 'x')}`
    const look = `/looks/lk_${'rain'.padEnd(22, 'x')}`
    expect(cameFromOf(`${origin}${board}`, origin)).toEqual(Option.some(board))
    expect(cameFromOf(`${origin}${look}`, origin)).toEqual(Option.some(look))
    // Home's feed and Boards' Saved open pieces too.
    expect(cameFromOf(`${origin}/`, origin)).toEqual(Option.some('/'))
    expect(cameFromOf(`${origin}/boards`, origin)).toEqual(Option.some('/boards'))
    for (const referrer of [
      '',
      `${origin}/@nika.kovac`,
      `https://elsewhere.test${board}`,
      'not a url',
      `${origin}/wardrobe`,
    ])
      expect({ referrer, from: cameFromOf(referrer, origin) }).toEqual({ referrer, from: Option.none() })
    const piece = init(Target.Piece({ pieceId: 'pc_knit' }), false)
    expect(load(piece).map(({ name }) => name)).toEqual(['LoadPublicPiece', 'ReadCameFrom'])
    expect(update(piece, Message.SucceededReadCameFrom({ path: Option.some(board) })).model.cameFrom).toEqual(
      Option.some(board),
    )
  })
})

describe('a profile', () => {
  test('opens on Looks when only looks are public, and on Boards otherwise', () => {
    const look = {
      id: `lk_${'monday'.padEnd(22, 'x')}`,
      name: 'Monday',
      occasion: null,
      pieces: [],
      sharedAt: '2026-10-30T08:00:00.000Z',
      generated: false,
    }
    const onlyLooks = Schema.decodeUnknownSync(PublicProfile)({ ...profile(false), looks: [look] })
    const visiting = init(Target.Person({ handle: 'nika.kovac' }), false)
    expect(update(visiting, Message.SucceededLoadPerson({ profile: onlyLooks })).model.tab).toBe('looks')
    expect(update(visiting, Message.SucceededLoadPerson({ profile: profile(false) })).model.tab).toBe('boards')
  })
})

describe('reading a public page', () => {
  const person = init(Target.Person({ handle: 'nika.kovac' }), false)

  test('a profile that is not there for others is missing; one that did not load offers Try again, which reads it', () => {
    expect(update(person, Message.FailedLoadPerson({ error: 'NotFound' })).model.shown).toEqual(
      ShownData.Failure({ error: 'NotFound' }),
    )
    const failed = update(person, Message.FailedLoadPerson({ error: 'Unavailable' })).model
    expect(failed.shown).toEqual(ShownData.Failure({ error: 'Unavailable' }))
    const retried = update(failed, Message.ClickedRetry())
    expect(retried.model.shown).toEqual(ShownData.Loading())
    expect(retried.commands?.map(({ name }) => name)).toEqual(['LoadPerson'])
    // A read already on its way is not sent twice.
    expect(update(retried.model, Message.ClickedRetry()).commands ?? []).toEqual([])
  })
})
