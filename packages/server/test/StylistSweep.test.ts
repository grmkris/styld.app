import { describe, expect, it } from '@effect/vitest'
import { drizzle } from 'drizzle-orm/d1'
import { Effect, Layer } from 'effect'
import { stuckRows } from '../src/jobs/Sweeps.ts'
import { type ChatStore, ChatStores, sweepTurn } from '../src/stylist/Chats.ts'
import { StylistTurns, turnStore } from '../src/stylist/Store.ts'
import { type Ending, Holds } from '../src/usage/Holds.ts'
import { localD1 } from './LocalD1.ts'

// A Styld turn whose queue message (or settlement) is lost keeps its open row in D1, which the sweep reads: each turn
// open past the patience is settled from its status in the account's chats, its credit back unless the reply was
// written, and its row closed, so the next sweep leaves it alone.

const minute = 60_000
const now = Date.now()
const until = new Date(now - 30 * minute)
const nowDate = new Date(now)
const recent = new Date(now - 5 * minute)
const old = new Date(now - 40 * minute)
const older = new Date(now - 50 * minute)
const unused = () => Effect.die(new Error('not used by the sweep'))

type TurnState = 'writing' | 'done' | 'failed' | 'missing'

/** One account's chats holding these turns, recording the replies the sweep ends. */
const chatsWith = (turns: Readonly<Record<string, TurnState>>, finished: Array<readonly [string, string]>) => {
  const store: ChatStore = {
    turn: (turnId) => {
      const state = turns[turnId] ?? 'missing'
      return Effect.succeed(state === 'missing' ? { found: false } : { found: true, state, locale: 'en', messages: [] })
    },
    finish: (input) => Effect.sync(() => (finished.push([input.turnId, input.outcome]), true)),
    begin: unused,
    progress: unused,
    withdraw: unused,
    chat: unused,
    chats: unused,
    erase: unused,
  }
  return ChatStores.layer(() => store)
}

const seeded = () => {
  const database = localD1()
  database.sqlite.exec(
    "INSERT INTO accounts (id, security_revision, display_name, created_at) VALUES ('ac_1', 0, 'Ana', 0)",
  )
  return database
}

describe('the stylist sweep', () => {
  it.effect('finds the turns open past the patience, oldest first', () =>
    Effect.gen(function* () {
      const db = drizzle(seeded())
      const turns = turnStore(db)
      yield* turns.open('tn_recent', 'ac_1', recent)
      yield* turns.open('tn_old', 'ac_1', old)
      yield* turns.open('tn_older', 'ac_1', older)
      // Opening a turn again, as a repeated request does, is the same turn.
      yield* turns.open('tn_old', 'ac_1', nowDate)
      expect(yield* stuckRows(db).stylistTurns(until)).toEqual(['tn_older', 'tn_old'])
    }),
  )

  it.effect('settles each turn from its status, refunds all but a written reply, and closes it', () =>
    Effect.gen(function* () {
      const db = drizzle(seeded())
      const turns = turnStore(db)
      const states: Record<string, TurnState> = {
        tn_writing: 'writing',
        tn_done: 'done',
        tn_failed: 'failed',
        tn_missing: 'missing',
      }
      yield* Effect.forEach(Object.keys(states), (turnId) => turns.open(turnId, 'ac_1', old))
      const settled: Array<readonly [string, Ending]> = []
      const finished: Array<readonly [string, string]> = []
      const holds = Holds.of({
        reserve: () => Effect.void,
        remaining: () => Effect.succeed(0),
        sweep: Effect.succeed(0),
        settle: (_accountId, hold, ending) => Effect.sync(() => void settled.push([hold, ending])),
      })
      const services = Layer.mergeAll(
        chatsWith(states, finished),
        Layer.succeed(Holds, holds),
        Layer.succeed(StylistTurns, turns),
      )
      const sweep = Effect.forEach(Object.keys(states), sweepTurn, { discard: true }).pipe(Effect.provide(services))
      yield* sweep
      expect(Object.fromEntries(settled)).toEqual({
        'stylist/tn_writing/0': 'failed',
        'stylist/tn_done/0': 'succeeded',
        'stylist/tn_failed/0': 'failed',
        'stylist/tn_missing/0': 'failed',
      })
      // Only the reply still being written is ended, as failed: the person's chat shows it so already.
      expect(finished).toEqual([['tn_writing', 'failed']])
      expect(yield* stuckRows(db).stylistTurns(nowDate)).toEqual([])
      // A second sweep finds nothing open and settles nothing again.
      yield* sweep
      expect(settled).toHaveLength(4)
    }),
  )
})
