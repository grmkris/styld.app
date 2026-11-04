import { Predicate } from 'effect'
import type { JsonSchema } from 'effect/JsonSchema'
import { lookCreate, lookGet, lookList } from '../mcp/LookTools.ts'
import { outfitMake } from '../mcp/OutfitTools.ts'
import { savedList } from '../mcp/SocialTools.ts'
import { noteAdd, noteList } from '../mcp/TasteTools.ts'
import { photoList, tryOnGet, tryOnList, tryOnStart } from '../mcp/TryOnTools.ts'
import { listed, type ToolAnnotations } from '../mcp/Tools.ts'
import { pieceGet, pieceSearch } from '../mcp/WardrobeTools.ts'

// The tools Styld's chat offers its model, as data: the Thread that writes replies lists them (`Thread.ts`), and the
// API Worker runs them (`Tools.ts`). Thirteen are the assistants' own, listed from the same specs MCP lists them from;
// two are the chat's: `pieces_show` and `wardrobe_analyze`.

/** How a tool call may be repeated after a reply was interrupted (Yielded's execution class): a read any number of
 * times, a write with its own operation id as often as needed, anything else never without proof. */
type Execution = 'readonly' | 'idempotent' | 'uncertain'

/** One tool the chat's model may call. `operation`: the tool takes an `operationId`, which the chat chooses for each
 * call (`Tools.ts`), so it is left out of what the model sees. */
export interface CatalogueEntry {
  readonly name: string
  readonly description: string
  readonly parameters: JsonSchema
  readonly execution: Execution
  readonly operation: boolean
}

/** A tool's input schema as the model sees it: without `operationId`, which the chat chooses for each call so a
 * reply that is written again saves once.
 * @internal Exported for its tests. */
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

/** A tool's execution class from its MCP hints: a read is readonly; a write that takes an operation id (or declares
 * itself idempotent and not destructive) is idempotent; anything else is uncertain. */
const executionOf = (annotations: ToolAnnotations, operation: boolean): Execution => {
  if (annotations.readOnlyHint) return 'readonly'
  if (operation || (annotations.idempotentHint === true && annotations.destructiveHint !== true)) return 'idempotent'
  return 'uncertain'
}

/** The most pieces one `pieces_show` shows. */
export const showLimit = 8

const piecesShow: CatalogueEntry = {
  name: 'pieces_show',
  description:
    'Show the person the pieces you suggest, as pictures under your reply: 1 to 8 piece ids from piece_search or piece_get, in the order to show them.',
  parameters: {
    type: 'object',
    properties: { pieceIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: showLimit } },
    required: ['pieceIds'],
    additionalProperties: false,
  },
  execution: 'readonly',
  operation: false,
}

const wardrobeAnalyze: CatalogueEntry = {
  name: 'wardrobe_analyze',
  description:
    'Count the whole wardrobe exactly: pieces by group, type and colour, what was worn lately and what never, and the areas with too much or too little. The person sees the counts as a card under your reply, so call it once when they ask about their wardrobe as a whole, then comment on what matters most instead of repeating the numbers.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  execution: 'readonly',
  operation: false,
}

/** The assistants' tools the chat uses: it reads the wardrobe and the saved looks, makes outfits, saves a look when
 * asked, and tries pieces on one of the person's own Gallery photos (owner, 4 November 2026). */
const assistants = [
  pieceSearch,
  pieceGet,
  outfitMake,
  lookList,
  lookGet,
  lookCreate,
  noteAdd,
  noteList,
  savedList,
  photoList,
  tryOnStart,
  tryOnGet,
  tryOnList,
].map((spec): CatalogueEntry => {
  const { name, description, inputSchema, annotations } = listed(spec)
  const { schema, operation } = modelSchema(inputSchema)
  return { name, description, parameters: schema, execution: executionOf(annotations, operation), operation }
})

/** Every tool the chat's model may call, in the order it is offered them. */
export const catalogue: ReadonlyArray<CatalogueEntry> = [piecesShow, wardrobeAnalyze, ...assistants]
