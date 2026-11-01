import { Profile } from '@styld/protocol'
import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { init, Message, update } from '../src/page/Account.ts'
import { ProfileData } from '../src/page/ProfileRead.ts'

const nika = Schema.decodeUnknownSync(Profile)({
  handle: 'nika.kovac',
  name: 'Nika',
  city: null,
  bio: null,
  tone: 'sand',
  published: true,
  check: null,
})

describe('the account’s profile line', () => {
  test('a read that fails keeps the profile already shown; Try again reads it again', () => {
    const shown = update(init(), Message.SucceededReadProfile({ profile: nika })).model
    const failed = update(shown, Message.FailedReadProfile()).model
    expect(failed.profile).toEqual(ProfileData.Stale({ error: 'Unavailable', data: nika }))
    const retried = update(failed, Message.ClickedRetryProfile())
    expect(retried.model.profile).toEqual(ProfileData.Refreshing({ data: nika }))
    expect(retried.commands?.map(({ name }) => name)).toEqual(['ReadProfile'])
  })

  test('a first read that fails says so', () => {
    expect(update(init(), Message.FailedReadProfile()).model.profile).toEqual(
      ProfileData.Failure({ error: 'Unavailable' }),
    )
  })
})
