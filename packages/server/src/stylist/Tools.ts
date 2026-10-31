import { LookId, PieceId, type ReplyPart } from '@styld/protocol'
import { type Context, Effect, Option, Predicate, Ref, Schema } from 'effect'
import { Tool, Toolkit } from 'effect/ai'
import type { JsonSchema } from 'effect/JsonSchema'
import type { Tool as AssistantTool } from '../mcp/Tools.ts'

/** The assistants' tools Styld uses: it reads the wardrobe and the saved looks, makes outfits, and saves a look when
 * asked. */
export const stylistToolNames: ReadonlyArray<string> = [
  'piece_search',
  'piece_get',
  'outfit_make',
  'look_list',
  'look_get',
  'look_create',
]

/** Tools that look something up: words a call writes beside them are the model thinking aloud ("I'll take a look"),
 * left out of the reply when it says anything else. */
export const lookingUpToolNames: ReadonlySet<string> = new Set([
  'piece_search',
  'piece_get',
  'outfit_make',
  'look_list',
  'look_get',
])

/** Tools that only show something under the reply: their answer tells the model nothing new, so a call that has
 * written its words and calls only these ends the reply, rather than asking the model again to restate it. */
export const showingToolNames: ReadonlySet<string> = new Set(['pieces_show'])

/** A tool's input schema as the model sees it: without `operationId`, which the turn chooses for each call so a
 * retried reply saves once. */
export const modelSchema = (schema: object): { readonly schema: JsonSchema; readonly operation: boolean } => {
  const whole: JsonSchema = { ...schema }
  if (!Predicate.hasProperty(schema, 'properties') || !Predicate.isObject(schema.properties)) {
    return { schema: whole, operation: false }
  }
  const { operationId, ...properties } = schema.properties
  if (operationId === undefined) return { schema: whole, operation: false }
  const required = Predicate.hasProperty(schema, 'required') && Array.isArray(schema.required) ? schema.required : []
  return {
    schema: { ...whole, properties, required: required.filter((name) => name !== 'operationId') },
    operation: true,
  }
}

const ShowPieces = Schema.Struct({
  pieceIds: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
})
const decodeShowPieces = Schema.decodeUnknownOption(ShowPieces)

const showPiecesSchema: JsonSchema = {
  type: 'object',
  properties: { pieceIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 } },
  required: ['pieceIds'],
  additionalProperties: false,
}

const SavedLook = Schema.Struct({ id: LookId, name: Schema.String })
const decodeSavedLook = Schema.decodeUnknownOption(SavedLook)

/** A refusal as the model reads it, to recover from on its own. */
const refusal = (error: { readonly code: string; readonly message: string; readonly recovery: string }) => ({
  error: { code: error.code, message: error.message, recovery: error.recovery },
})

/** One reply's tools: the assistants' own, run in `context` (the account and its pace), and `pieces_show`, which shows the person's own
 * pieces under the reply. What the reply shows and saves is collected in `parts`; a tool that writes gets the
 * operation id `<turnId>-<call>`. */
export const turnTools = <R>(
  tools: ReadonlyArray<AssistantTool<R>>,
  turn: { readonly turnId: string; readonly pieceIds: ReadonlySet<string> },
  context: Context.Context<R>,
) =>
  Effect.gen(function* () {
    const parts = yield* Ref.make<ReadonlyArray<ReplyPart>>([])
    const calls = yield* Ref.make(0)
    const add = (part: ReplyPart) => Ref.update(parts, (all) => [...all, part])
    const bridged = tools
      .filter(({ name }) => stylistToolNames.includes(name))
      .map((assistant) => {
        const { schema, operation } = modelSchema(assistant.inputSchema)
        const handler = (params: unknown) =>
          Effect.gen(function* () {
            const call = yield* Ref.getAndUpdate(calls, (count) => count + 1)
            const args =
              operation && Predicate.isObject(params) ? { ...params, operationId: `${turn.turnId}-${call}` } : params
            const result = yield* assistant.run(args).pipe(Effect.provide(context))
            const look = assistant.name === 'look_create' ? decodeSavedLook(result) : Option.none()
            if (Option.isSome(look)) yield* add({ _tag: 'Look', lookId: look.value.id, name: look.value.name })
            return result
          }).pipe(Effect.catchTag('ToolError', (error) => Effect.succeed<unknown>(refusal(error))))
        return {
          definition: Tool.dynamic(assistant.name, { description: assistant.description, parameters: schema }),
          handler,
        }
      })
    const show = {
      definition: Tool.dynamic('pieces_show', {
        description:
          'Show the person the pieces you suggest, as pictures under your reply: 1 to 8 piece ids from piece_search or piece_get, in the order to show them.',
        parameters: showPiecesSchema,
      }),
      handler: (params: unknown) =>
        Effect.gen(function* () {
          const decoded = decodeShowPieces(params)
          if (Option.isNone(decoded))
            return refusal({
              code: 'invalid_arguments',
              message: 'Give 1 to 8 piece ids.',
              recovery: 'Call pieces_show with pieceIds.',
            })
          const own = [...new Set(decoded.value.pieceIds)]
            .filter((id) => turn.pieceIds.has(id))
            .map((id) => PieceId.make(id))
          if (own.length > 0) yield* add({ _tag: 'Pieces', pieceIds: own })
          return { shown: own.length }
        }),
    }
    const all = [show, ...bridged]
    const toolkit = Toolkit.make(...all.map(({ definition }) => definition))
    const handlers = toolkit.toLayer(
      Object.fromEntries(all.map(({ definition, handler }) => [definition.name, handler])),
    )
    return { toolkit, handlers, parts: Ref.get(parts) }
  })
