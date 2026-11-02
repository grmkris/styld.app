import { Unavailable } from '@styld/protocol'
import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { type Ending, Holds, holdId } from '../usage/Holds.ts'
import { StylistTurns } from './Store.ts'
import type { StylistMethods } from './StylistObject.ts'

// Each account's chats, and how a turn's credit ends: settled once by how the turn ended, its open row in D1 closed
// after, so the sweep finds every turn whose settlement was lost on the way, and settles it from the object's status.

/** One account's chats: its Durable Object's methods, callable from the Worker. */
export type ChatStore = {
  readonly [Method in keyof StylistMethods]: (
    ...args: Parameters<StylistMethods[Method]>
  ) => Effect.Effect<Effect.Success<ReturnType<StylistMethods[Method]>>, unknown>
}

/** Each account's chats, in its Durable Object. */
export class ChatStores extends Context.Service<ChatStores, { readonly of: (accountId: string) => ChatStore }>()(
  '@styld/server/stylist/ChatStores',
) {
  static readonly layer = (of: (accountId: string) => ChatStore) => Layer.succeed(this, { of })
}

export const unavailable = () => Unavailable.make({})
export const stored = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.mapError(effect, unavailable)
export const now = Effect.map(DateTime.now, DateTime.toEpochMillis)

/** A turn's credit in the Wallet: one per message, its first and only attempt. */
export const holdOf = (turnId: string) => holdId('stylist', turnId, 0)

/** One account's chats, through its Durable Object. */
export const chatsOf = (accountId: string) => Effect.map(ChatStores, (stores) => stores.of(accountId))

/** Settle a turn's credit by how it ended, then close its open row; a row that cannot be closed now is left for the
 * sweep, which settles it again (the first settlement stands). */
export const settled = (accountId: string, turnId: string, ending: Ending) =>
  Effect.gen(function* () {
    yield* (yield* Holds).settle(accountId, holdOf(turnId), ending)
    yield* (yield* StylistTurns)
      .close(turnId)
      .pipe(Effect.ignore({ log: true, message: 'Styld.Stylist could not close a turn' }))
  })

/** A reply that will not come: shown as failed, and its credit back. */
export const giveUp = (accountId: string, turnId: string) =>
  Effect.gen(function* () {
    const chats = yield* chatsOf(accountId)
    yield* stored(chats.finish({ turnId, outcome: 'failed', text: '', parts: '[]', messageId: '', now: yield* now }))
    yield* settled(accountId, turnId, 'failed')
  })

/** The sweep's move for a turn still open past its patience, whose queue message or settlement was lost: one still
 * being written will not be (the person's chat already shows it failed), so it is given up and refunded; one that
 * ended is settled by how it ended; one withdrawn, or gone with its chats, held nothing and is closed. */
export const sweepTurn = Effect.fn('Styld.Stylist.sweepTurn')(function* (turnId: string) {
  const open = yield* stored((yield* StylistTurns).find(turnId))
  if (Option.isNone(open)) return
  const { accountId } = open.value
  const turn = yield* stored((yield* chatsOf(accountId)).turn(turnId))
  if (!turn.found) return yield* settled(accountId, turnId, 'failed')
  if (turn.state === 'writing') return yield* giveUp(accountId, turnId)
  yield* settled(accountId, turnId, turn.state === 'done' ? 'succeeded' : 'failed')
})
