import { CheckState, Handle, type WardrobeUnavailable } from '@styld/protocol'
import { Effect, Option, Schema } from 'effect'
import type { Curation } from '../social/Curation.ts'
import { tool, ToolError } from './Tools.ts'

const unavailable = (_: WardrobeUnavailable): ToolError =>
  new ToolError({
    code: 'unavailable',
    message: 'Styld could not reach that just now.',
    recovery: 'Try again in a moment.',
    retryable: true,
  })
const notFound = new ToolError({
  code: 'not_found',
  message: 'There is nothing with that id or handle.',
  recovery: 'Check it with report_list, check_list or the public page.',
  retryable: false,
})

const Target = Schema.Struct({
  kind: Schema.Literals(['profile', 'board', 'look', 'piece']),
  /** A handle for a profile; an id for anything else. */
  id: Schema.String.check(Schema.isMaxLength(60)),
})

const done = (changed: boolean) => (changed ? Effect.succeed({ done: true }) : Effect.fail(notFound))

/** Reading what was reported and how checks stand. */
const readingTools = (curation: Curation['Service']) => [
  tool({
    name: 'report_list',
    title: 'Reports',
    description: 'Reported things, the most recently reported first, with how many people reported each and why.',
    parameters: Schema.Struct({}),
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: () =>
      curation.reports().pipe(
        Effect.map((reports) => ({ reports })),
        Effect.mapError(unavailable),
      ),
  }),
  tool({
    name: 'check_list',
    title: 'Checks',
    description: 'Styld’s checks in one state (pending, passed, unsure or failed), the most recently asked first.',
    parameters: Schema.Struct({ state: CheckState }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: ({ state }) =>
      curation.checks(state).pipe(
        Effect.map((checks) => ({ checks })),
        Effect.mapError(unavailable),
      ),
  }),
]

/** Curation for Styld's admins: listed only to accounts on the admin list, refused as unknown to everyone else. */
export const curationTools = (curation: Curation['Service']) => [...changingTools(curation), ...readingTools(curation)]

const changingTools = (curation: Curation['Service']) => {
  const resolved = (target: typeof Target.Type) =>
    Effect.flatMap(curation.targetOf(target.kind, target.id).pipe(Effect.mapError(unavailable)), (found) =>
      Option.match(found, { onNone: () => Effect.fail(notFound), onSome: Effect.succeed }),
    )
  return [
    tool({
      name: 'curation_feature',
      title: 'Feature in Explore',
      description: 'Feature a public board (by its id) or a person (by their handle) in Explore, or stop featuring it.',
      parameters: Schema.Struct({
        kind: Schema.Literals(['board', 'profile']),
        id: Target.fields.id,
        featured: Schema.Boolean,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: ({ kind, id, featured }) =>
        (kind === 'board' ? curation.featureBoard(id, featured) : curation.featureProfile(id, featured)).pipe(
          Effect.mapError(unavailable),
          Effect.flatMap(done),
        ),
    }),
    tool({
      name: 'curation_house',
      title: 'Mark the house account',
      description:
        'Mark a profile (by its handle) as Styld’s own, whose public boards are Edits from Styld, or unmark it. It may take the reserved handle styld.',
      parameters: Schema.Struct({ handle: Handle, house: Schema.Boolean, newHandle: Schema.optionalKey(Handle) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: ({ handle, house, newHandle }) =>
        curation
          .markHouse(handle, house, Option.fromNullishOr(newHandle))
          .pipe(Effect.mapError(unavailable), Effect.flatMap(done)),
    }),
    tool({
      name: 'curation_hide',
      title: 'Hide or restore',
      description:
        'Hide a profile, board, look or piece from everyone but its owner, whatever its check said; or restore it to what its check says.',
      parameters: Schema.Struct({ ...Target.fields, hidden: Schema.Boolean }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      handler: ({ kind, id, hidden }) =>
        Effect.flatMap(resolved({ kind, id }), (target) =>
          curation.hide(target, hidden).pipe(Effect.mapError(unavailable), Effect.flatMap(done)),
        ),
    }),
    tool({
      name: 'check_rerun',
      title: 'Check again',
      description:
        'Put a profile, board, look or piece in front of the model again; its verdict stands until the new one.',
      parameters: Target,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      handler: (target) =>
        Effect.flatMap(resolved(target), (found) =>
          curation.rerun(found).pipe(Effect.as({ done: true }), Effect.mapError(unavailable)),
        ),
    }),
  ]
}
