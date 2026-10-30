import {
  type HandleReserved,
  type HandleTaken,
  type Profile,
  type ProfileNeedsHandle,
  PublishProfile,
  UpdateProfile,
  type WardrobeUnavailable,
} from '@styld/protocol'
import { Effect, Match, Schema } from 'effect'
import type { Profiles } from '../social/Profiles.ts'
import { tool, ToolError } from './Tools.ts'

type ProfileFailure = HandleTaken | HandleReserved | ProfileNeedsHandle | WardrobeUnavailable

const refused = (code: string, message: string, recovery: string) =>
  new ToolError({ code, message, recovery, retryable: false })

/** Every profile refusal as a tool error the assistant can act on. */
const asToolError = (error: ProfileFailure): ToolError =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      HandleTaken: () => refused('handle_taken', 'Someone else has that handle.', 'Ask the person for another one.'),
      HandleReserved: () =>
        refused('handle_reserved', 'That handle is kept for Styld.', 'Ask the person for another one.'),
      ProfileNeedsHandle: () =>
        refused(
          'needs_handle',
          'A profile needs a handle before it can be published.',
          'Set one with profile_update first.',
        ),
      WardrobeUnavailable: () =>
        new ToolError({
          code: 'unavailable',
          message: 'Styld could not reach the profile just now.',
          recovery: 'Try again in a moment.',
          retryable: true,
        }),
    }),
  )

/** The profile as assistants see it, with its public page once it has a handle. */
const shown = (origin: string) => (profile: Profile) => ({
  ...profile,
  url: profile.handle === null ? null : `${origin}/@${profile.handle}`,
})

/** The person's profile in the assistants: thin projections of the same `Profiles` operations the website uses. */
export const profileTools = (profiles: Profiles['Service'], origin: string) => {
  const show = shown(origin)
  return [
    tool({
      name: 'profile_get',
      title: 'Your Styld profile',
      description:
        'The profile others see once it is published: handle, name, city, bio, avatar tone, whether the wardrobe shows on it, and its public link.',
      parameters: Schema.Struct({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: () => profiles.getProfile().pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
    tool({
      name: 'profile_update',
      title: 'Change the profile',
      description:
        'Change the handle (3–30 lowercase letters, digits, _ and single dots), name, city, bio (160 characters), avatar tone, or whether the wardrobe shows on the profile. Fields left out stay; null clears the city or bio. Change only what the person asked for.',
      parameters: UpdateProfile,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: (input) => profiles.updateProfile(input).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
    tool({
      name: 'profile_publish',
      title: 'Publish the profile',
      description:
        'Publish the profile at its link, or take it down. Publishing needs a handle. Only when the person asks: a published profile shows their public boards, shared looks and, if they chose, their wardrobe.',
      parameters: PublishProfile,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: (input) => profiles.publishProfile(input).pipe(Effect.map(show), Effect.mapError(asToolError)),
    }),
  ]
}
