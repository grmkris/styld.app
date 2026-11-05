import { type Profile, PublishProfile, UpdateProfile } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import type { Profiles } from '../social/Profiles.ts'
import { tool } from './Tools.ts'

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
        'The profile others see once it is published: handle, name, city, bio, avatar tone, and its public link.',
      parameters: Schema.Struct({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: () => profiles.getProfile().pipe(Effect.map(show)),
    }),
    tool({
      name: 'profile_update',
      title: 'Change the profile',
      description:
        'Change the handle (3–30 lowercase letters, digits, _ and single dots), name, city, bio (160 characters) or avatar tone. Fields left out stay; null clears the city or bio. Change only what the person asked for.',
      parameters: UpdateProfile,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: (input) => profiles.updateProfile(input).pipe(Effect.map(show)),
    }),
    tool({
      name: 'profile_publish',
      title: 'Publish the profile',
      description:
        'Publish the profile at its link, or take it down. Publishing needs a handle. Only when the person asks: a published profile shows their public boards and shared looks, never the whole wardrobe.',
      parameters: PublishProfile,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: (input) => profiles.publishProfile(input).pipe(Effect.map(show)),
    }),
  ]
}
