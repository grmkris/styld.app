import { SessionHttp } from '@styld/auth/config'
import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Audience } from './BoardTags.ts'
import { LimitReached, NotFound, OperationConflict, Unavailable } from './Errors.ts'
import { Occasions, PieceType } from './Garment.ts'
import { entityId, Operation, OperationId } from './Ids.ts'
import { SessionAccount } from './Session.ts'
import { textLength, trimmedText } from './Text.ts'
import { Colour } from './Wardrobe.ts'

// What Styld knows about how a person dresses (owner, 4 November 2026: "Styld learns the person"): what they told it
// (the occasions they dress for, the notes they asked Styld to remember) and what it worked out from what they save
// and wear. Private, shown back in full on the Account page, and every told thing removable. Never the person's body,
// health or gender: Show me orders boards, it says nothing about who the person is.

/** The most notes Styld keeps for one person. */
export const mostStyleNotes = 30

export const StyleNoteId = entityId('sn').pipe(Schema.brand('StyleNoteId'))
export type StyleNoteId = typeof StyleNoteId.Type

/** A note's words: the person's own, at most a label long. */
export const StyleNoteText = trimmedText(textLength.label)

/** Something the person asked Styld to remember, such as "Never heels; flats or trainers". */
export const StyleNote = Schema.Struct({ id: StyleNoteId, text: StyleNoteText, createdAt: Schema.String })
export type StyleNote = typeof StyleNote.Type

/** What Styld worked out from what the person saved and wore, strongest first: the aesthetics of the boards they saved,
 * the colours and the kinds of piece they wear most. Read on demand, never stored. */
export const Learned = Schema.Struct({
  aesthetics: Schema.Array(Schema.String),
  colours: Schema.Array(Colour),
  wornTypes: Schema.Array(PieceType),
})
export type Learned = typeof Learned.Type

/** Everything Styld knows about how the person dresses: what they chose to see first (Show me, `null` for nothing
 * chosen), the occasions they dress for, whether the first run is behind them, their notes, and what was learned. */
export const Taste = Schema.Struct({
  showMe: Schema.NullOr(Audience),
  occasions: Occasions,
  firstRunDone: Schema.Boolean,
  notes: Schema.Array(StyleNote),
  learned: Learned,
})
export type Taste = typeof Taste.Type

/** Set the occasions the person dresses for: `PUT /api/me/taste/occasions`. */
export const SetOccasions = Schema.Struct({ operationId: OperationId, occasions: Occasions })
export type SetOccasions = typeof SetOccasions.Type

/** Remember one thing the person said yes to keeping: `POST /api/me/taste/notes`. */
export const AddStyleNote = Schema.Struct({ operationId: OperationId, text: StyleNoteText })
export type AddStyleNote = typeof AddStyleNote.Type

/** What Styld knows about the person, and the person's changes to it. */
export class TasteApi extends HttpApiGroup.make('taste')
  .add(HttpApiEndpoint.get('getTaste', '/me/taste', { success: Taste, error: Unavailable }))
  .add(
    HttpApiEndpoint.put('setOccasions', '/me/taste/occasions', {
      payload: SetOccasions,
      success: Taste,
      error: [OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.post('addStyleNote', '/me/taste/notes', {
      payload: AddStyleNote,
      success: StyleNote,
      error: [LimitReached, OperationConflict, Unavailable],
    }),
  )
  .add(
    HttpApiEndpoint.delete('deleteStyleNote', '/me/taste/notes/:noteId', {
      params: { noteId: StyleNoteId },
      payload: Operation,
      success: HttpApiSchema.NoContent,
      error: [NotFound, OperationConflict, Unavailable],
    }),
  )
  .add(
    /** The first run finished or put away. */
    HttpApiEndpoint.put('finishFirstRun', '/me/taste/first-run', {
      payload: Operation,
      success: Taste,
      error: [OperationConflict, Unavailable],
    }),
  )
  .middleware(SessionAccount)
  .middleware(SessionHttp.RequireSession) {}
