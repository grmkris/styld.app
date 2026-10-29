import type { CallToolResult } from '@modelcontextprotocol/server'
import { Effect, Predicate, Schema, SchemaAST, SchemaIssue } from 'effect'

/** A refusal an assistant can act on: what went wrong and what to do next (the owner's myapps shape). */
export class ToolError extends Schema.TaggedError<ToolError>()('ToolError', {
  code: Schema.String,
  message: Schema.String,
  recovery: Schema.String,
  retryable: Schema.Boolean,
}) {}

export type ToolAnnotations = {
  readonly readOnlyHint: boolean
  readonly destructiveHint?: boolean
  readonly idempotentHint?: boolean
  readonly openWorldHint: boolean
}

/** One MCP tool: a thin projection of an application operation. Its input schema and its decoder come
 * from the same `parameters`, so both refuse the same unknown keys. */
export interface Tool<R> {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: object
  readonly annotations: ToolAnnotations
  readonly run: (args: unknown) => Effect.Effect<unknown, ToolError, R>
}

/** A tool without arguments. Effect reads `Schema.Struct({})` as any non-null value, so it renders
 * and decodes as a closed empty object instead. */
const takesNoArguments = (parameters: Schema.Top) =>
  SchemaAST.isObjects(parameters.ast) &&
  parameters.ast.propertySignatures.length === 0 &&
  parameters.ast.indexSignatures.length === 0

/** The input schema: every object closed (`additionalProperties: false`), as OpenAI requires. */
const inputSchema = (parameters: Schema.Top): object => {
  if (takesNoArguments(parameters)) return { type: 'object', properties: {}, additionalProperties: false }
  const document = Schema.toJsonSchemaDocument(parameters, { onExcessProperty: 'error' })
  return Object.keys(document.definitions).length > 0
    ? { ...document.schema, $defs: document.definitions }
    : document.schema
}

const invalidArguments = (message: string) =>
  new ToolError({
    code: 'invalid_arguments',
    message,
    recovery: 'Fix the named arguments and call the tool again.',
    retryable: false,
  })

const formatter = SchemaIssue.makeFormatterStandardSchemaV1()

const segment = (part: PropertyKey | { readonly key: PropertyKey }) =>
  String(Predicate.isObject(part) ? part.key : part)

/** Name each bad argument by path. Messages never repeat the argument's value. */
const describeIssue = (issue: SchemaIssue.Issue) =>
  formatter(issue)
    .issues.map(
      ({ path, message }) =>
        `${path === undefined || path.length === 0 ? 'arguments' : path.map(segment).join('.')}: ${message}`,
    )
    .slice(0, 12)
    .join('\n')

/** Declare a tool. The handler receives decoded input; refusals name the bad argument, never its value. */
export const tool = <A, R>(definition: {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly parameters: Schema.Codec<A, unknown>
  readonly annotations: ToolAnnotations
  readonly handler: (input: A) => Effect.Effect<unknown, ToolError, R>
}): Tool<R> => {
  const { parameters, handler, ...rest } = definition
  const decode = (args: unknown): Effect.Effect<A, ToolError> => {
    if (!takesNoArguments(parameters))
      return Schema.decodeUnknownEffect(parameters)(args, { onExcessProperty: 'error', errors: 'all' }).pipe(
        Effect.mapError((error) => invalidArguments(describeIssue(error.issue))),
      )
    if (!Predicate.isObject(args) || Array.isArray(args))
      return Effect.fail(invalidArguments('arguments: Expected an object.'))
    const keys = Object.keys(args)
    if (keys.length > 0)
      return Effect.fail(invalidArguments(keys.map((key) => `${key}: Unknown argument. Remove it.`).join('\n')))
    return Schema.decodeUnknownEffect(parameters)({}).pipe(
      Effect.mapError(() => invalidArguments('arguments: Invalid.')),
    )
  }
  return { ...rest, inputSchema: inputSchema(parameters), run: (args) => Effect.flatMap(decode(args), handler) }
}

/** The `tools/list` entries, in declaration order. */
export const renderTools = <R>(tools: ReadonlyArray<Tool<R>>) =>
  tools.map((entry) => ({
    name: entry.name,
    title: entry.title,
    description: entry.description,
    inputSchema: entry.inputSchema,
    annotations: { title: entry.title, ...entry.annotations },
  }))

const json = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]

/** A success: the same JSON as text and, for objects, as structured content. */
export const textAndStructured = (value: unknown): CallToolResult =>
  Predicate.isObject(value) && !Array.isArray(value)
    ? { content: json(value), structuredContent: { ...value } }
    : { content: json(value) }

const errorResult = (error: ToolError): CallToolResult => ({
  isError: true,
  content: json({ code: error.code, message: error.message, recovery: error.recovery, retryable: error.retryable }),
})

/** Run one `tools/call` and turn every refusal into a result the assistant reads. Defects stay
 * defects; the SDK reports them as internal errors. */
export const callTool = Effect.fnUntraced(function* <R>(tools: ReadonlyArray<Tool<R>>, name: string, args: unknown) {
  const entry = tools.find((candidate) => candidate.name === name)
  if (entry === undefined)
    return errorResult(
      new ToolError({
        code: 'unknown_tool',
        message: `There is no tool named ${name}.`,
        recovery: 'List the tools again and call one of them.',
        retryable: false,
      }),
    )
  return yield* entry.run(args).pipe(
    Effect.map(textAndStructured),
    Effect.catchTag('ToolError', (error) => Effect.succeed(errorResult(error))),
    Effect.withSpan('Styld.Mcp.tool', { attributes: { 'styld.mcp.tool': name } }),
  )
})
