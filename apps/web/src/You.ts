import { Tone } from '@styld/protocol'
import { Option, Schema } from 'effect'
import { Command } from 'foldkit'
import { Message } from './Message.ts'
import { readProfile } from './page/ProfileRead.ts'

// You, as the masthead shows you: the profile's name and tone, read once the session is known and kept when the
// profile editor saves, so the bar, Account and the public page show one person.

/** Who the masthead shows once the profile is read; until then (or with no name) the sign-in name's initial. */
export const You = Schema.Struct({ name: Schema.String, tone: Tone })
export type You = typeof You.Type

/** @internal Exported for its tests. The person's profile once signed in, for the masthead. */
export const ReadYou = Command.define('ReadYou', {
  messages: [Message.SucceededReadYou, Message.FailedReadYou],
  execute: readProfile(
    ({ name, tone }) => Message.SucceededReadYou({ name, tone }),
    () => Message.FailedReadYou(),
  ),
})

/** A profile with a name shows as it; one without, as the sign-in name. */
export const youOf = (name: string, tone: Tone): Option.Option<You> =>
  name.trim() === '' ? Option.none() : Option.some({ name, tone })
