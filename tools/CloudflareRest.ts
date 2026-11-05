import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { Effect, Option, Schema } from 'effect'
import type { RunClef } from '../packages/server/src/providers/ClefCall.ts'

// What the operator scripts that re-sort stored pieces (`once/retype-pieces.ts`, `once/retype.ts`) and the house seed reach through the
// Cloudflare REST API: a stage's D1 database by name, its R2 media bucket (in the EU jurisdiction) and Workers AI's
// Clef-flash, so their answers are the ones the Worker gets. The token is sent only as the Authorization header and
// never printed; a refusal names Cloudflare's own reasons.

const Failure = Schema.Struct({ errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))) })
const Databases = Schema.Struct({ result: Schema.Array(Schema.Struct({ name: Schema.String, uuid: Schema.String })) })
const Rows = Schema.Struct({ result: Schema.Array(Schema.Struct({ results: Schema.Array(Schema.Unknown) })) })
const Ran = Schema.Struct({ result: Schema.Unknown })

export interface Stage {
  readonly token: string
  readonly cloudflareAccount: string
  readonly database: string
  readonly bucket: string
}

/** Never runs a statement itself: the scripts send what it builds through `query`. */
const refused = () => Promise.reject(new Error('Built here, sent by the stage: run it with query()'))

/** The statements the scripts send to D1, built with Drizzle over Styld's own tables, so their columns, encoders and
 * parameters are the Worker's. */
export const statements = drizzle({ get: refused, all: refused, run: refused })

/** A statement Drizzle built, as `toSQL()` gives it. */
interface Statement {
  readonly toSQL: () => { readonly sql: string; readonly params: ReadonlyArray<unknown> }
}

const posted = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** The stage's database, bucket and decision model, once its database is found by name. */
export const cloudflareStage = async ({ token, cloudflareAccount, database, bucket }: Stage) => {
  const api = `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccount}`
  const cloudflare = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${api}${path}`, { ...init, headers })
    if (response.ok) return response
    const failure = Schema.decodeUnknownOption(Failure)(await response.json().catch(() => ({})))
    const reasons = Option.match(failure, {
      onNone: () => '',
      onSome: ({ errors = [] }) => errors.map(({ message }) => message).join('; '),
    })
    throw new Error(`Cloudflare answered ${response.status} for ${path.split('?')[0]}: ${reasons}`)
  }
  /** A Cloudflare API answer's body, not yet decoded. */
  const answer = async (path: string, init?: RequestInit): Promise<unknown> => (await cloudflare(path, init)).json()

  const { result: databases } = await Schema.decodeUnknownPromise(Databases)(
    await answer(`/d1/database?name=${encodeURIComponent(database)}`),
  )
  const found = databases.find(({ name }) => name === database)
  if (found === undefined) throw new Error(`No D1 database named ${database}`)

  return {
    /** One statement's rows, keyed by column name. */
    query: async (statement: Statement) => {
      const { result } = await Schema.decodeUnknownPromise(Rows)(
        await answer(`/d1/database/${found.uuid}/query`, posted(statement.toSQL())),
      )
      return result[0]?.results ?? []
    },
    /** An object's bytes from the media bucket. */
    object: async (key: string) =>
      new Uint8Array(
        await (
          await cloudflare(`/r2/buckets/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`, {
            headers: { 'cf-r2-jurisdiction': 'eu' },
          })
        ).arrayBuffer(),
      ),
    runClef: (async ({ model, ...body }) =>
      (await Schema.decodeUnknownPromise(Ran)(await answer(`/ai/run/@cf/cloudflare/${model}`, posted(body))))
        .result) satisfies RunClef,
  }
}

/** The command-line options every stage script shares: the stage's D1 database and R2 bucket, one account to work on,
 * where the private report goes, and whether to write. */
export const stageOptions = {
  database: { type: 'string' },
  bucket: { type: 'string' },
  account: { type: 'string' },
  out: { type: 'string' },
  apply: { type: 'boolean', default: false },
} as const

/** Each stored piece read by `readOf`, six at a time; a piece that is not read is named and left as it is. */
export const readEach = async <Piece extends { readonly id: string }, Read>(
  pieces: ReadonlyArray<Piece>,
  readOf: (piece: Piece) => Effect.Effect<Option.Option<Read>, unknown>,
): Promise<ReadonlyArray<Read>> =>
  (
    await Effect.runPromise(
      Effect.forEach(
        pieces,
        (piece) =>
          readOf(piece).pipe(
            Effect.orElseSucceed(() => {
              console.error(`${piece.id}: not read; left as it is`)
              return Option.none<Read>()
            }),
          ),
        { concurrency: 6 },
      ),
    )
  ).flatMap((read) => Option.toArray(read))
