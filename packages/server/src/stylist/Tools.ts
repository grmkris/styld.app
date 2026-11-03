import { PieceId, type WardrobeAnalysis } from '@styld/protocol'
import { Effect, Option, Predicate, Schema } from 'effect'
import { digestOf } from '../kernel/Ids.ts'
import type { Tool as AssistantTool } from '../mcp/Tools.ts'
import { catalogue, showLimit } from './Catalogue.ts'

// The chat's tools as the API Worker runs them, one call at a time, when a reply's Thread asks (`Thread.ts`): the
// assistants' own for the chat's account, `pieces_show`, which shows the person's own pieces, and `wardrobe_analyze`,
// which counts the wardrobe. What a call shows under the reply is in its result, which the Thread records; the chat's
// cards are read back from there (`History.ts`).

/** A refusal as the model reads it, to recover from on its own. */
const refusal = (error: { readonly code: string; readonly message: string; readonly recovery: string }) => ({
  error: { code: error.code, message: error.message, recovery: error.recovery },
})

const ShowPieces = Schema.Struct({
  pieceIds: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(showLimit)),
})
const decodeShowPieces = Schema.decodeUnknownOption(ShowPieces)

/** The operation id of a write the model asked for: the same call in the same reply (repeated after an interruption)
 * is the same write. Yielded records each call's parameters before it runs, so a repeated call has the same ones.
 * @internal Exported for its tests. */
export const operationOf = (submissionId: string, name: string, params: unknown) =>
  Effect.map(digestOf(`${submissionId}:${name}:${JSON.stringify(params)}`), (digest) => `sq_${digest.slice(0, 40)}`)

/** What one call needs of the account: its assistants' tools, its pieces and its wardrobe counted. */
export interface ToolAccount {
  readonly tools: ReadonlyArray<AssistantTool<never>>
  readonly pieceIds: Effect.Effect<ReadonlySet<string>, unknown>
  /** The wardrobe's analysis, the card the person sees, with the most worn pieces' names beside their ids for the
   * model. */
  readonly analyze: Effect.Effect<
    { readonly analysis: WardrobeAnalysis; readonly names: ReadonlyMap<string, string> },
    unknown
  >
}

/** `pieces_show`: the person's own pieces among those asked for, each once; `shown` is what the card shows. */
const showPieces = (account: ToolAccount, params: unknown) =>
  Effect.gen(function* () {
    const decoded = decodeShowPieces(params)
    if (Option.isNone(decoded))
      return refusal({
        code: 'invalid_arguments',
        message: 'Give 1 to 8 piece ids.',
        recovery: 'Call pieces_show with pieceIds.',
      })
    const own = yield* account.pieceIds
    const shown = [...new Set(decoded.value.pieceIds)].filter((id) => own.has(id)).map((id) => PieceId.make(id))
    return { shown }
  })

/** `wardrobe_analyze`: the counts, which the card shows, with the most worn pieces' names for the model to say. */
const analyzeWardrobe = (account: ToolAccount) =>
  account.analyze.pipe(
    Effect.map(({ analysis, names }) => ({
      ...analysis,
      worn: {
        ...analysis.worn,
        most: analysis.worn.most.map((worn) => ({ ...worn, piece: names.get(worn.pieceId) ?? '' })),
      },
    })),
  )

/** An assistant's tool, with the write's operation id when it takes one. */
const assistantCall = (
  tool: AssistantTool<never>,
  operation: boolean,
  request: { readonly submissionId: string; readonly params: unknown },
) =>
  Effect.gen(function* () {
    const args =
      operation && Predicate.isObject(request.params)
        ? { ...request.params, operationId: yield* operationOf(request.submissionId, tool.name, request.params) }
        : request.params
    return yield* tool.run(args)
  }).pipe(Effect.catchTag('ToolError', (error) => Effect.succeed<unknown>(refusal(error))))

/** Run one of the chat's tools for the account. A tool that cannot run now is a refusal the model answers around;
 * a name the chat does not offer is refused. */
export const runTool = (
  account: ToolAccount,
  request: { readonly submissionId: string; readonly name: string; readonly params: unknown },
): Effect.Effect<unknown> => {
  const unavailable = refusal({
    code: 'unavailable',
    message: 'Styld could not do that just now.',
    recovery: 'Answer from what you already know.',
  })
  if (request.name === 'pieces_show')
    return showPieces(account, request.params).pipe(Effect.orElseSucceed(() => unavailable))
  if (request.name === 'wardrobe_analyze')
    return analyzeWardrobe(account).pipe(
      Effect.orElseSucceed(() =>
        refusal({
          code: 'unavailable',
          message: 'The wardrobe could not be counted just now.',
          recovery: 'Answer from the outline you were given.',
        }),
      ),
    )
  const entry = catalogue.find(({ name }) => name === request.name)
  const tool = account.tools.find(({ name }) => name === request.name)
  if (entry === undefined || tool === undefined)
    return Effect.succeed(
      refusal({ code: 'unknown_tool', message: 'There is no such tool.', recovery: 'Call one of the tools offered.' }),
    )
  return assistantCall(tool, entry.operation, request)
}
