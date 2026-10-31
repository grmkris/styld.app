import { Tone } from '@styld/protocol'
import { Schema } from 'effect'
import { Command } from 'foldkit'
import { defineTaggedUnion } from 'foldkit/schema'
import { Message } from './Message.ts'
import { readProfile } from './page/ProfileRead.ts'

// You, as the masthead shows you: the profile's name and tone, read once the session is known and kept when the
// profile editor saves, so the bar, Account and the public page show one person.

/** Who the masthead shows: nobody read yet (signed out, or the profile has no name or could not be read, when the
 * sign-in name's initial stands in), the profile being read (a blank disc, so the initial never flashes first), or the
 * profile's name and tone. */
export const You = defineTaggedUnion({
  Unknown: {},
  Reading: {},
  Known: { name: Schema.String, tone: Tone },
})
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
export const youOf = (name: string, tone: Tone): You => (name.trim() === '' ? You.Unknown() : You.Known({ name, tone }))
