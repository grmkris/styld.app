import { AddStyleNote, mostStyleNotes, Operation, SetOccasions, StyleNoteId } from '@styld/protocol'
import { Effect, Schema } from 'effect'
import type { Tastes } from '../taste/Taste.ts'
import { tool, toolSpec } from './Tools.ts'

// What Styld knows about how the person dresses (owner, 4 November 2026): the same reads and writes as the website's
// Account › What Styld knows about you. A note is written only after the person said yes to Styld keeping it.

const tasteGet = toolSpec({
  name: 'taste_get',
  title: 'What Styld knows about you',
  description:
    'What the person told Styld about how they dress (what to show first, the occasions they dress for, the notes they asked it to remember) and what Styld learned from what they saved and wore. Private to the person.',
  parameters: Schema.Struct({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
})

export const noteAdd = toolSpec({
  name: 'note_add',
  title: 'Remember something',
  description: `Remember one lasting thing about how the person dresses, in their words and in a short line (such as "Never heels; flats or trainers"). Only after you asked whether to remember it and they said yes. Never anything about their body, health or other people. At most ${String(mostStyleNotes)} notes are kept. Choose a new \`operationId\` for each note.`,
  parameters: AddStyleNote,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
})

export const noteList = toolSpec({
  name: 'note_list',
  title: 'What Styld remembers',
  description: 'The notes the person asked Styld to remember, oldest first, each with its id.',
  parameters: Schema.Struct({}),
  annotations: { readOnlyHint: true, openWorldHint: false },
})

/** What Styld knows about the person, for the assistants. */
export const tasteTools = (tastes: Tastes['Service']) => [
  tool({ ...tasteGet, handler: () => tastes.getTaste() }),
  tool({ ...noteAdd, handler: (input) => tastes.addStyleNote(input) }),
  tool({
    ...noteList,
    handler: () => tastes.getTaste().pipe(Effect.map(({ notes }) => ({ notes }))),
  }),
  tool({
    name: 'note_delete',
    title: 'Forget a note',
    description: 'Forget one note Styld remembers, by its id from note_list. Choose a new `operationId`.',
    parameters: Schema.Struct({ noteId: StyleNoteId, ...Operation.fields }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: ({ noteId, operationId }) =>
      tastes.deleteStyleNote(noteId, operationId).pipe(Effect.as({ deleted: true, noteId })),
  }),
  tool({
    name: 'occasions_set',
    title: 'Occasions you dress for',
    description:
      'Set the occasions the person dresses for (casual, smart, formal, sport, lounge), replacing the ones set before. Only when the person asks. Choose a new `operationId`.',
    parameters: SetOccasions,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: (input) => tastes.setOccasions(input),
  }),
]
