import * as Cloudflare from '@alchemy.run/cloudflare'
import type { RuntimeContext } from 'alchemy/RuntimeContext'
import { Effect } from 'effect'

// One account's chats with Styld, the stylist in the app (owner, 2026-10-31), in a SQLite-backed Durable Object named
// by the account id: the only writer of its chats, messages and replies, so a reply begins, progresses and ends in
// order, and one at a time.

/** A stored message: parts are the reply's `ReplyPart`s as JSON, decoded by the service. */
export interface StoredMessage {
  readonly id: string
  readonly role: 'person' | 'styld'
  readonly text: string
  readonly parts: string
  readonly at: number
}

/** How a message to Styld began: a new reply, the same one again (the request was repeated), refused while another
 * reply is being written, or for a chat that is not there. */
type Begun =
  | { readonly outcome: 'started'; readonly chatId: string }
  | { readonly outcome: 'replayed'; readonly chatId: string }
  | { readonly outcome: 'busy' }
  | { readonly outcome: 'missing' }

/** A reply as the queue reads it: its chat so far and the language to answer in. */
type TurnInput =
  | { readonly found: false }
  | {
      readonly found: true
      readonly state: 'writing' | 'done' | 'failed'
      readonly locale: string
      readonly messages: ReadonlyArray<StoredMessage>
    }

interface StoredChat {
  readonly id: string
  readonly title: string
  readonly messages: ReadonlyArray<StoredMessage>
  /** The reply to its last message while it is written, with what it says so far, or that it did not come. */
  readonly replying?: { readonly state: 'writing' | 'failed'; readonly text: string; readonly parts: string }
}

interface BeginInput {
  readonly turnId: string
  readonly chatId: string
  readonly newChat: boolean
  readonly text: string
  readonly title: string
  readonly locale: string
  readonly messageId: string
  readonly now: number
  readonly patience: number
}

interface FinishInput {
  readonly turnId: string
  readonly outcome: 'done' | 'failed'
  readonly text: string
  readonly parts: string
  readonly messageId: string
  readonly now: number
}

interface ChatRow {
  readonly id: string
  readonly title: string
  readonly updated_at: number
}

/** The object's methods, as its stub offers them. A failure is the storage's, or the call's (`RpcCallError`). */
export type StylistMethods = {
  readonly begin: (input: BeginInput) => Effect.Effect<Begun, unknown, RuntimeContext>
  readonly turn: (turnId: string) => Effect.Effect<TurnInput, unknown, RuntimeContext>
  readonly progress: (turnId: string, text: string, parts: string) => Effect.Effect<void, unknown, RuntimeContext>
  readonly finish: (input: FinishInput) => Effect.Effect<boolean, unknown, RuntimeContext>
  readonly withdraw: (turnId: string) => Effect.Effect<void, unknown, RuntimeContext>
  readonly chat: (
    chatId: string,
    now: number,
    patience: number,
  ) => Effect.Effect<StoredChat | undefined, unknown, RuntimeContext>
  readonly chats: (limit: number) => Effect.Effect<ReadonlyArray<ChatRow>, unknown, RuntimeContext>
  readonly erase: () => Effect.Effect<void, unknown, RuntimeContext>
}

const schema = [
  'CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, parts TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat_id)',
  'CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, state TEXT NOT NULL, locale TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER)',
  'CREATE INDEX IF NOT EXISTS turns_chat ON turns (chat_id, started_at)',
]

type TurnRow = {
  id: string
  chat_id: string
  state: string
  locale: string
  started_at: number
}

const turnColumns = 'id, chat_id, state, locale, started_at'

/** Whether a reply is still being written: begun, not ended, and within its patience. */
const writing = (turn: TurnRow, now: number, patience: number) =>
  turn.state === 'writing' && now - turn.started_at < patience

/** The object's storage: statements run for their effect, rows read, and what each reply says so far while the queue
 * writes it (in memory: gone when the reply ends or the object restarts). */
interface Store {
  readonly run: (query: string, ...bindings: Array<unknown>) => Effect.Effect<void, never, RuntimeContext>
  readonly all: <T extends Record<string, Cloudflare.SqlStorageValue>>(
    query: string,
    ...bindings: Array<unknown>
  ) => Effect.Effect<ReadonlyArray<T>, never, RuntimeContext>
  readonly atomically: <A, E>(effect: Effect.Effect<A, E, RuntimeContext>) => Effect.Effect<A, unknown, RuntimeContext>
  readonly partials: Map<string, { readonly text: string; readonly parts: string }>
  readonly forget: Effect.Effect<void, never, RuntimeContext>
}

const messagesOf = (store: Store, chatId: string) =>
  store
    .all<{ id: string; role: string; text: string; parts: string; at: number }>(
      'SELECT id, role, text, parts, at FROM messages WHERE chat_id = ? ORDER BY rowid',
      chatId,
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row): StoredMessage => ({ ...row, role: row.role === 'styld' ? 'styld' : 'person' })),
      ),
    )

const turnOf = (store: Store, turnId: string) =>
  Effect.map(store.all<TurnRow>(`SELECT ${turnColumns} FROM turns WHERE id = ?`, turnId), (rows) => rows[0])

/** Store the person's message and begin Styld's reply to it, unless one is still being written. */
const begin = (store: Store, input: BeginInput) =>
  Effect.gen(function* () {
    const earlier = yield* turnOf(store, input.turnId)
    if (earlier !== undefined) return { outcome: 'replayed', chatId: earlier.chat_id } satisfies Begun
    const running = yield* store.all<TurnRow>(`SELECT ${turnColumns} FROM turns WHERE state = 'writing'`)
    if (running.some((turn) => writing(turn, input.now, input.patience))) return { outcome: 'busy' } satisfies Begun
    if (!input.newChat && (yield* store.all('SELECT id FROM chats WHERE id = ?', input.chatId)).length === 0)
      return { outcome: 'missing' } satisfies Begun
    yield* store.atomically(
      Effect.gen(function* () {
        yield* input.newChat
          ? store.run(
              'INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
              input.chatId,
              input.title,
              input.now,
              input.now,
            )
          : store.run('UPDATE chats SET updated_at = ? WHERE id = ?', input.now, input.chatId)
        yield* store.run(
          "INSERT INTO messages (id, chat_id, role, text, parts, at) VALUES (?, ?, 'person', ?, '[]', ?)",
          input.messageId,
          input.chatId,
          input.text,
          input.now,
        )
        yield* store.run(
          "INSERT INTO turns (id, chat_id, state, locale, started_at) VALUES (?, ?, 'writing', ?, ?)",
          input.turnId,
          input.chatId,
          input.locale,
          input.now,
        )
      }),
    )
    return { outcome: 'started', chatId: input.chatId } satisfies Begun
  })

/** End a reply being written: with its words and parts, or as failed. Whether it was still being written. */
const finish = (store: Store, input: FinishInput) =>
  Effect.gen(function* () {
    store.partials.delete(input.turnId)
    const turn = yield* turnOf(store, input.turnId)
    if (turn?.state !== 'writing') return false
    yield* store.atomically(
      Effect.gen(function* () {
        if (input.outcome === 'done')
          yield* store.run(
            "INSERT INTO messages (id, chat_id, role, text, parts, at) VALUES (?, ?, 'styld', ?, ?, ?)",
            input.messageId,
            turn.chat_id,
            input.text,
            input.parts,
            input.now,
          )
        yield* store.run(
          'UPDATE turns SET state = ?, ended_at = ? WHERE id = ?',
          input.outcome,
          input.now,
          input.turnId,
        )
        yield* store.run('UPDATE chats SET updated_at = ? WHERE id = ?', input.now, turn.chat_id)
      }),
    )
    return true
  })

/** Take back a reply that has not begun to be written, with the message it answers (begun at the same moment), and
 * its chat when that message was its only one: its credit could not be held. */
const withdraw = (store: Store, turnId: string) =>
  Effect.gen(function* () {
    const turn = yield* turnOf(store, turnId)
    if (turn?.state !== 'writing') return
    yield* store.atomically(
      Effect.gen(function* () {
        yield* store.run('DELETE FROM turns WHERE id = ?', turnId)
        yield* store.run(
          "DELETE FROM messages WHERE chat_id = ? AND role = 'person' AND at = ?",
          turn.chat_id,
          turn.started_at,
        )
        yield* store.run(
          'DELETE FROM chats WHERE id = ? AND NOT EXISTS (SELECT 1 FROM messages WHERE chat_id = ?)',
          turn.chat_id,
          turn.chat_id,
        )
      }),
    )
  })

/** A chat with its messages, and the reply to its last message while it is written or when it failed. A reply written
 * longer than `patience` is shown as failed: the queue gives it up. */
const chatOf = (store: Store, chatId: string, now: number, patience: number) =>
  Effect.gen(function* () {
    const [chat] = yield* store.all<{ id: string; title: string }>('SELECT id, title FROM chats WHERE id = ?', chatId)
    if (chat === undefined) return undefined
    const plain: StoredChat = { ...chat, messages: yield* messagesOf(store, chatId) }
    const [last] = yield* store.all<TurnRow>(
      `SELECT ${turnColumns} FROM turns WHERE chat_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      chatId,
    )
    if (last === undefined || last.state === 'done' || plain.messages.at(-1)?.role === 'styld') return plain
    const partial = store.partials.get(last.id) ?? { text: '', parts: '[]' }
    const replying: StoredChat = {
      ...plain,
      replying: { state: writing(last, now, patience) ? 'writing' : 'failed', ...partial },
    }
    return replying
  })

/** The methods over the store. */
const methodsOf = (store: Store): StylistMethods => ({
  begin: (input) => begin(store, input),
  /** A reply's chat so far, for the queue to answer. */
  turn: (turnId) =>
    Effect.gen(function* () {
      const turn = yield* turnOf(store, turnId)
      if (turn === undefined) return { found: false } satisfies TurnInput
      return {
        found: true,
        state: turn.state === 'done' || turn.state === 'failed' ? turn.state : 'writing',
        locale: turn.locale,
        messages: yield* messagesOf(store, turn.chat_id),
      } satisfies TurnInput
    }),
  /** What the reply says so far. */
  progress: (turnId, text, parts) => Effect.sync(() => void store.partials.set(turnId, { text, parts })),
  finish: (input) => finish(store, input),
  withdraw: (turnId) => withdraw(store, turnId),
  chat: (chatId, now, patience) => chatOf(store, chatId, now, patience),
  /** The chats, the latest first. */
  chats: (limit) =>
    store.all<{ id: string; title: string; updated_at: number }>(
      'SELECT id, title, updated_at FROM chats ORDER BY updated_at DESC LIMIT ?',
      limit,
    ),
  /** Forget every chat: the account is being deleted. The tables come back empty for any later call. */
  erase: () =>
    Effect.gen(function* () {
      store.partials.clear()
      yield* store.forget
    }),
})

export class Stylist extends Cloudflare.DurableObject<Stylist>()(
  'Stylist',
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState
    return Effect.gen(function* () {
      const { sql } = state.storage
      const run = (query: string, ...bindings: Array<unknown>) => Effect.asVoid(sql.exec(query, ...bindings))
      const tables = Effect.forEach(schema, (statement) => run(statement), { discard: true })
      yield* tables
      const store: Store = {
        run,
        all: <T extends Record<string, Cloudflare.SqlStorageValue>>(query: string, ...bindings: Array<unknown>) =>
          Effect.flatMap(sql.exec<T>(query, ...bindings), (cursor) => cursor.toArray()),
        atomically: (effect) => state.storage.transaction(effect),
        partials: new Map(),
        forget: Effect.andThen(state.storage.deleteAll(), tables),
      }
      return methodsOf(store)
    })
  }),
) {}
