import { Profile } from '@styld/protocol'
import { Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'
import {
  init,
  Load,
  Message,
  PublishProfile,
  Publishing,
  SaveProfile,
  Saving,
  update,
} from '../src/page/ProfileEditor.ts'

const unnamed = Schema.decodeUnknownSync(Profile)({
  handle: null,
  name: 'Nika',
  city: null,
  bio: null,
  tone: 'sand',
  published: false,
  wardrobeShown: true,
  check: null,
})
const nika = Schema.decodeUnknownSync(Profile)({ ...unnamed, handle: 'nika.kovac', city: 'Maribor' })

describe('the profile editor', () => {
  test('opens on the profile, saves what was typed, and shows a handle someone else has', () => {
    story(
      update,
      given(init()),
      message(Message.SucceededLoadProfile({ profile: unnamed })),
      model(({ draft }) => expect(draft).toMatchObject({ handle: '', name: 'Nika', tone: 'sand' })),
      message(Message.UpdatedField({ field: 'handle', value: 'nika.kovac' })),
      message(Message.UpdatedField({ field: 'city', value: 'Maribor' })),
      message(Message.ChoseTone({ tone: 'clay' })),
      message(Message.SubmittedProfile()),
      Command.expectExact(SaveProfile),
      Command.resolve(SaveProfile, Message.FailedSaveProfile({ problem: 'taken' })),
      model(({ saving }) => expect(saving).toEqual(Saving.Failed({ problem: 'taken' }))),
      message(Message.SubmittedProfile()),
      Command.resolve(SaveProfile, Message.SucceededSaveProfile({ profile: nika })),
      model(({ saving, load }) => {
        expect(Saving.guards.Saved(saving)).toBe(true)
        expect(load).toEqual(Load.Ready({ profile: nika }))
      }),
    )
  })

  test('publishing without a handle says a handle comes first', () => {
    story(
      update,
      given(init()),
      message(Message.SucceededLoadProfile({ profile: unnamed })),
      message(Message.ClickedPublish({ published: true })),
      Command.expectExact(PublishProfile),
      Command.resolve(PublishProfile, Message.FailedPublishProfile({ needsHandle: true })),
      model(({ publishing }) => expect(publishing).toEqual(Publishing.Failed({ needsHandle: true }))),
    )
  })
})
